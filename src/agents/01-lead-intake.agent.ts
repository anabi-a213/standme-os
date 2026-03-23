import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { Lead, LeadScoreResult, ScoreBreakdown } from '../types/lead';
import { UserRole } from '../config/access';
import { validateShow } from '../config/shows';
import { SHEETS } from '../config/sheets';
import { appendRow, readSheet, updateCell, rowToObject, objectToRow, sheetUrl } from '../services/google/sheets';
import { createCard, findListByName } from '../services/trello/client';
import { sendToMo, formatType1, formatType2 } from '../services/telegram/bot';
import { detectLanguage, generateText } from '../services/ai/client';
import { saveKnowledge, buildKnowledgeContext } from '../services/knowledge';
import { registerApproval } from '../services/approvals';
import { agentEventBus } from '../services/agent-event-bus';
import { conflictGuard } from '../services/conflict-guard';
import { pipelineRunner } from '../services/pipeline-runner';
import { generateLeadId } from '../utils/lead-id';
import { checkAllStepReadiness } from '../utils/knowledge-propagator';

export class LeadIntakeAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Lead Intake & Qualification',
    id: 'agent-01',
    description: 'Score, filter, and qualify every incoming lead',
    commands: ['/newlead'],
    requiredRole: UserRole.OPS_LEAD,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    const args = ctx.args;
    if (!args) {
      await this.respond(ctx.chatId, 'Usage: /newlead [company] | [contact name] | [email] | [show] | [size sqm] | [budget] | [industry]');
      return { success: false, message: 'No lead data provided', confidence: 'LOW' };
    }

    // Parse lead data — pipe-separated preferred, natural language fallback
    let parts: string[];
    if (args.includes('|')) {
      parts = args.split('|').map(s => s.trim());
    } else {
      // Natural language: use AI to extract structured fields
      parts = await this.parseNaturalLanguageLead(args);
    }
    const [companyName, contactName, contactEmail, showName, standSize, budget, industry] = parts;

    if (!companyName) {
      await this.respond(ctx.chatId, 'At minimum, provide a company name.');
      return { success: false, message: 'Missing company name', confidence: 'LOW' };
    }

    // Duplicate check — NON-BLOCKING: notify Mo but always create the lead
    // A false-positive match must never block the flow — Mo reviews and merges manually if needed
    const existingDup = await this.checkDuplicate(companyName, contactEmail, showName);
    if (existingDup) {
      await sendToMo(formatType2(
        'Potential Duplicate Lead',
        `*${companyName}* may already exist (matched: ${existingDup}).\nNew lead created anyway — review and merge in Lead Master if needed.\nNew data: ${args}`
      ));
    }

    // Validate show — soft fail only, never block lead creation
    const showValidation = showName ? validateShow(showName) : { valid: false, match: null, confidence: 'LOW' as const };
    if (showName && !showValidation.valid) {
      await sendToMo(formatType2(
        'Show Name Check',
        `"${showName}" not found in verified database — saved as-is. Confirm spelling when you get a chance.`
      ));
    }

    // Score the lead
    const scoreResult = this.scoreLead({
      showName: showName || '',
      showValid: showValidation.valid,
      standSize: standSize || '',
      budget: budget || '',
      industry: industry || '',
      contactTitle: '', // not provided in quick entry
      contactName: contactName || '',
    });

    const language = await detectLanguage(args);
    const leadId = await generateLeadId();

    // Build lead record
    const leadData: Record<string, string> = {
      id: leadId,
      timestamp: new Date().toISOString(),
      companyName: companyName || '',
      contactName: contactName || '',
      contactEmail: contactEmail || '',
      contactTitle: '',
      showName: showName || '',
      showCity: showValidation.match?.city || '',
      standSize: standSize || '',
      budget: budget || '',
      industry: industry || '',
      leadSource: 'telegram',
      score: scoreResult.total.toString(),
      scoreBreakdown: JSON.stringify(scoreResult.breakdown),
      confidence: showValidation.confidence,
      status: scoreResult.status,
      trelloCardId: '',
      enrichmentStatus: 'PENDING',
      dmName: '',
      dmTitle: '',
      dmLinkedIn: '',
      dmEmail: '',
      outreachReadiness: '',
      language,
      notes: existingDup ? `POTENTIAL_DUPLICATE: may match ${existingDup}` : '',
    };

    // Prevent duplicate concurrent creation for same company (Agent-01 + Agent-18 race)
    const lockKey = `lead:${companyName.toLowerCase().replace(/\s+/g, '-')}`;
    if (!conflictGuard.acquire(lockKey, this.config.id)) {
      await this.respond(ctx.chatId, `⏳ A lead for "${companyName}" is already being created. Please wait a moment.`);
      return { success: false, message: 'Concurrent lead creation blocked', confidence: 'LOW' };
    }

    // Write to Lead Master Sheet
    try {
      await appendRow(SHEETS.LEAD_MASTER, objectToRow(SHEETS.LEAD_MASTER, leadData));
    } finally {
      conflictGuard.release(lockKey);
    }

    // Publish event — Workflow Engine reacts (W1: auto-enrich HOT/WARM after 3 min)
    agentEventBus.publish('lead.created', {
      agentId: this.config.id,
      entityId: leadId,
      entityName: companyName,
      data: { status: scoreResult.status, score: scoreResult.total, showName: showName || '', industry: industry || '' },
    });

    // Save to Knowledge Base — makes this lead's context available to all agents
    await saveKnowledge({
      source: `lead-${leadId}`,
      sourceType: 'sheet',
      topic: companyName,
      tags: `lead,company,${(industry || '').toLowerCase()},${(showName || '').toLowerCase().replace(/\s+/g, '-')},${scoreResult.status.toLowerCase()}`,
      content: `${companyName} (${industry || 'unknown industry'}) attending ${showName || 'unknown show'}. Lead score: ${scoreResult.total}/10 (${scoreResult.status}). Contact: ${contactName || 'unknown'}. Budget: ${budget || 'unknown'}. Stand: ${standSize || 'unknown'} sqm. Language: ${language}.`,
    });

    // Create Trello card for HOT/WARM leads
    let trelloCardId = '';
    if (scoreResult.status === 'HOT' || scoreResult.status === 'WARM') {
      const boardId = process.env.TRELLO_BOARD_SALES_PIPELINE || '';
      const listName = '01 — New Inquiry';
      const list = await findListByName(boardId, listName);

      if (list) {
        const card = await createCard(
          list.id,
          `[${leadId}] ${companyName} — ${showName || 'Unknown Show'}`,
          `Lead ID: ${leadId}\nScore: ${scoreResult.total}/10 (${scoreResult.status})\n` +
          `Company: ${companyName}\nContact: ${contactName || 'N/A'}\n` +
          `Show: ${showName || 'N/A'} (${showValidation.match?.city || 'N/A'})\n` +
          `Size: ${standSize || 'N/A'} sqm\nBudget: ${budget || 'N/A'}\n` +
          `Industry: ${industry || 'N/A'}\nConfidence: ${showValidation.confidence}\n` +
          `\nScore Breakdown:\n` +
          `  Show Fit: ${scoreResult.breakdown.showFit}/2\n` +
          `  Size Signal: ${scoreResult.breakdown.sizeSignal}/2\n` +
          `  Industry Fit: ${scoreResult.breakdown.industryFit}/2\n` +
          `  DM Signal: ${scoreResult.breakdown.dmSignal}/2\n` +
          `  Timeline: ${scoreResult.breakdown.timeline}/2`
        );
        trelloCardId = card.id;
      }
    }

    // Notify Mo
    const statusEmoji = scoreResult.status === 'HOT' ? '🔥' : scoreResult.status === 'WARM' ? '🟡' : '❄️';
    const message = `${statusEmoji} *New Lead: ${companyName}*\n\n` +
      `Score: ${scoreResult.total}/10 (${scoreResult.status})\n` +
      `Show: ${showName || 'N/A'} ${showValidation.valid ? '✅' : '⚠️'}\n` +
      `Size: ${standSize || 'N/A'} sqm\n` +
      `Contact: ${contactName || 'N/A'}\n` +
      (trelloCardId ? `Trello card created ✅` : `No Trello card (score too low)`);

    if (scoreResult.status === 'HOT') {
      // Register the approval callbacks BEFORE sending the buttons to Mo — this makes
      // /approve_<leadId> and /reject_<leadId> (and Brain natural-language "approve") actually work.
      registerApproval(leadId, {
        action: `HOT Lead: ${companyName} — ${showName || 'Unknown Show'} (${scoreResult.total}/10)`,
        data: { leadId, companyName, showName, score: scoreResult.total },
        timestamp: Date.now(),
        onApprove: async () => {
          // Move lead to QUALIFYING
          try {
            const rows = await readSheet(SHEETS.LEAD_MASTER);
            const rowIdx = rows.findIndex(r => r[0] === leadId);
            if (rowIdx >= 0) await updateCell(SHEETS.LEAD_MASTER, rowIdx + 1, 'P', 'QUALIFYING');
          } catch { /* non-critical — lead is already created */ }
          return `✅ *${companyName}* approved — moved to Qualifying.\n\nNext: \`/brief ${companyName}\` to generate a concept brief.`;
        },
        onReject: async () => {
          // Mark as DISQUALIFIED
          try {
            const rows = await readSheet(SHEETS.LEAD_MASTER);
            const rowIdx = rows.findIndex(r => r[0] === leadId);
            if (rowIdx >= 0) await updateCell(SHEETS.LEAD_MASTER, rowIdx + 1, 'P', 'DISQUALIFIED');
          } catch { /* non-critical */ }
          return `❌ *${companyName}* disqualified and removed from pipeline.`;
        },
      });

      await sendToMo(formatType1(
        `HOT Lead: ${companyName}`,
        `Score ${scoreResult.total}/10`,
        message,
        leadId
      ));
    } else {
      await sendToMo(formatType2('New Lead Logged', message));
    }

    // Check what steps are already unlocked with the data provided
    const fakeRow: string[] = new Array(38).fill('');
    fakeRow[6] = leadData.showName;   // G = showName
    fakeRow[8] = leadData.standSize;  // I = standSize
    fakeRow[9] = leadData.budget;     // J = budget
    fakeRow[4] = leadData.contactEmail; // E = contactEmail
    const unlockedSteps: string[] = await checkAllStepReadiness(companyName, fakeRow).catch(() => []);

    const leadSheetLink = sheetUrl(SHEETS.LEAD_MASTER);
    const dupNote = existingDup ? `\n⚠️ Possible duplicate flagged — Mo notified to review.` : '';

    let readinessNote = '';
    if (unlockedSteps.includes('canRunBrief')) {
      readinessNote += `\nReady now: /brief ${companyName} (has show + size + budget)`;
    }
    if (!standSize) {
      readinessNote += `\nStill needed for renders: stand type`;
    }

    await this.respond(ctx.chatId, `✅ Lead captured: ${companyName} — ${scoreResult.status} (${scoreResult.total}/10)${dupNote}${readinessNote}${leadSheetLink ? `\n📊 [View in Lead Master](${leadSheetLink})` : ''}`);

    // Start pipeline for HOT/WARM manual leads (COLD leads don't warrant automatic pipeline)
    if (scoreResult.status === 'HOT' || scoreResult.status === 'WARM') {
      pipelineRunner.start(leadId, companyName);
    }

    return {
      success: true,
      message: `Lead ${leadId} captured as ${scoreResult.status}`,
      confidence: showValidation.confidence,
      data: { leadId, score: scoreResult.total, status: scoreResult.status },
    };
  }

  private async parseNaturalLanguageLead(text: string): Promise<string[]> {
    try {
      const result = await generateText(
        `Extract lead data from this text and return ONLY a pipe-separated line in this exact format:\n` +
        `[company name] | [contact name] | [email] | [show name] | [stand size sqm] | [budget] | [industry]\n\n` +
        `Use empty string for any field not found. Do not add any explanation.\n\nText: "${text}"`,
        'You extract structured data from unstructured text. Output only the pipe-separated line, nothing else.',
        100
      );
      const line = result.trim().replace(/^["']|["']$/g, '');
      return line.split('|').map(s => s.trim());
    } catch {
      // Fallback: treat entire text as company name
      return [text.trim(), '', '', '', '', '', ''];
    }
  }

  private scoreLead(data: {
    showName: string;
    showValid: boolean;
    standSize: string;
    budget: string;
    industry: string;
    contactTitle: string;
    contactName: string;
  }): LeadScoreResult {
    const breakdown: ScoreBreakdown = {
      showFit: 0,
      sizeSignal: 0,
      industryFit: 0,
      dmSignal: 0,
      timeline: 0,
    };

    // Show Fit (0-2)
    if (data.showValid) breakdown.showFit = 2;
    else if (data.showName) breakdown.showFit = 1;

    // Size Signal (0-2)
    if (data.standSize && parseFloat(data.standSize) > 0) breakdown.sizeSignal = 2;
    else if (data.budget) breakdown.sizeSignal = 1;

    // Industry Fit (0-2)
    const coreIndustries = ['solar', 'energy', 'medical', 'healthcare', 'food', 'packaging', 'technology', 'industrial'];
    const adjIndustries = ['automotive', 'construction', 'pharma', 'agriculture', 'retail'];
    const lowerIndustry = (data.industry || '').toLowerCase();
    if (coreIndustries.some(i => lowerIndustry.includes(i))) breakdown.industryFit = 2;
    else if (adjIndustries.some(i => lowerIndustry.includes(i))) breakdown.industryFit = 1;

    // DM Signal (0-2)
    const title = (data.contactTitle || '').toLowerCase();
    const cLevelTitles = ['ceo', 'cmo', 'coo', 'director', 'vp', 'head of', 'managing'];
    const midTitles = ['manager', 'coordinator', 'specialist'];
    if (cLevelTitles.some(t => title.includes(t))) breakdown.dmSignal = 2;
    else if (midTitles.some(t => title.includes(t))) breakdown.dmSignal = 1;
    else if (data.contactName) breakdown.dmSignal = 1;

    // Timeline (0-2) — default 1 if show provided
    if (data.showName) breakdown.timeline = 1;

    const total = breakdown.showFit + breakdown.sizeSignal + breakdown.industryFit + breakdown.dmSignal + breakdown.timeline;

    let status: 'HOT' | 'WARM' | 'COLD' | 'DISQUALIFIED';
    if (total >= 8) status = 'HOT';
    else if (total >= 5) status = 'WARM';
    else if (total >= 3) status = 'COLD';
    else status = 'DISQUALIFIED';

    return { total, breakdown, status };
  }

  private async checkDuplicate(company: string, email?: string, show?: string): Promise<string | null> {
    try {
      const rows = await readSheet(SHEETS.LEAD_MASTER);
      for (const row of rows.slice(1)) { // skip header
        const existingCompany = (row[2] || '').toLowerCase();
        const existingEmail = (row[4] || '').toLowerCase();

        // Fuzzy company match
        if (existingCompany && company.toLowerCase().includes(existingCompany.substring(0, 5))) {
          return `${row[2]} (${row[4]})`;
        }
        // Email domain match
        if (email && existingEmail) {
          const newDomain = email.split('@')[1];
          const existDomain = existingEmail.split('@')[1];
          if (newDomain && existDomain && newDomain === existDomain) {
            return `${row[2]} (${row[4]})`;
          }
        }
      }
    } catch {
      // Don't block lead intake if dupe check fails
    }
    return null;
  }
}
