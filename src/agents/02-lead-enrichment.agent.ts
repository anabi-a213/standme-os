import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { readSheet, updateCell, sheetUrl } from '../services/google/sheets';
import { generateText } from '../services/ai/client';
import { sendToMo, formatType2 } from '../services/telegram/bot';
import { saveKnowledge, updateKnowledge, buildKnowledgeContext, searchKnowledgeForCompany, sourceExistsInKnowledge } from '../services/knowledge';
import { getConfidence } from '../utils/confidence';
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

      // Enrich any lead that hasn't been enriched yet, OR has ASSUMED/INFERRED key fields
      const hasLowConfidenceFields = ['G', 'I', 'J', 'K'].some(col => {
        const colIdx = col.charCodeAt(0) - 65;
        const val = rows[i][colIdx] || '';
        const conf = getConfidence(val);
        return val && (conf === 'ASSUMED' || conf === 'INFERRED');
      });
      if ((['PENDING', 'QUALIFYING', ''].includes(enrichStatus) || hasLowConfidenceFields) && rows[i][2]) {
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
        // Pull existing knowledge scoped to this company only (prevents cross-company data mixing)
        const knowledgeEntries = await searchKnowledgeForCompany(companyName, industry || '', leadId);
        const knowledgeCtx = knowledgeEntries.map(e =>
          `[${e.sourceType.toUpperCase()} | ${e.topic}] ${e.content}`
        ).join('\n');

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

        // If no DM email found, save a detailed guidance note to KB
        if (!dmEmail) {
          const website = lead.data[21] || ''; // col V might hold website in some rows
          await updateKnowledge(`enrichment-dm-${leadId}`, {
            sourceType: 'manual',
            topic: companyName,
            tags: `enrichment,dm-not-found,${(industry || '').toLowerCase()}`,
            content: `DM not found for ${companyName}. Suggest checking LinkedIn for: "${dmTitle || 'Marketing Director OR Exhibition Manager'}". Notes: ${enrichmentResult.slice(0, 200)}`,
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
        // Graceful failure — mark as partial, save guidance note to KB, never hard fail
        await updateCell(SHEETS.LEAD_MASTER, lead.row, 'R', 'ENRICHED').catch(() => {});
        await saveKnowledge({
          source: `enrichment-error-${leadId}`,
          sourceType: 'manual',
          topic: companyName,
          tags: `enrichment,error,${(industry || '').toLowerCase()}`,
          content: `Enrichment partially failed for ${companyName}: ${err.message}. Manual DM research recommended.`,
        }).catch(() => {});
        logger.warn(`[Enrichment] Partial failure for ${companyName}: ${err.message}`);
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
