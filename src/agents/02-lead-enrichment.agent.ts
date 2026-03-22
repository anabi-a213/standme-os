import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { readSheet, updateCell, sheetUrl } from '../services/google/sheets';
import { generateText } from '../services/ai/client';
import { sendToMo, formatType2 } from '../services/telegram/bot';
import { saveKnowledge, buildKnowledgeContext, sourceExistsInKnowledge } from '../services/knowledge';
import { logger } from '../utils/logger';
import { agentEventBus } from '../services/agent-event-bus';
import { conflictGuard } from '../services/conflict-guard';
import { pipelineRunner } from '../services/pipeline-runner';

export class LeadEnrichmentAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Lead Enrichment & DM Finder',
    id: 'agent-02',
    description: 'Find decision makers and enrich lead data',
    commands: ['/enrich'],
    requiredRole: UserRole.OPS_LEAD,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    // Optional: if args provided, restrict to that company name only.
    // This prevents W1/W5 from enriching every lead when targeting one specific lead.
    const targetCompany = (ctx.args || '').trim().toLowerCase();

    const rows = await readSheet(SHEETS.LEAD_MASTER);
    const leadsToEnrich: { row: number; data: string[] }[] = [];

    for (let i = 1; i < rows.length; i++) {
      const enrichStatus = rows[i][17] || ''; // column R = enrichmentStatus
      const companyName = (rows[i][2] || '').toLowerCase();

      // If a specific company was requested, filter to that company only
      if (targetCompany && !companyName.includes(targetCompany)) continue;

      // Enrich any lead that hasn't been enriched yet — no score gate
      if (['PENDING', 'QUALIFYING', ''].includes(enrichStatus) && rows[i][2]) {
        leadsToEnrich.push({ row: i + 1, data: rows[i] });
      }
    }

    if (leadsToEnrich.length === 0) {
      await this.respond(ctx.chatId, 'No leads pending enrichment.');
      return { success: true, message: 'No leads to enrich', confidence: 'HIGH' };
    }

    let enriched = 0;
    for (const lead of leadsToEnrich) {
      const companyName = lead.data[2]; // column C
      const industry = lead.data[10]; // column K
      const leadId = lead.data[0];    // column A

      // Skip if another agent is already enriching this lead
      const lockKey = `enrich:${leadId}`;
      if (!conflictGuard.acquire(lockKey, this.config.id)) {
        logger.info(`[Enrichment] Skipping ${companyName} — enrichment lock held by another process`);
        continue;
      }

      // Mark as in progress
      await updateCell(SHEETS.LEAD_MASTER, lead.row, 'R', 'IN_PROGRESS');

      try {
        // Pull existing knowledge about this company and industry
        const knowledgeCtx = await buildKnowledgeContext(`${companyName} ${industry || ''}`);

        // Use AI to suggest DM search strategy — enriched with KB context
        const enrichmentResult = await generateText(
          `Company: "${companyName}" | Industry: ${industry || 'unknown'}\n\n` +
          `${knowledgeCtx ? `WHAT WE ALREADY KNOW:\n${knowledgeCtx}\n\n` : ''}` +
          `This company exhibits at trade shows. Who signs off on exhibition stand budgets?\n\n` +
          `Give me:\n` +
          `1. Most likely decision-maker title (specific to this industry, not generic)\n` +
          `2. Where to find them: LinkedIn search terms or company website path\n` +
          `3. What this person cares about most when choosing a stand designer\n` +
          `4. One conversation opener that would land with this person\n\n` +
          `Be sharp. Skip anything generic.`,
          'You are a senior B2B sales researcher who specialises in the exhibition industry across MENA and Europe. You know exactly who holds the budget for trade show stands. Your intel is specific, not generic.',
          400
        );

        // Extract decision-maker title from AI response (line starting with "1.")
        let dmTitle = '';
        const titleMatch = enrichmentResult.match(/1[.)]\s*([^\n]+)/);
        if (titleMatch) {
          // Strip common prefixes like "Most likely decision-maker title: "
          dmTitle = titleMatch[1].replace(/^(most likely decision[- ]maker title[:\s]+|title[:\s]+)/i, '').trim().slice(0, 80);
        }

        // Calculate outreach readiness
        const dmName = lead.data[18] || ''; // column S
        const dmEmail = lead.data[21] || ''; // column V
        let readiness = 3; // base
        if (dmName) readiness += 3;
        if (dmTitle) readiness += 2; // we found a likely title via AI
        if (dmEmail) readiness += 4;

        // Update lead with enrichment notes + extracted title
        await updateCell(SHEETS.LEAD_MASTER, lead.row, 'R', 'ENRICHED');
        if (dmTitle) await updateCell(SHEETS.LEAD_MASTER, lead.row, 'T', dmTitle); // col T = dmTitle
        await updateCell(SHEETS.LEAD_MASTER, lead.row, 'W', readiness.toString());
        await updateCell(SHEETS.LEAD_MASTER, lead.row, 'Y', `AI Enrichment: ${enrichmentResult.substring(0, 200)}`);

        // Save enrichment research to KB — check for duplicates first (re-runs on same lead)
        const kbSource = `enrichment-${lead.data[0]}`;
        const alreadyInKb = await sourceExistsInKnowledge(kbSource).catch(() => false);
        if (!alreadyInKb) {
          await saveKnowledge({
            source: kbSource,
            sourceType: 'sheet',
            topic: companyName,
            tags: `enrichment,decision-maker,buyer-persona,${(industry || '').toLowerCase()}`,
            content: `DM research for ${companyName} (${industry || 'unknown'}): ${enrichmentResult.slice(0, 400)}`,
          });
        }

        // Publish lead.enriched — Workflow Engine W4 notifies Mo if readiness≥7
        // NOTE: Agent-02 no longer auto-adds to OUTREACH_QUEUE.
        // Mo explicitly runs /outreach [company] or /bulkoutreach [show] when ready.
        // This prevents leads entering cold email campaigns without Mo's explicit decision.
        agentEventBus.publish('lead.enriched', {
          agentId: this.config.id,
          entityId: leadId,
          entityName: companyName,
          data: { outreachReadiness: readiness, score: parseInt(lead.data[12] || '0'), showName: lead.data[6] || '' },
        });

        // Advance pipeline if one is tracking this lead
        pipelineRunner.advance(leadId, { dmTitle, readiness, enrichedAt: new Date().toISOString() });

        enriched++;
        conflictGuard.release(lockKey);
      } catch (err: any) {
        conflictGuard.release(lockKey);
        await updateCell(SHEETS.LEAD_MASTER, lead.row, 'R', 'FAILED');
        await this.log({
          actionType: 'enrich',
          detail: `Failed to enrich ${companyName}: ${err.message}`,
          result: 'FAIL',
        });
      }
    }

    const summary = `Enrichment complete: ${enriched}/${leadsToEnrich.length} leads processed.`;
    const leadSheetLink = sheetUrl(SHEETS.LEAD_MASTER);
    await this.respond(ctx.chatId, `✅ ${summary}${leadSheetLink ? `\n📊 [View in Lead Master](${leadSheetLink})` : ''}`);
    await sendToMo(formatType2('Lead Enrichment Run', `${summary}${leadSheetLink ? `\n📊 [Lead Master](${leadSheetLink})` : ''}`));

    return {
      success:    true,
      message:    summary,
      confidence: 'MEDIUM',
      data: {
        enrichedCount: enriched,
        totalCount:    leadsToEnrich.length,
        targetCompany: targetCompany || null,
      },
    };
  }
}
