import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { readSheet, findRowByValue, appendRow, objectToRow, updateCell } from '../services/google/sheets';
import { addComment, getBoardCardsWithListNames } from '../services/trello/client';
import { createGoogleDoc, uploadBase64ImageToDrive } from '../services/google/drive';
import { getFolderIdForCategory } from '../config/drive-folders';
import { generateBrief, generateText } from '../services/ai/client';
import { saveKnowledge, buildKnowledgeContext, searchKnowledgeForCompany } from '../services/knowledge';
import { sendToMo, formatType1, formatType2, sendToTeam } from '../services/telegram/bot';
import { pipelineRunner } from '../services/pipeline-runner';
import { displayValue } from '../utils/confidence';
import { generateMasterImage, changeCameraAngle, isFreepikConfigured } from '../services/freepik';
import { logger } from '../utils/logger';
import axios from 'axios';

export class ConceptBriefAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'AI Concept Brief Generator',
    id: 'agent-03',
    description: 'Generate research-backed design briefs',
    commands: ['/brief', '/renders'],
    requiredRole: UserRole.OPS_LEAD,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    if (ctx.command === '/renders') return this.generateConceptRenders(ctx);
    return this.runBrief(ctx);
  }

  // ─── /renders [company] — generate 8 AI renders via Freepik API ─────────
  private async generateConceptRenders(ctx: AgentContext): Promise<AgentResponse> {
    // 1. Validate inputs
    const company = (ctx.args || '').trim();
    if (!company) {
      await this.respond(ctx.chatId,
        'Usage: `/renders [company name]`\n\n' +
        'Generates 2 concepts × 4 camera angles = 8 images automatically via Freepik AI.'
      );
      return { success: false, message: 'No company specified', confidence: 'LOW' };
    }

    if (!isFreepikConfigured()) {
      await this.respond(ctx.chatId,
        '⚠️ *FREEPIK_API_KEY not set.*\n\n' +
        'Get your API key at freepik.com → API section, then add it to Railway Variables as `FREEPIK_API_KEY`.'
      );
      return { success: false, message: 'FREEPIK_API_KEY not configured', confidence: 'HIGH' };
    }

    // 2. Find lead
    const leadRow = await this.fuzzyFindLead(company);
    if (!leadRow) {
      await this.respond(ctx.chatId, `Lead "${company}" not found in the system.`);
      return { success: false, message: 'Lead not found', confidence: 'HIGH' };
    }

    const companyName  = leadRow.data[2];
    const trelloCardId = leadRow.data[16];
    const leadId       = leadRow.data[0];
    const standType    = displayValue(leadRow.data[26] || '');
    const standSize    = displayValue(leadRow.data[8]  || '');
    const showName     = displayValue(leadRow.data[6]  || '');

    // 3. Build prompts — try KB first, fall back to lead data
    let promptA = '';
    let promptB = '';

    try {
      const kbEntries = await searchKnowledgeForCompany(companyName, 'brief freepik render', leadId || undefined);
      const kbText = kbEntries.map(e => e.content).join('\n');
      const matchA = kbText.match(/FREEPIK_PROMPT_A:\s*(.+?)(?=FREEPIK_PROMPT_B:|$)/s);
      const matchB = kbText.match(/FREEPIK_PROMPT_B:\s*(.+?)$/s);
      if (matchA) promptA = matchA[1].trim();
      if (matchB) promptB = matchB[1].trim();
    } catch { /* non-fatal — use fallback */ }

    if (!promptA || !promptB) {
      const sType = standType || 'island';
      const size  = standSize || '60';
      const show  = showName  || 'trade show';
      const base  = `Exhibition stand for ${companyName} at ${show}, ${sType} stand, ${size}sqm, ` +
        `premium materials, photorealistic architectural render, busy trade show floor, ` +
        `people in background for scale, 8K quality`;
      promptA = `${base}, clean minimal design, white and glass, modern and elegant`;
      promptB = `${base}, bold dark materials, strong brand statement, dramatic lighting`;
    }

    // 4. Camera angles — chosen for exhibition stands
    // Each angle shows how a trade show visitor would naturally see the stand
    const ANGLES = [
      { label: 'front',    h: 0,   v: 10, z: 5 },  // straight on, eye level
      { label: 'corner',   h: 40,  v: 20, z: 4 },  // 40° side — best reveals depth
      { label: 'elevated', h: 20,  v: 50, z: 5 },  // bird's eye, shows floor plan
      { label: 'approach', h: 330, v: 5,  z: 3 },  // wide approaching shot, drama
    ];

    // 5. Get target folder
    const folderId = getFolderIdForCategory('brief') || '';

    // 6. Announce start
    await this.respond(ctx.chatId,
      `🎨 Generating renders for *${companyName}*...\n` +
      `2 concepts × 4 angles = 8 images. Takes ~4 minutes.`
    );

    const results: Array<{ concept: string; angle: string; url: string }> = [];
    const errors:  string[] = [];

    // 7. Loop over both concepts
    for (const { prompt, label } of [
      { prompt: promptA, label: 'A' },
      { prompt: promptB, label: 'B' },
    ]) {
      // Generate master image
      let base64: string            = '';
      let cdnUrl: string            = '';
      let seed:   number | undefined;
      try {
        await this.respond(ctx.chatId, `⏳ Concept ${label}: generating master image...`);
        ({ base64, cdnUrl, seed } = await generateMasterImage(prompt));
      } catch (err: any) {
        errors.push(`Concept ${label} master: ${err.message}`);
        continue; // skip to next concept
      }

      // Upload master to Drive when we have base64 (text-to-image path).
      // Mystic returns cdnUrl only (base64 is ''), so skip Drive upload and
      // use cdnUrl directly — avoids uploading an empty/corrupt file.
      let masterUrl = '';
      if (base64) {
        try {
          const { publicUrl } = await uploadBase64ImageToDrive(
            base64,
            `${companyName}-concept-${label}-master.jpg`,
            folderId || undefined,
          );
          masterUrl = publicUrl;
          results.push({ concept: label, angle: 'master', url: masterUrl });
        } catch (err: any) {
          errors.push(`Concept ${label} master upload: ${err.message}`);
          continue;
        }
      } else if (cdnUrl) {
        // Mystic: CDN URL is the master — no Drive upload needed
        masterUrl = cdnUrl;
        results.push({ concept: label, angle: 'master', url: masterUrl });
      } else {
        errors.push(`Concept ${label} master: no image data returned`);
        continue;
      }

      await this.respond(ctx.chatId, `✅ Concept ${label} master done. Generating 3 angles...`);

      // image-change-camera only accepts public HTTPS URLs — never base64.
      // Prefer Freepik's own CDN URL (returned by text-to-image when available) —
      // their servers can always fetch their own CDN. Fall back to the Drive lh3
      // URL if cdnUrl is empty (Classic plan returns base64 only, no cdnUrl).
      const imageForFreepik = cdnUrl || masterUrl;

      // Run the 3 non-front angles in parallel via Promise.allSettled
      const freepikApiKey = process.env.FREEPIK_API_KEY || '';
      const angleSettled = await Promise.allSettled(
        ANGLES.slice(1).map(async (angle) => {
          const { url: freepikUrl } = await changeCameraAngle(
            imageForFreepik, angle.h, angle.v, angle.z, seed,
          );
          // Re-download from Freepik CDN and re-upload to Drive for permanent URLs
          logger.info(`[ConceptBrief] Downloading angle ${angle.label}: ${freepikUrl.slice(0, 80)}`);
          const imgResp = await axios.get<ArrayBuffer>(freepikUrl, {
            responseType: 'arraybuffer',
            timeout: 30_000,
            // Freepik CDN may require the API key header
            headers: freepikApiKey ? { 'x-freepik-api-key': freepikApiKey } : {},
          });
          logger.info(`[ConceptBrief] Downloaded angle ${angle.label}: ${imgResp.data.byteLength} bytes`);
          const b64 = Buffer.from(imgResp.data).toString('base64');
          const { publicUrl } = await uploadBase64ImageToDrive(
            b64,
            `${companyName}-concept-${label}-${angle.label}.jpg`,
            folderId || undefined,
          );
          return { concept: label, angle: angle.label, url: publicUrl };
        }),
      );

      const nonFrontAngles = ANGLES.slice(1);
      for (let i = 0; i < angleSettled.length; i++) {
        const settled = angleSettled[i];
        if (settled.status === 'fulfilled') {
          results.push(settled.value);
        } else {
          const errMsg = settled.reason?.message ?? String(settled.reason);
          logger.error(`[ConceptBrief] Angle render failed — Concept ${label} ${nonFrontAngles[i].label}: ${errMsg}`);
          errors.push(`Concept ${label} ${nonFrontAngles[i].label}: ${errMsg}`);
        }
      }
    }

    // 8. If zero images generated, return failure
    if (results.length === 0) {
      await this.respond(ctx.chatId,
        `❌ All render attempts failed for *${companyName}*.\n\n` +
        errors.map(e => `• ${e}`).join('\n')
      );
      return { success: false, message: 'All Freepik calls failed', confidence: 'HIGH' };
    }

    // 9. Build folder URL
    const driveUrl = folderId
      ? `https://drive.google.com/drive/folders/${folderId}`
      : 'https://drive.google.com';

    // 10. Post Trello comment
    if (trelloCardId) {
      const conceptA = results.filter(r => r.concept === 'A');
      const conceptB = results.filter(r => r.concept === 'B');
      const fmt = (arr: typeof results) =>
        arr.map(r => `• ${r.angle}: ${r.url}`).join('\n');
      await addComment(
        trelloCardId,
        `🎨 AI Renders — ${companyName}\n\n` +
        `CONCEPT A\n${fmt(conceptA)}\n\n` +
        `CONCEPT B\n${fmt(conceptB)}\n\n` +
        `Drive folder: ${driveUrl}`,
      ).catch(() => { /* non-fatal */ });
    }

    // 11. Update LEAD_MASTER cols AI + AJ
    await updateCell(SHEETS.LEAD_MASTER, leadRow.row, 'AI', 'true').catch(() => {});
    await updateCell(SHEETS.LEAD_MASTER, leadRow.row, 'AJ', driveUrl).catch(() => {});

    // 12. Save to Knowledge Base
    await saveKnowledge({
      source: `renders-${leadId}`,
      sourceType: 'drive',
      topic: companyName,
      tags: `renders,freepik,${companyName.toLowerCase().replace(/\s+/g, '-')}`,
      content: `${results.length} AI renders generated for ${companyName}. Drive folder: ${driveUrl}`,
    }).catch(() => {});

    // 13. Advance pipeline
    if (leadId) {
      pipelineRunner.advance(leadId, {
        rendersGenerated: 'true',
        rendersDriveUrl: driveUrl,
      });
    }

    // 14. Final confirmation
    const errorNote = errors.length > 0
      ? `\n⚠️ ${errors.length} image(s) failed:\n${errors.map(e => `• ${e}`).join('\n')}`
      : '';
    await this.respond(ctx.chatId,
      `✅ *Renders done: ${companyName}*\n` +
      `Generated: ${results.length}/8 images${errorNote}\n\n` +
      `📁 Drive: ${driveUrl}\n` +
      (trelloCardId ? `🃏 Posted to Trello card\n` : '') +
      `\nNext: design team reviews → apply StandMe branding → send to client`
    );

    return {
      success: true,
      message: `${results.length} renders generated for ${companyName}`,
      confidence: 'HIGH',
      data: { rendersDriveUrl: driveUrl, count: results.length },
    };
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
      content: (() => {
        const intro = briefContent.slice(0, 500);
        const freepikLines = (briefContent.match(/FREEPIK_PROMPT_[AB]:[^\n]+/g) ?? []).join('\n');
        return `Concept brief for ${companyName} at ${showName}. ${standSize}sqm, budget ${budget}.\n${intro}\n\n${freepikLines}`.slice(0, 2000);
      })(),
    });

    // Send to Mo for approval
    await sendToMo(formatType1(
      `Concept Brief: ${companyName}`,
      `${showName} | ${standSize} sqm`,
      `Brief ready for review:\n${doc.url}\n\n${briefContent.substring(0, 500)}...`,
      `brief_${leadRow.data[0]}`
    ));

    // Comment on Trello card — resolve card ID if missing from sheet
    let resolvedCardId = trelloCardId;
    if (!resolvedCardId) {
      try {
        const boardId = process.env.TRELLO_BOARD_SALES_PIPELINE || '';
        if (boardId) {
          const cards = await getBoardCardsWithListNames(boardId);
          const match = cards.find(c =>
            (leadId && c.name.includes(leadId)) ||
            c.name.toLowerCase().includes(companyName.toLowerCase())
          );
          if (match) {
            resolvedCardId = match.id;
            // Write back to sheet so next time it's available immediately
            await updateCell(SHEETS.LEAD_MASTER, leadRow.row, 'Q', resolvedCardId).catch(() => {});
          }
        }
      } catch { /* non-fatal — comment is a nice-to-have */ }
    }
    if (resolvedCardId) {
      await addComment(resolvedCardId, `BRIEF COMPLETE — ${doc.url} — ${new Date().toISOString().split('T')[0]}`).catch(() => {});
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
