import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { readSheet, updateCell, appendRow, objectToRow } from '../services/google/sheets';
import { addProspectToCampaign, getProspectActivity } from '../services/woodpecker/client';
import { generateOutreachEmail } from '../services/ai/client';
import { sendToMo, formatType1, formatType2 } from '../services/telegram/bot';

export class OutreachAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Automated Outreach Sender',
    id: 'agent-13',
    description: 'Run personalised outreach sequences',
    commands: ['/outreach', '/outreachstatus'],
    requiredRole: UserRole.ADMIN,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    if (ctx.command === '/outreachstatus') {
      return this.showStatus(ctx);
    }

    // Read outreach queue for ready leads
    const queue = await readSheet(SHEETS.OUTREACH_QUEUE);
    const ready = queue.slice(1).filter(r => r[7] === 'READY' && parseInt(r[6] || '0') >= 7);

    if (ready.length === 0) {
      await this.respond(ctx.chatId, 'No leads ready for outreach (score 7+).');
      return { success: true, message: 'No leads ready', confidence: 'HIGH' };
    }

    let processed = 0;
    for (const lead of ready.slice(0, 5)) { // Process up to 5 at a time
      const companyName = lead[2] || '';
      const dmName = lead[3] || '';
      const dmEmail = lead[4] || '';
      const showName = lead[5] || '';

      if (!dmEmail) continue;

      // Generate email draft
      const email = await generateOutreachEmail({
        companyName,
        contactName: dmName,
        showName,
        industry: '',
        emailNumber: 1,
      });

      // Send to Mo for approval
      await sendToMo(formatType1(
        `Outreach: ${companyName}`,
        `${dmName} at ${showName}`,
        `To: ${dmEmail}\nSubject: ${email.subject}\n\n${email.body}`,
        `outreach_${lead[0]}`
      ));

      // Log to outreach log
      await appendRow(SHEETS.OUTREACH_LOG, objectToRow(SHEETS.OUTREACH_LOG, {
        id: `OL-${Date.now()}`,
        leadId: lead[1] || '',
        companyName,
        emailType: 'EMAIL_1',
        sentDate: new Date().toISOString(),
        status: 'PENDING_APPROVAL',
        replyClassification: '',
        woodpeckerId: '',
        notes: `Subject: ${email.subject}`,
      }));

      processed++;
    }

    await this.respond(ctx.chatId, `📧 ${processed} outreach drafts sent to Mo for approval.`);

    return {
      success: true,
      message: `${processed} outreach emails drafted`,
      confidence: 'HIGH',
    };
  }

  private async showStatus(ctx: AgentContext): Promise<AgentResponse> {
    const log = await readSheet(SHEETS.OUTREACH_LOG);
    if (log.length <= 1) {
      await this.respond(ctx.chatId, 'No outreach activity yet.');
      return { success: true, message: 'No outreach data', confidence: 'HIGH' };
    }

    const stats = { sent: 0, opened: 0, replied: 0, bounced: 0, pending: 0 };
    for (const row of log.slice(1)) {
      const status = (row[5] || '').toUpperCase();
      if (status === 'SENT') stats.sent++;
      else if (status === 'OPENED') stats.opened++;
      else if (status === 'REPLIED') stats.replied++;
      else if (status === 'BOUNCED') stats.bounced++;
      else if (status.includes('PENDING')) stats.pending++;
    }

    await this.respond(ctx.chatId,
      `*Outreach Status:*\n` +
      `  Sent: ${stats.sent}\n  Opened: ${stats.opened}\n` +
      `  Replied: ${stats.replied}\n  Bounced: ${stats.bounced}\n` +
      `  Pending Approval: ${stats.pending}`
    );

    return { success: true, message: 'Outreach status shown', confidence: 'HIGH' };
  }
}
