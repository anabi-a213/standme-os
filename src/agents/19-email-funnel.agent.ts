import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { readSheet, updateCell, appendRow, objectToRow } from '../services/google/sheets';
import { sendEmail } from '../services/google/gmail';
import { generateText } from '../services/ai/client';
import { sendToMo, formatType2, formatType3 } from '../services/telegram/bot';
import { GmailLeadMonitorAgent } from './18-gmail-lead-monitor.agent';

export class EmailFunnelAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Email Funnel Manager',
    id: 'agent-19',
    description: 'Manage two-way email conversations with inbound leads via info@standme.de',
    commands: ['/emailfunnel', '/emailthread', '/emailreply', '/emaildraft'],
    requiredRole: UserRole.ADMIN,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    const cmd = ctx.command.toLowerCase();
    if (cmd === '/emailfunnel')  return this.showFunnel(ctx);
    if (cmd === '/emailthread')  return this.showThread(ctx);
    if (cmd === '/emailreply')   return this.sendReply(ctx);
    if (cmd === '/emaildraft')   return this.draftReply(ctx);
    return { success: false, message: 'Unknown command', confidence: 'LOW' };
  }

  // ─── /emailfunnel — dashboard of all email leads ───────────────────────

  private async showFunnel(ctx: AgentContext): Promise<AgentResponse> {
    const rows = await readSheet(SHEETS.EMAIL_FUNNEL).catch(() => [] as string[][]);
    const data = rows.slice(1).filter(r => r[2]); // skip header + empty rows

    if (!data.length) {
      await this.respond(ctx.chatId, 'No email funnel records yet. Leads appear here after their first email arrives at info@standme.de.');
      return { success: true, message: 'No funnel records', confidence: 'HIGH' };
    }

    // Group by stage
    const stageOrder = ['NEW_INQUIRY', 'WELCOMED', 'REPLIED', 'QUALIFYING', 'BRIEFED', 'PROPOSAL', 'WON', 'LOST'];
    const byStage = new Map<string, string[][]>();
    for (const row of data) {
      const stage = row[7] || 'WELCOMED';
      if (!byStage.has(stage)) byStage.set(stage, []);
      byStage.get(stage)!.push(row);
    }

    const sections: { label: string; content: string }[] = [];
    for (const stage of stageOrder) {
      const leads = byStage.get(stage);
      if (!leads?.length) continue;
      const lines = leads.map(r => {
        const daysSince = Math.floor((Date.now() - new Date(r[8] || Date.now()).getTime()) / 86400000);
        return `  • ${r[2]} (${r[4]}) — ${r[10] || 'show TBC'} — last contact ${daysSince}d ago`;
      });
      sections.push({ label: stage, content: lines.join('\n') });
    }

    sections.push({
      label: 'COMMANDS',
      content: '`/emailthread [company]` — see full conversation\n`/emaildraft [company]` — AI drafts a reply\n`/emailreply [company] | [message]` — send your own reply',
    });

    await this.sendSummary(ctx.chatId, '📧 Email Funnel', sections);
    return { success: true, message: `${data.length} funnel leads shown`, confidence: 'HIGH' };
  }

  // ─── /emailthread [company] — show full conversation ───────────────────

  private async showThread(ctx: AgentContext): Promise<AgentResponse> {
    const company = ctx.args.trim();
    if (!company) {
      await this.respond(ctx.chatId, 'Usage: `/emailthread [company name]`');
      return { success: false, message: 'No company', confidence: 'LOW' };
    }

    const funnelRow = await this.findFunnelRow(company);
    if (!funnelRow) {
      await this.respond(ctx.chatId, `No email funnel record found for "${company}".`);
      return { success: false, message: 'Not found', confidence: 'HIGH' };
    }

    const { data } = funnelRow;
    const log: any[] = JSON.parse(data[14] || '[]');
    const sentCount = data[9] || '0';

    let thread = `📧 *Email Thread: ${data[2]}*\n`;
    thread += `Contact: ${data[3]} — ${data[4]}\n`;
    thread += `Stage: *${data[7]}* | Sent: ${sentCount} emails\n`;
    thread += `Show: ${data[10] || 'TBC'} | Size: ${data[11] || 'TBC'} sqm | Budget: ${data[12] || 'TBC'}\n`;
    thread += `\n${'─'.repeat(30)}\n`;

    for (const entry of log) {
      const who = entry.direction === 'out' ? '→ StandMe' : '← Client';
      const date = (entry.date || '').substring(0, 10);
      thread += `\n*${who}* (${date})\n${entry.summary}\n`;
    }

    thread += `\n${'─'.repeat(30)}\n`;
    thread += `Reply: \`/emailreply ${data[2]} | your message\`\n`;
    thread += `AI draft: \`/emaildraft ${data[2]}\``;

    await this.respond(ctx.chatId, thread);
    return { success: true, message: 'Thread shown', confidence: 'HIGH' };
  }

  // ─── /emaildraft [company] — AI drafts a reply for Mo to review ─────────

  private async draftReply(ctx: AgentContext): Promise<AgentResponse> {
    const company = ctx.args.trim();
    if (!company) {
      await this.respond(ctx.chatId, 'Usage: `/emaildraft [company name]`');
      return { success: false, message: 'No company', confidence: 'LOW' };
    }

    const funnelRow = await this.findFunnelRow(company);
    if (!funnelRow) {
      await this.respond(ctx.chatId, `No email funnel record found for "${company}".`);
      return { success: false, message: 'Not found', confidence: 'HIGH' };
    }

    const { data } = funnelRow;
    const log: any[] = JSON.parse(data[14] || '[]');
    const historyText = log.map((e: any) =>
      `[${e.direction === 'out' ? 'StandMe' : data[2]}] ${(e.date || '').substring(0, 10)}: ${e.summary}`
    ).join('\n');

    const stage = data[7] || 'WELCOMED';
    const stageGoal: Record<string, string> = {
      WELCOMED:   'Get them to confirm show name and stand size, and book a quick call',
      REPLIED:    'Move them to provide show/size details and schedule a call',
      QUALIFYING: 'Confirm budget range and decision-maker authority, then offer a concept call',
      BRIEFED:    'Follow up on brief feedback and push toward proposal approval',
      PROPOSAL:   'Handle objections, push toward contract signature',
    };

    await this.respond(ctx.chatId, `✍️ Drafting reply for ${data[2]}...`);

    const draft = await generateText(
      `You are drafting an email reply from StandMe (info@standme.de) to ${data[3] || data[2]}.\n\n` +
      `CONVERSATION HISTORY:\n${historyText || '(no history yet)'}\n\n` +
      `CURRENT FUNNEL STAGE: ${stage}\n` +
      `GOAL FOR THIS EMAIL: ${stageGoal[stage] || 'Move the conversation forward'}\n\n` +
      `WHAT WE KNOW:\n` +
      `- Show: ${data[10] || 'not confirmed'}\n` +
      `- Stand size: ${data[11] || 'not confirmed'} sqm\n` +
      `- Budget: ${data[12] || 'not confirmed'}\n\n` +
      `Rules:\n` +
      `- NEVER mention pricing or budget in this email\n` +
      `- Under 150 words\n` +
      `- Professional but warm\n` +
      `- End with one clear call-to-action\n` +
      `- Sign off: Mohammed Anabi | StandMe | www.standme.de`,
      'You write concise, high-converting sales emails for an exhibition stand design company. No fluff.',
      400
    );

    await this.respond(ctx.chatId,
      `📝 *Draft for ${data[2]}:*\n\n${draft}\n\n` +
      `─────────────────────\n` +
      `To send this exact draft:\n\`/emailreply ${data[2]} | SEND_DRAFT\`\n\n` +
      `To send your own message:\n\`/emailreply ${data[2]} | Your message here\`\n\n` +
      `To edit and send: copy, edit above, paste with /emailreply`
    );

    // Store the draft temporarily in notes column so /emailreply SEND_DRAFT can retrieve it
    await updateCell(SHEETS.EMAIL_FUNNEL, funnelRow.row, 'N', `DRAFT::${draft}`);

    return { success: true, message: 'Draft shown', confidence: 'HIGH' };
  }

  // ─── /emailreply [company] | [message or SEND_DRAFT] ────────────────────

  private async sendReply(ctx: AgentContext): Promise<AgentResponse> {
    const parts = ctx.args.split('|').map(s => s.trim());
    const company = parts[0];
    const message = parts.slice(1).join('|').trim();

    if (!company || !message) {
      await this.respond(ctx.chatId,
        'Usage: `/emailreply [company] | [your message]`\n' +
        'Or to send the last AI draft: `/emailreply [company] | SEND_DRAFT`'
      );
      return { success: false, message: 'Missing company or message', confidence: 'LOW' };
    }

    const funnelRow = await this.findFunnelRow(company);
    if (!funnelRow) {
      await this.respond(ctx.chatId, `No email funnel record found for "${company}".`);
      return { success: false, message: 'Not found', confidence: 'HIGH' };
    }

    const { data, row } = funnelRow;
    const contactEmail = data[4];
    const contactName = data[3] || data[2];
    const showName = data[10] || 'your exhibition';
    const lastMessageId = data[6] || '';
    const gmailThreadId = data[5] || '';

    // If SEND_DRAFT, retrieve the stored draft
    let emailBody = message;
    if (message.toUpperCase() === 'SEND_DRAFT') {
      const notes = data[13] || '';
      if (notes.startsWith('DRAFT::')) {
        emailBody = notes.replace(/^DRAFT::/, '');
      } else {
        await this.respond(ctx.chatId, 'No saved draft found. Run `/emaildraft [company]` first.');
        return { success: false, message: 'No draft saved', confidence: 'HIGH' };
      }
    }

    // Build subject — Re: if there's a thread, new subject if first outbound
    const subject = lastMessageId
      ? `Re: Your ${showName} Request — StandMe`
      : `Your ${showName} Stand — StandMe`;

    // Send the email in the existing Gmail thread
    const sentId = await sendEmail(
      contactEmail,
      subject,
      emailBody,
      lastMessageId || undefined,
    );

    // Update funnel record
    const existingLog: any[] = JSON.parse(data[14] || '[]');
    existingLog.push({
      direction: 'out',
      date: new Date().toISOString(),
      subject,
      summary: emailBody.substring(0, 300),
    });
    const sentCount = parseInt(data[9] || '0') + 1;

    await updateCell(SHEETS.EMAIL_FUNNEL, row, 'H', this.advanceStage(data[7]));
    await updateCell(SHEETS.EMAIL_FUNNEL, row, 'I', new Date().toISOString());
    await updateCell(SHEETS.EMAIL_FUNNEL, row, 'J', sentCount.toString());
    await updateCell(SHEETS.EMAIL_FUNNEL, row, 'N', ''); // clear draft
    await updateCell(SHEETS.EMAIL_FUNNEL, row, 'O', JSON.stringify(existingLog).substring(0, 2000));

    await this.respond(ctx.chatId,
      `✅ Email sent to *${contactName}* (${contactEmail})\n` +
      `Subject: ${subject}\n` +
      `Funnel stage: ${this.advanceStage(data[7])}\n\n` +
      `_Thread continues in Gmail. Reply will be detected at next /checkemails scan._`
    );

    return { success: true, message: `Email sent to ${contactEmail}`, confidence: 'HIGH' };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async findFunnelRow(search: string): Promise<{ row: number; data: string[] } | null> {
    const rows = await readSheet(SHEETS.EMAIL_FUNNEL).catch(() => [] as string[][]);
    const q = search.toLowerCase();
    for (let i = 1; i < rows.length; i++) {
      const name = (rows[i][2] || '').toLowerCase();
      const email = (rows[i][4] || '').toLowerCase();
      if (name === q || name.includes(q) || email.includes(q)) {
        return { row: i + 1, data: rows[i] };
      }
    }

    // Auto-create EMAIL_FUNNEL row from LEAD_MASTER if a matching lead exists
    try {
      const leads = await readSheet(SHEETS.LEAD_MASTER);
      const leadRow = leads.slice(1).find(r =>
        (r[2] || '').toLowerCase().includes(q) ||
        (r[4] || '').toLowerCase().includes(q)
      );
      if (leadRow) {
        const newRow = objectToRow(SHEETS.EMAIL_FUNNEL, {
          id: `EF-${Date.now()}`,
          leadId: leadRow[0] || '',
          companyName: leadRow[2] || '',
          contactName: leadRow[3] || '',
          contactEmail: leadRow[4] || '',
          gmailThreadId: '',
          lastMessageId: '',
          funnelStage: 'NEW_INQUIRY',
          lastContactDate: leadRow[1] || new Date().toISOString(),
          emailsSent: '0',
          showName: leadRow[6] || '',
          standSize: leadRow[8] || '',
          budget: leadRow[9] || '',
          notes: 'Auto-created by Agent-19 from LEAD_MASTER (no EMAIL_FUNNEL record existed)',
          conversationLog: '[]',
        });
        await appendRow(SHEETS.EMAIL_FUNNEL, newRow);
        // Re-read to get the row index
        const updated = await readSheet(SHEETS.EMAIL_FUNNEL).catch(() => [] as string[][]);
        for (let i = updated.length - 1; i >= 1; i--) {
          if ((updated[i][2] || '').toLowerCase().includes(q)) {
            return { row: i + 1, data: updated[i] };
          }
        }
      }
    } catch { /* non-fatal — if auto-create fails, return null */ }

    return null;
  }

  /** Move stage forward one step when we send an email */
  private advanceStage(current: string): string {
    const progression: Record<string, string> = {
      NEW_INQUIRY:  'WELCOMED',
      WELCOMED:     'QUALIFYING',
      REPLIED:      'QUALIFYING',
      QUALIFYING:   'BRIEFED',
      BRIEFED:      'PROPOSAL',
      PROPOSAL:     'PROPOSAL',
    };
    return progression[current] || current;
  }
}
