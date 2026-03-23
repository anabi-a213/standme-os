import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { readSheet, findRowByValue, appendRow, objectToRow, updateCell } from '../services/google/sheets';
import { addComment } from '../services/trello/client';
import { createGoogleDoc } from '../services/google/drive';
import { getFolderIdForCategory } from '../config/drive-folders';
import { generateBrief, generateText } from '../services/ai/client';
import { saveKnowledge, buildKnowledgeContext, searchKnowledgeForCompany } from '../services/knowledge';
import { sendToMo, formatType1, formatType2, sendToTeam } from '../services/telegram/bot';
import { pipelineRunner } from '../services/pipeline-runner';
import { displayValue } from '../utils/confidence';

export class ConceptBriefAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'AI Concept Brief Generator',
    id: 'agent-03',
    description: 'Generate research-backed design briefs',
    commands: ['/brief', '/renders'],
    requiredRole: UserRole.OPS_LEAD,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    if (ctx.command === '/renders') return this.queueRenders(ctx);
    return this.runBrief(ctx);
  }

  // ─── /renders [company] — queue render request ────────────────────────────
  private async queueRenders(ctx: AgentContext): Promise<AgentResponse> {
    const company = (ctx.args || '').trim();
    if (!company) {
      await this.respond(ctx.chatId,
        'Usage: `/renders [company name]`\n\n' +
        'Renders are queued and generated when the brief reaches Tier 3 (stand type confirmed).\n' +
        'Make sure stand type is set: `/updatelead [Company] | standType=island`'
      );
      return { success: false, message: 'No company specified', confidence: 'LOW' };
    }

    const leadRow = await this.fuzzyFindLead(company);
    if (!leadRow) {
      await this.respond(ctx.chatId, `Lead "${company}" not found.`);
      return { success: false, message: 'Lead not found', confidence: 'HIGH' };
    }

    const standType = displayValue(leadRow.data[26] || ''); // col AA
    const briefTier = leadRow.data[33] || '';               // col AH

    if (!standType) {
      await this.respond(ctx.chatId,
        `⚠️ Stand type not confirmed for *${leadRow.data[2]}*.\n\n` +
        `Renders need stand type to generate accurate spatial images.\n` +
        `Set it first: \`/updatelead ${leadRow.data[2]} | standType=island\` (or peninsula/corner/inline)`
      );
      return { success: false, message: 'Stand type missing', confidence: 'MEDIUM' };
    }

    // Queue renders — write to LEAD_MASTER col AI (rendersGenerated = QUEUED)
    await updateCell(SHEETS.LEAD_MASTER, leadRow.row, 'AI', 'QUEUED').catch(() => {});
    await sendToMo(formatType2(
      `Renders Queued: ${leadRow.data[2]}`,
      `Stand type: *${standType}*\nBrief tier: ${briefTier || 'not set'}\n\n` +
      `Freepik render prompts are in the concept brief (look for the Render Prompts section).\n` +
      `Copy the prompt and generate in Freepik AI → save to Drive → run: \`/updatelead ${leadRow.data[2]} | rendersDriveUrl=https://...\``
    ));

    await this.respond(ctx.chatId,
      `📸 Render request queued for *${leadRow.data[2]}*.\n` +
      `Stand type: ${standType}\n\n` +
      `Mo has been notified with the Freepik prompts from the brief.\n` +
      `_(Renders are generated manually in Freepik AI — this system queues and tracks the request.)_`
    );

    return { success: true, message: 'Render request queued', confidence: 'HIGH' };
  }

  // ─── /brief [company] — run brief with tier system ────────────────────────
  private async runBrief(ctx: AgentContext): Promise<AgentResponse> {
    const clientName = ctx.args.trim();
    if (!clientName) {
      await this.respond(ctx.chatId, 'Usage: /brief [client name or lead ID]');
      return { success: false, message: 'No client specified', confidence: 'LOW' };
    }

    // Find lead in master sheet — exact → partial → word match
    let leadRow = await findRowByValue(SHEETS.LEAD_MASTER, 'C', clientName);
    if (!leadRow) leadRow = await findRowByValue(SHEETS.LEAD_MASTER, 'A', clientName);
    if (!leadRow) leadRow = await this.fuzzyFindLead(clientName);

    if (!leadRow) {
      await this.respond(ctx.chatId, `Lead "${clientName}" not found in the system.`);
      return { success: false, message: 'Lead not found', confidence: 'HIGH' };
    }

    const companyName = leadRow.data[2];
    const showName = leadRow.data[6];
    const showCity = leadRow.data[7];
    const standSize = displayValue(leadRow.data[8] || '');
    const budget = displayValue(leadRow.data[9] || '');
    const industry = displayValue(leadRow.data[10] || '');
    const trelloCardId = leadRow.data[16];
    const leadId = leadRow.data[0];

    // Tier 3 fields (from knowledge propagator — new columns AA-AG)
    const standType         = displayValue(leadRow.data[26] || ''); // col AA
    const openSides         = displayValue(leadRow.data[27] || ''); // col AB
    const mainGoal          = displayValue(leadRow.data[28] || ''); // col AC
    const staffCount        = displayValue(leadRow.data[29] || ''); // col AD
    const mustHaveElements  = displayValue(leadRow.data[30] || ''); // col AE
    const brandColours      = displayValue(leadRow.data[31] || ''); // col AF
    const previousExperience= displayValue(leadRow.data[32] || ''); // col AG

    // Determine brief tier
    // Tier 1: company + show only (no size/budget) — run with assumptions
    // Tier 2: + size + budget — standard 2-concept brief
    // Tier 3: + standType — renders-ready with spatial constraints
    let tier: 1 | 2 | 3 = 1;
    if (standSize && budget) tier = 2;
    if (tier === 2 && standType) tier = 3;

    // If Tier 1 (no show), we can still proceed but with more assumptions
    // Only hard-block if we have NO show name at all
    if (!showName) {
      const contactEmail = leadRow.data[4];
      if (contactEmail) {
        const emailDraft = await generateText(
          `Draft a short email to ${leadRow.data[3] || 'the client'} at ${companyName} ` +
          `asking which show they are exhibiting at. ` +
          `Rules: NO "I hope this email finds you well", NO dashes, max 4 lines, ` +
          `direct hook, one CTA. Subject: short + specific.`,
          'You write concise business emails. No fluff.',
          200
        );
        await sendToMo(formatType1(
          `Info Request for ${companyName}`,
          'Missing: show name',
          `Draft email to ${contactEmail}:\n\n${emailDraft}`,
          `brief_email_${leadId}`
        ));
        if (leadId) pipelineRunner.block(leadId, 'Missing show name for brief');
        await this.respond(ctx.chatId,
          `⚠️ No show name for *${companyName}* — info request drafted for Mo.\n` +
          `Pipeline blocked until show is confirmed. Add it with:\n` +
          `\`/updatelead ${companyName} | showName=Arab Health\``
        );
        return { success: true, message: 'Info request drafted for show name', confidence: 'MEDIUM' };
      } else {
        await this.respond(ctx.chatId, `No show name and no contact email for "${companyName}". Can't proceed.`);
        if (leadId) pipelineRunner.block(leadId, 'Missing show name, no contact email');
        return { success: false, message: 'Missing show name, no email', confidence: 'LOW' };
      }
    }

    // Notify Mo of the tier being used
    const tierNote = tier === 1
      ? `⚠️ Running Tier 1 brief (show only — no size/budget). Fields will be assumed.`
      : tier === 2
      ? `Running Tier 2 brief (size + budget confirmed).`
      : `Running Tier 3 brief (stand type confirmed — renders-ready).`;
    await this.respond(ctx.chatId, `${tierNote}\nGenerating concept brief for *${companyName}*...`);

    // Get lessons learned from both the sheet and the Knowledge Base
    let lessonsContext = '';
    try {
      const lessons = await readSheet(SHEETS.LESSONS_LEARNED);
      const relevantLessons = lessons.filter(row =>
        (row[2] || '').toLowerCase().includes(showName.toLowerCase()) ||
        (row[3] || '').toLowerCase().includes(industry.toLowerCase())
      );
      if (relevantLessons.length > 0) {
        lessonsContext = relevantLessons.map(r => `${r[7] || ''} ${r[8] || ''}`).join('\n').substring(0, 500);
      }
    } catch { /* lessons are optional */ }

    // Enrich with Knowledge Base — scoped to this company to prevent cross-client data mixing
    const kbEntries = await searchKnowledgeForCompany(
      companyName,
      `${showName} ${industry} brief design stand`,
      leadId || undefined
    );
    if (kbEntries.length > 0) {
      const kbContext = kbEntries.map(e =>
        `[${e.sourceType.toUpperCase()} | ${e.topic}] ${e.content}`
      ).join('\n');
      lessonsContext = `${lessonsContext}\n\nKNOWLEDGE BASE CONTEXT:\n${kbContext}`.trim();
    }

    const briefContent = await generateBrief({
      clientName: companyName,
      showName,
      showCity,
      standSize,
      budget,
      industry,
      tier,
      standType: standType || undefined,
      openSides: openSides || undefined,
      mainGoal: mainGoal || undefined,
      staffCount: staffCount || undefined,
      mustHaveElements: mustHaveElements || undefined,
      brandColours: brandColours || undefined,
      previousExperience: previousExperience || undefined,
      lessonsLearned: lessonsContext,
    });

    // Route to /01_Sales/Proposals in the canonical folder tree
    const briefFolderId = getFolderIdForCategory('brief');

    // Create Google Doc inside that subfolder
    const doc = await createGoogleDoc(
      `Concept Brief — ${companyName} — ${showName}`,
      briefContent,
      briefFolderId
    );

    // Log to Drive Index so the team can find it
    await appendRow(SHEETS.DRIVE_INDEX, objectToRow(SHEETS.DRIVE_INDEX, {
      fileName: `Concept Brief — ${companyName} — ${showName}`,
      fileId: doc.id,
      fileUrl: doc.url,
      folderPath: '/01_Sales/Proposals',
      parentFolder: briefFolderId,
      fileType: 'Google Doc',
      lastModified: new Date().toISOString(),
      linkedProject: companyName,
      category: 'Concept Brief',
    })).catch(() => {});

    // Save brief to Knowledge Base — future briefs and emails benefit from this
    await saveKnowledge({
      source: doc.url,
      sourceType: 'drive',
      topic: companyName,
      tags: `brief,concept,${showName.toLowerCase().replace(/\s+/g, '-')},${(industry || '').toLowerCase()},design`,
      content: `Concept brief for ${companyName} at ${showName}. ${standSize}sqm, budget ${budget}. Key concepts: ${briefContent.slice(200, 600)}`,
    });

    // Send to Mo for approval
    await sendToMo(formatType1(
      `Concept Brief: ${companyName}`,
      `${showName} | ${standSize} sqm`,
      `Brief ready for review:\n${doc.url}\n\n${briefContent.substring(0, 500)}...`,
      `brief_${leadRow.data[0]}`
    ));

    // Comment on Trello card
    if (trelloCardId) {
      await addComment(trelloCardId, `BRIEF COMPLETE — ${doc.url} — ${new Date().toISOString().split('T')[0]}`);
    }

    // Alert team
    const hadeerTgId = process.env.HADEER_TELEGRAM_ID || '';
    if (hadeerTgId) {
      await sendToTeam(
        formatType2('Brief Complete', `Brief complete for ${companyName}. Human step: mirror to Design board.`),
        [hadeerTgId]
      );
    }

    // Save brief tier to LEAD_MASTER col AH
    await updateCell(SHEETS.LEAD_MASTER, leadRow.row, 'AH', `TIER${tier}`).catch(() => {});
    // Mark renders as ready if Tier 3
    if (tier === 3) {
      await updateCell(SHEETS.LEAD_MASTER, leadRow.row, 'AI', 'READY').catch(() => {});
    }

    const tierSuffix = tier === 1
      ? '\n\n⚠️ This is a Tier 1 brief — assumptions are marked [ASSUMED]. Update with `/updatelead` once size and budget are confirmed.'
      : tier === 3
      ? '\n\n📸 Tier 3 brief — stand type confirmed. Render prompts are in the doc. Run `/renders ' + companyName + '` to queue render generation.'
      : '';

    await this.respond(ctx.chatId, `✅ Brief generated for *${companyName}* (Tier ${tier}).\nDoc: ${doc.url}${tierSuffix}`);

    // Advance pipeline — degraded if Tier 1 (ran with assumptions)
    if (leadId) {
      if (tier === 1) {
        pipelineRunner.markDegraded(leadId, { docUrl: doc.url, briefTier: tier, briefGeneratedAt: new Date().toISOString() });
      } else {
        pipelineRunner.advance(leadId, { docUrl: doc.url, briefTier: tier, briefGeneratedAt: new Date().toISOString() });
      }
    }

    return {
      success: true,
      message: `Brief created for ${companyName} (Tier ${tier})`,
      confidence: tier === 1 ? 'MEDIUM' : 'HIGH',
      data: { docUrl: doc.url, briefTier: tier },
    };
  }

  /** Fuzzy lead search: partial substring + word-level match across company name (col C) */
  private async fuzzyFindLead(search: string): Promise<{ row: number; data: string[] } | null> {
    try {
      const rows = await readSheet(SHEETS.LEAD_MASTER);
      const q = search.toLowerCase();
      const words = q.split(/\s+/).filter(w => w.length > 2);

      // Pass 1: partial substring match on company name
      for (let i = 1; i < rows.length; i++) {
        const name = (rows[i][2] || '').toLowerCase();
        if (name && name.includes(q)) return { row: i + 1, data: rows[i] };
      }
      // Pass 2: word-level match — any search word appears in company name
      for (let i = 1; i < rows.length; i++) {
        const name = (rows[i][2] || '').toLowerCase();
        if (name && words.some(w => name.includes(w))) return { row: i + 1, data: rows[i] };
      }
    } catch { /* non-fatal */ }
    return null;
  }
}
