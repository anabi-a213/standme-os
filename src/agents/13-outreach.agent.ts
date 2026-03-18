import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { readSheet, updateCell, appendRow, objectToRow } from '../services/google/sheets';
import { addProspectToCampaign, getCampaignStats, listCampaigns, WoodpeckerProspect } from '../services/woodpecker/client';
import { generateOutreachEmail } from '../services/ai/client';
import { registerApproval } from '../services/approvals';
import { sendToMo, formatType1, formatType2 } from '../services/telegram/bot';
import { logger } from '../utils/logger';

export class OutreachAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Automated Outreach Sender',
    id: 'agent-13',
    description: 'Run personalised outreach sequences via Woodpecker',
    commands: ['/outreach', '/outreachstatus', '/campaigns'],
    requiredRole: UserRole.ADMIN,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    if (ctx.command === '/outreachstatus') return this.showStatus(ctx);
    if (ctx.command === '/campaigns') return this.showCampaigns(ctx);
    return this.runOutreach(ctx);
  }

  // ---- /outreach — draft + send to Mo for approval, then push to Woodpecker ----

  private async runOutreach(ctx: AgentContext): Promise<AgentResponse> {
    const queue = await readSheet(SHEETS.OUTREACH_QUEUE);
    const ready = queue.slice(1).filter(r => r[7] === 'READY' && parseInt(r[6] || '0') >= 7);

    if (ready.length === 0) {
      await this.respond(ctx.chatId, 'No leads ready for outreach (score 7+ and status READY).');
      return { success: true, message: 'No leads ready', confidence: 'HIGH' };
    }

    // Auto-resolve campaign: use env override, or auto-pick the active campaign
    const campaignId = await this.resolveCampaignId(ctx, ctx.args);
    if (!campaignId) return { success: false, message: 'No campaign resolved', confidence: 'LOW' };

    let drafted = 0;

    for (const lead of ready.slice(0, 5)) {
      const leadId   = lead[0] || '';
      const company  = lead[2] || '';
      const dmName   = lead[3] || '';
      const dmEmail  = lead[4] || '';
      const showName = lead[5] || '';

      if (!dmEmail) continue;

      // Generate personalised email
      let email: { subject: string; body: string };
      try {
        email = await generateOutreachEmail({
          companyName: company,
          contactName: dmName,
          showName,
          industry: '',
          emailNumber: 1,
        });
      } catch (err: any) {
        logger.warn(`[Outreach] Email gen failed for ${company}: ${err.message}`);
        continue;
      }

      // Log as pending approval
      const logId = `OL-${Date.now()}`;
      await appendRow(SHEETS.OUTREACH_LOG, objectToRow(SHEETS.OUTREACH_LOG, {
        id: logId,
        leadId,
        companyName: company,
        emailType: 'EMAIL_1',
        sentDate: new Date().toISOString(),
        status: 'PENDING_APPROVAL',
        replyClassification: '',
        woodpeckerId: '',
        notes: `To: ${dmEmail} | Subject: ${email.subject}`,
      }));

      // Build prospect object for Woodpecker
      const nameParts = dmName.trim().split(' ');
      const prospect: WoodpeckerProspect = {
        email: dmEmail,
        first_name: nameParts[0] || dmName,
        last_name: nameParts.slice(1).join(' ') || '',
        company,
        snippet1: showName,
        snippet2: email.subject,
        snippet3: email.body.slice(0, 255),
        tags: `standme-outreach,${showName.toLowerCase().replace(/\s+/g, '-')}`,
      };

      // Register approval callback — this fires when Mo types /approve_outreach_xxx
      const approvalId = `outreach_${leadId}`;
      registerApproval(approvalId, {
        action: `Send outreach to ${company} (${dmEmail})`,
        data: { prospect, campaignId, logId, company, dmEmail },
        timestamp: Date.now(),
        onApprove: async () => {
          try {
            const wpId = await addProspectToCampaign(campaignId, prospect);
            // Update log row status
            await this.updateLogStatus(logId, 'SENT', wpId?.toString() || '');
            return `✅ Sent to Woodpecker: *${company}* (${dmEmail})\nCampaign: ${campaignId} | Woodpecker ID: ${wpId || 'N/A'}`;
          } catch (err: any) {
            await this.updateLogStatus(logId, 'ERROR', '');
            return `❌ Woodpecker push failed for ${company}: ${err.message}`;
          }
        },
        onReject: async () => {
          await this.updateLogStatus(logId, 'REJECTED', '');
          return `Rejected outreach to *${company}*.`;
        },
      });

      // Send approval request to Mo
      await sendToMo(formatType1(
        `Outreach: ${company}`,
        `${dmName} attending ${showName}`,
        `📧 *To:* ${dmEmail}\n*Subject:* ${email.subject}\n\n${email.body}`,
        approvalId
      ));

      drafted++;
    }

    await this.respond(ctx.chatId, `📧 ${drafted} outreach draft(s) sent to Mo for approval.\n\nMo approves with /approve\\_outreach\\_[leadId] or rejects with /reject\\_outreach\\_[leadId].`);
    return { success: true, message: `${drafted} outreach emails drafted`, confidence: 'HIGH' };
  }

  // ---- /outreachstatus — live Woodpecker stats + local log ----

  private async showStatus(ctx: AgentContext): Promise<AgentResponse> {
    await this.respond(ctx.chatId, 'Fetching outreach status...');

    const sections: string[] = [];

    // Local log stats
    try {
      const log = await readSheet(SHEETS.OUTREACH_LOG);
      const rows = log.slice(1);
      const stats = { sent: 0, pending: 0, rejected: 0, error: 0 };
      for (const r of rows) {
        const s = (r[5] || '').toUpperCase();
        if (s === 'SENT') stats.sent++;
        else if (s.includes('PENDING')) stats.pending++;
        else if (s === 'REJECTED') stats.rejected++;
        else if (s === 'ERROR') stats.error++;
      }
      sections.push(
        `*Local Log (${rows.length} total):*\n` +
        `  Sent to Woodpecker: ${stats.sent}\n` +
        `  Pending Approval: ${stats.pending}\n` +
        `  Rejected: ${stats.rejected}\n` +
        `  Errors: ${stats.error}`
      );
    } catch { /* silent */ }

    // Live Woodpecker campaign stats — auto-resolve
    const campaignId = await this.resolveCampaignId(ctx, '', true);
    if (campaignId) {
      try {
        const stats = await getCampaignStats(campaignId);
        const openRate = stats.sent > 0 ? Math.round((stats.opened / stats.sent) * 100) : 0;
        const replyRate = stats.sent > 0 ? Math.round((stats.replied / stats.sent) * 100) : 0;
        sections.push(
          `*Woodpecker Campaign #${campaignId}:*\n` +
          `  Sent: ${stats.sent} | Opened: ${stats.opened} (${openRate}%)\n` +
          `  Replied: ${stats.replied} (${replyRate}%) | Bounced: ${stats.bounced}\n` +
          `  Interested: ${stats.interested} | Not Interested: ${stats.not_interested}`
        );
      } catch (err: any) {
        sections.push(`*Woodpecker:* Could not fetch — ${err.message}`);
      }
    } else {
      sections.push(`*Woodpecker:* No campaign ID set. Add WOODPECKER\\_CAMPAIGN\\_ID to Railway env.`);
    }

    await this.respond(ctx.chatId, `📊 *Outreach Status*\n\n${sections.join('\n\n')}`);
    return { success: true, message: 'Outreach status shown', confidence: 'HIGH' };
  }

  // ---- /campaigns — list all Woodpecker campaigns ----

  private async showCampaigns(ctx: AgentContext): Promise<AgentResponse> {
    try {
      const campaigns = await listCampaigns();
      if (campaigns.length === 0) {
        await this.respond(ctx.chatId, 'No campaigns found in Woodpecker.');
        return { success: true, message: 'No campaigns', confidence: 'HIGH' };
      }

      const list = campaigns.map(c => `  *${c.name}* (ID: \`${c.id}\`) — ${c.status}`).join('\n');
      await this.respond(ctx.chatId,
        `*Woodpecker Campaigns:*\n\n${list}\n\n` +
        `To set the default campaign, add WOODPECKER\\_CAMPAIGN\\_ID=[ID] to Railway env.`
      );
      return { success: true, message: `${campaigns.length} campaigns`, confidence: 'HIGH' };
    } catch (err: any) {
      await this.respond(ctx.chatId, `Failed to fetch campaigns: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }
  }

  // ---- Auto-resolve which Woodpecker campaign to use ----
  // Priority: 1) explicit ID in args  2) env var override  3) only RUNNING campaign  4) ask Mo

  private async resolveCampaignId(ctx: AgentContext, args: string, silent = false): Promise<number | null> {
    // 1. Explicit ID passed as arg e.g. /outreach 12345
    const fromArg = parseInt(args?.trim() || '');
    if (fromArg > 0) return fromArg;

    // 2. Env var override
    const fromEnv = parseInt(process.env.WOODPECKER_CAMPAIGN_ID || '');
    if (fromEnv > 0) return fromEnv;

    // 3. Fetch live campaigns from Woodpecker
    let campaigns: { id: number; name: string; status: string }[] = [];
    try {
      campaigns = await listCampaigns();
    } catch (err: any) {
      if (!silent) await this.respond(ctx.chatId, `⚠️ Could not fetch Woodpecker campaigns: ${err.message}`);
      return null;
    }

    const running = campaigns.filter(c => c.status?.toUpperCase() === 'RUNNING');

    // 4a. Exactly one running → use it automatically
    if (running.length === 1) {
      if (!silent) await this.respond(ctx.chatId, `Using campaign: *${running[0].name}* (ID: ${running[0].id})`);
      return running[0].id;
    }

    // 4b. Multiple running → show list and ask Mo to specify
    if (running.length > 1) {
      const list = running.map(c => `  • *${c.name}* → /outreach ${c.id}`).join('\n');
      await this.respond(ctx.chatId, `Multiple active campaigns — pick one:\n\n${list}`);
      return null;
    }

    // 4c. No running campaigns — show all and ask
    if (!silent) {
      const all = campaigns.length > 0
        ? campaigns.map(c => `  • *${c.name}* [${c.status}] → /outreach ${c.id}`).join('\n')
        : '  No campaigns found in Woodpecker.';
      await this.respond(ctx.chatId, `No running campaigns. All campaigns:\n\n${all}`);
    }
    return null;
  }

  // ---- Update outreach log row status ----

  private async updateLogStatus(logId: string, status: string, woodpeckerId: string): Promise<void> {
    try {
      const log = await readSheet(SHEETS.OUTREACH_LOG);
      const rowIdx = log.findIndex(r => r[0] === logId);
      if (rowIdx < 0) return;

      const sheetRow = rowIdx + 1; // 1-indexed
      if (status) await updateCell(SHEETS.OUTREACH_LOG, sheetRow, 'F', status);
      if (woodpeckerId) await updateCell(SHEETS.OUTREACH_LOG, sheetRow, 'H', woodpeckerId);
    } catch (err: any) {
      logger.warn(`[Outreach] Could not update log status: ${err.message}`);
    }
  }
}
