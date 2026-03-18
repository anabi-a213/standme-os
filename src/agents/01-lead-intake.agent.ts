import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { Lead, LeadScoreResult, ScoreBreakdown } from '../types/lead';
import { UserRole } from '../config/access';
import { validateShow } from '../config/shows';
import { SHEETS } from '../config/sheets';
import { appendRow, readSheet, rowToObject, objectToRow, sheetUrl } from '../services/google/sheets';
import { createCard, findListByName } from '../services/trello/client';
import { sendToMo, formatType1, formatType2 } from '../services/telegram/bot';
import { detectLanguage } from '../services/ai/client';
import { saveKnowledge, buildKnowledgeContext } from '../services/knowledge';

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

    // Parse lead data from pipe-separated input
    const parts = args.split('|').map(s => s.trim());
    const [companyName, contactName, contactEmail, showName, standSize, budget, industry] = parts;

    if (!companyName) {
      await this.respond(ctx.chatId, 'At minimum, provide a company name.');
      return { success: false, message: 'Missing company name', confidence: 'LOW' };
    }

    // Duplicate check — stop and notify Mo rather than creating a corrupt duplicate entry
    const existing = await this.checkDuplicate(companyName, contactEmail, showName);
    if (existing) {
      await sendToMo(formatType2(
        'Duplicate Lead Detected',
        `${companyName} may already exist in the system.\nExisting: ${existing}\nNew data: ${args}\n\nMerging recommended.`
      ));
      await this.respond(ctx.chatId, `⚠️ Duplicate detected: *${companyName}* already exists as ${existing}. Notified Mo to review and merge. No new entry created.`);
      return { success: false, message: 'Duplicate lead — not logged', confidence: 'HIGH' };
    }

    // Validate show
    const showValidation = showName ? validateShow(showName) : { valid: false, match: null, confidence: 'LOW' as const };
    if (showName && !showValidation.valid) {
      await sendToMo(formatType2(
        'Show Name Mismatch',
        `"${showName}" not found in verified database. Flagged for review.`
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
    const leadId = `SM-${Date.now()}`;

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
      notes: '',
    };

    // Write to Lead Master Sheet
    await appendRow(SHEETS.LEAD_MASTER, objectToRow(SHEETS.LEAD_MASTER, leadData));

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
      const listName = '01 New Inquiry';
      const list = await findListByName(boardId, listName);

      if (list) {
        const card = await createCard(
          list.id,
          `${companyName} — ${showName || 'Unknown Show'}`,
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
      await sendToMo(formatType1(
        `HOT Lead: ${companyName}`,
        `Score ${scoreResult.total}/10`,
        message,
        leadId
      ));
    } else {
      await sendToMo(formatType2('New Lead Logged', message));
    }

    const leadSheetLink = sheetUrl(SHEETS.LEAD_MASTER);
    await this.respond(ctx.chatId, `✅ Lead captured: ${companyName} — ${scoreResult.status} (${scoreResult.total}/10)${leadSheetLink ? `\n📊 [View in Lead Master](${leadSheetLink})` : ''}`);

    return {
      success: true,
      message: `Lead ${leadId} captured as ${scoreResult.status}`,
      confidence: showValidation.confidence,
      data: { leadId, score: scoreResult.total, status: scoreResult.status },
    };
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
