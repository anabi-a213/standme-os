import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { readSheet, updateCell, appendRow, objectToRow } from '../services/google/sheets';
import { generateText } from '../services/ai/client';
import { sendToMo, formatType2 } from '../services/telegram/bot';

export class LeadEnrichmentAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Lead Enrichment & DM Finder',
    id: 'agent-02',
    description: 'Find decision makers and enrich lead data',
    commands: ['/enrich'],
    requiredRole: UserRole.OPS_LEAD,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    // Read leads that need enrichment (score 5+, status PENDING)
    const rows = await readSheet(SHEETS.LEAD_MASTER);
    const leadsToEnrich: { row: number; data: string[] }[] = [];

    for (let i = 1; i < rows.length; i++) {
      const score = parseInt(rows[i][12] || '0'); // column M = score
      const enrichStatus = rows[i][17] || ''; // column R = enrichmentStatus
      if (score >= 5 && (enrichStatus === 'PENDING' || enrichStatus === '')) {
        leadsToEnrich.push({ row: i + 1, data: rows[i] });
      }
    }

    if (leadsToEnrich.length === 0) {
      await this.respond(ctx.chatId, 'No leads pending enrichment (score 5+).');
      return { success: true, message: 'No leads to enrich', confidence: 'HIGH' };
    }

    let enriched = 0;
    for (const lead of leadsToEnrich) {
      const companyName = lead.data[2]; // column C
      const industry = lead.data[10]; // column K

      // Mark as in progress
      await updateCell(SHEETS.LEAD_MASTER, lead.row, 'R', 'IN_PROGRESS');

      try {
        // Use AI to suggest DM search strategy
        const enrichmentResult = await generateText(
          `For the company "${companyName}" in the ${industry || 'general'} industry, ` +
          `who would typically be the decision maker for exhibition stand bookings? ` +
          `Suggest likely titles and where to find them. Be specific.`,
          'You are a B2B sales research assistant.',
          300
        );

        // Calculate outreach readiness
        const dmName = lead.data[18] || ''; // column S
        const dmEmail = lead.data[21] || ''; // column V
        let readiness = 3; // base
        if (dmName) readiness += 3;
        if (dmEmail) readiness += 4;

        // Update lead with enrichment notes
        await updateCell(SHEETS.LEAD_MASTER, lead.row, 'R', 'ENRICHED');
        await updateCell(SHEETS.LEAD_MASTER, lead.row, 'W', readiness.toString());
        await updateCell(SHEETS.LEAD_MASTER, lead.row, 'Y', `AI Enrichment: ${enrichmentResult.substring(0, 200)}`);

        // If readiness 7+, add to outreach queue
        if (readiness >= 7) {
          await appendRow(SHEETS.OUTREACH_QUEUE, objectToRow(SHEETS.OUTREACH_QUEUE, {
            id: `OQ-${Date.now()}`,
            leadId: lead.data[0],
            companyName: companyName,
            dmName: dmName,
            dmEmail: dmEmail,
            showName: lead.data[6],
            readinessScore: readiness.toString(),
            sequenceStatus: 'READY',
            addedDate: new Date().toISOString(),
            lastAction: '',
          }));
        }

        enriched++;
      } catch (err: any) {
        await updateCell(SHEETS.LEAD_MASTER, lead.row, 'R', 'FAILED');
        await this.log({
          actionType: 'enrich',
          detail: `Failed to enrich ${companyName}: ${err.message}`,
          result: 'FAIL',
        });
      }
    }

    const summary = `Enrichment complete: ${enriched}/${leadsToEnrich.length} leads processed.`;
    await this.respond(ctx.chatId, `✅ ${summary}`);
    await sendToMo(formatType2('Lead Enrichment Run', summary));

    return { success: true, message: summary, confidence: 'MEDIUM' };
  }
}
