import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { readSheet, updateCell, appendRow, objectToRow } from '../services/google/sheets';
import { addProspectToCampaign, addProspectsToCampaign, getCampaignStats, listCampaigns, WoodpeckerProspect } from '../services/woodpecker/client';
import { findExhibitorFiles, parseExhibitorFile } from '../services/drive-exhibitor';
import { validateShow } from '../config/shows';
import { generateOutreachEmail, generateText } from '../services/ai/client';
import { saveKnowledge, buildKnowledgeContext } from '../services/knowledge';
import { registerApproval } from '../services/approvals';
import { sendToMo, formatType1, formatType2 } from '../services/telegram/bot';
import { logger } from '../utils/logger';

export class OutreachAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Automated Outreach Sender',
    id: 'agent-13',
    description: 'Run personalised outreach sequences via Woodpecker',
    commands: ['/outreach', '/outreachstatus', '/campaigns', '/bulkoutreach', '/importleads'],
    requiredRole: UserRole.ADMIN,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    if (ctx.command === '/outreachstatus') return this.showStatus(ctx);
    if (ctx.command === '/campaigns') return this.showCampaigns(ctx);
    if (ctx.command === '/bulkoutreach') return this.runBulkOutreach(ctx);
    if (ctx.command === '/importleads') return this.runImportLeads(ctx);
    return this.runOutreach(ctx);
  }

  // ---- Auto-sync LEAD_MASTER → OUTREACH_QUEUE ----
  // Finds enriched leads with a known DM email that are not yet in the queue
  // and adds them automatically. Runs at the start of every /outreach call.

  private async syncLeadMasterToQueue(): Promise<number> {
    let added = 0;
    try {
      const [masterRows, queueRows] = await Promise.all([
        readSheet(SHEETS.LEAD_MASTER),
        readSheet(SHEETS.OUTREACH_QUEUE),
      ]);

      // Build set of leadIds already in queue (any status) to avoid duplicates
      const queuedLeadIds = new Set(queueRows.slice(1).map(r => r[1]).filter(Boolean));

      for (let i = 1; i < masterRows.length; i++) {
        const r = masterRows[i];
        const leadId       = r[0];   // A = id
        const email        = r[21];  // V = dmEmail
        const enrichStatus = r[17];  // R = enrichmentStatus
        const score        = parseInt(r[12] || '0'); // M = score

        // Only pull enriched leads with an email address, score 6+, not already queued
        if (!leadId || !email || enrichStatus !== 'ENRICHED' || score < 6) continue;
        if (queuedLeadIds.has(leadId)) continue;

        await appendRow(SHEETS.OUTREACH_QUEUE, objectToRow(SHEETS.OUTREACH_QUEUE, {
          id:             `OQ-${Date.now()}-${i}`,
          leadId,
          companyName:    r[2]  || '',  // C = companyName
          dmName:         r[18] || '',  // S = dmName
          dmEmail:        email,
          showName:       r[6]  || '',  // G = showName
          readinessScore: r[22] || '6', // W = outreachReadiness
          sequenceStatus: 'READY',
          addedDate: new Date().toISOString(),
          lastAction: '',
        }));

        queuedLeadIds.add(leadId);
        added++;
      }
    } catch (err: any) {
      logger.warn(`[Outreach] syncLeadMasterToQueue failed: ${err.message}`);
    }
    return added;
  }

  // ---- /outreach — draft + send to Mo for approval, then push to Woodpecker ----

  private async runOutreach(ctx: AgentContext): Promise<AgentResponse> {
    // Auto-source enriched leads with emails from LEAD_MASTER into the queue
    const synced = await this.syncLeadMasterToQueue();
    if (synced > 0) {
      await this.respond(ctx.chatId, `📥 Auto-queued *${synced}* enriched lead(s) from Lead Master.`);
    }

    const queue = await readSheet(SHEETS.OUTREACH_QUEUE);
    // Preserve sheet row indices (1-based, +2 = skip header row) so we can mark as SENT after push
    const ready = queue.slice(1)
      .map((r, i) => ({ row: r, sheetRowIndex: i + 2 }))
      .filter(({ row: r }) => r[7] === 'READY' && parseInt(r[6] || '0') >= 6);

    if (ready.length === 0) {
      await this.respond(ctx.chatId, 'No leads ready for outreach (score 6+ and status READY).');
      return { success: true, message: 'No leads ready', confidence: 'HIGH' };
    }

    // Auto-resolve campaign: use env override, or auto-pick the active campaign
    const campaignId = await this.resolveCampaignId(ctx, ctx.args);
    if (!campaignId) return { success: false, message: 'No campaign resolved', confidence: 'LOW' };

    // Read LEAD_MASTER once to get dmTitle and notes (website/country) for each lead
    // Snippet schema: snippet1 = industry hook, snippet2 = DM job title, snippet3 = website/country
    const masterRows = await readSheet(SHEETS.LEAD_MASTER).catch(() => [] as string[][]);
    const masterById = new Map<string, string[]>();
    for (const row of masterRows.slice(1)) {
      if (row[0]) masterById.set(row[0], row);
    }

    // Industry hook cache — one AI call per unique industry, not per company
    const industryHooks = new Map<string, string>();
    const getHook = async (industry: string, show: string): Promise<string> => {
      const key = JSON.stringify([industry.toLowerCase(), show.toLowerCase()]);
      if (industryHooks.has(key)) return industryHooks.get(key)!;
      const hook = await generateText(
        `Write ONE cold email opening sentence (max 20 words) for a ${industry} company exhibiting at ${show}. ` +
        `Be specific about what this industry cares about. No em dashes. No filler.`,
        'Return only the sentence, nothing else.', 60,
      ).catch(() => '');
      industryHooks.set(key, hook.trim());
      return hook.trim();
    };

    let drafted = 0;
    let skippedNoEmail = 0;

    for (const { row: lead, sheetRowIndex } of ready.slice(0, 5)) {
      const leadId    = lead[0] || '';
      const masterRef = lead[1] || '';  // LEAD_MASTER id
      const company   = lead[2] || '';
      const dmName    = lead[3] || '';
      const dmEmail   = lead[4] || '';
      const showName  = lead[5] || '';

      if (!dmEmail) {
        skippedNoEmail++;
        logger.info(`[Outreach] Skipping ${company} — no DM email in OUTREACH_QUEUE. Run /enrich to find emails.`);
        continue;
      }

      // Enrich snippet data from LEAD_MASTER row
      const masterRow  = masterById.get(masterRef) || [];
      const dmTitle    = masterRow[19] || masterRow[5] || '';  // dmTitle (T) or contactTitle (F)
      const industry   = masterRow[10] || '';
      const notes      = masterRow[24] || '';
      const websiteM   = notes.match(/Website:\s*([^|]+)/i);
      const countryM   = notes.match(/Country:\s*([^|]+)/i);
      const website    = websiteM ? websiteM[1].trim() : '';
      const country    = countryM ? countryM[1].trim() : '';
      const snippet3   = website || country || '';
      const snippet1   = industry ? await getHook(industry, showName) : '';
      const snippet2   = dmTitle;

      // Pull context from Knowledge Base — company history, show intel, past email patterns
      const companyContext = await buildKnowledgeContext(`${company} ${showName} outreach email`);

      // Generate personalised email
      let email: { subject: string; body: string };
      try {
        email = await generateOutreachEmail({
          companyName: company,
          contactName: dmName,
          showName,
          industry: companyContext ? `(context: ${companyContext.slice(0, 200)})` : '',
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
      // first_name must never be empty — 'Team' is used when no DM name is known
      // so Woodpecker email templates render "Hi Team," rather than "Hi ,"
      const nameParts = (dmName || '').trim().split(' ').filter(Boolean);
      const prospect: WoodpeckerProspect = {
        email: dmEmail,
        first_name: nameParts[0] || 'Team',
        last_name: nameParts.slice(1).join(' ') || '',
        company,
        industry,
        // ── Consistent snippet schema ────────────────────────────────────────
        snippet1: snippet1 || industry,   // cold email opener (industry hook)
        snippet2: snippet2,               // DM job title
        snippet3: snippet3,               // company website or country
        // ────────────────────────────────────────────────────────────────────
        tags: `standme-outreach,${showName.toLowerCase().replace(/\s+/g, '-')}`,
      };

      // Save outreach attempt to KB
      await saveKnowledge({
        source: `outreach-${logId}`,
        sourceType: 'manual',
        topic: company,
        tags: `outreach,email,${showName.toLowerCase().replace(/\s+/g, '-')},pending`,
        content: `Outreach email drafted for ${company} (${dmEmail}) at ${showName}. Subject: ${email.subject}. Body preview: ${email.body.slice(0, 200)}`,
      }).catch(() => { /* non-blocking */ });

      // Register approval callback — this fires when Mo types /approve_outreach_xxx
      const approvalId = `outreach_${leadId}`;
      registerApproval(approvalId, {
        action: `Send outreach to ${company} (${dmEmail})`,
        data: { prospect, campaignId, logId, company, dmEmail },
        timestamp: Date.now(),
        onApprove: async () => {
          try {
            const wpId = await addProspectToCampaign(campaignId, prospect);
            // Update outreach log
            await this.updateLogStatus(logId, 'SENT', wpId?.toString() || '');
            // Mark OUTREACH_QUEUE row as SENT so /outreach won't draft this lead again
            await updateCell(SHEETS.OUTREACH_QUEUE, sheetRowIndex, 'H', 'SENT').catch((err: any) => {
              logger.warn(`[Outreach] Failed to mark OUTREACH_QUEUE row ${sheetRowIndex} as SENT: ${err.message}. Lead may be re-drafted on next /outreach run.`);
            });
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

    let msg = `📧 *${drafted}* outreach draft(s) sent to Mo for approval.\n\nMo approves with /approve\\_outreach\\_[leadId] or rejects with /reject\\_outreach\\_[leadId].`;
    if (skippedNoEmail > 0) {
      msg += `\n\n⚠️ *${skippedNoEmail}* lead(s) skipped — no email address found. Run /enrich to find DM emails before outreach.`;
    }
    await this.respond(ctx.chatId, msg);
    return { success: true, message: `${drafted} outreach emails drafted`, confidence: 'HIGH' };
  }

  // ---- /importleads [show name] — import exhibitor leads from Drive files into LEAD_MASTER ----
  // Reads Excel / CSV / Google Sheets from the exhibitor Drive folder, normalises columns
  // with Claude AI (via parseExhibitorFile), deduplicates against LEAD_MASTER, and appends
  // new leads. Writes the email to BOTH contactEmail (col E) and dmEmail (col V) so
  // /bulkoutreach finds it immediately without needing enrichment first.

  private async runImportLeads(ctx: AgentContext): Promise<AgentResponse> {
    const showName = (ctx.args || '').trim();
    if (!showName) {
      await this.respond(ctx.chatId,
        'Usage: `/importleads [show name]`\nExample: `/importleads intersolar`\n\n' +
        'Finds all matching exhibitor files in Google Drive and imports them into Lead Master.'
      );
      return { success: false, message: 'No show name', confidence: 'HIGH' };
    }

    await this.respond(ctx.chatId, `🔍 Searching Google Drive for *${showName}* exhibitor files...`);

    // 1. Find Drive files matching the show name
    let files: Awaited<ReturnType<typeof findExhibitorFiles>> = [];
    try {
      files = await findExhibitorFiles(showName);
    } catch (err: any) {
      await this.respond(ctx.chatId, `⚠️ Could not search Drive: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }

    if (files.length === 0) {
      await this.respond(ctx.chatId,
        `No exhibitor files found for "*${showName}*" in Google Drive.\n\n` +
        `Files must be in the exhibitor folder and named after the show ` +
        `(e.g. "Intersolar 2026.xlsx"). Check Drive and try again.`
      );
      return { success: false, message: 'No files found', confidence: 'HIGH' };
    }

    await this.respond(ctx.chatId, `📂 Found *${files.length}* file(s). Parsing exhibitor data...`);

    // 2. Parse all files → ExhibitorRecord[]
    const allRecords: Awaited<ReturnType<typeof parseExhibitorFile>> = [];
    for (const file of files) {
      try {
        const records = await parseExhibitorFile(file);
        allRecords.push(...records);
        logger.info(`[ImportLeads] Parsed ${records.length} records from "${file.name}"`);
      } catch (err: any) {
        logger.warn(`[ImportLeads] Failed to parse "${file.name}": ${err.message}`);
      }
    }

    if (allRecords.length === 0) {
      await this.respond(ctx.chatId,
        `Found the file(s) but could not extract any records. ` +
        `Make sure the file has a header row with company names and emails.`
      );
      return { success: false, message: 'No records parsed', confidence: 'HIGH' };
    }

    // 3. Read LEAD_MASTER → build dedup sets
    const masterRows = await readSheet(SHEETS.LEAD_MASTER).catch(() => [] as string[][]);
    const existingEmails    = new Set(masterRows.slice(1).map(r => (r[21] || r[4] || '').toLowerCase()).filter(Boolean));
    const existingCompanies = new Set(masterRows.slice(1).map(r => (r[2]  || '').toLowerCase().trim()).filter(Boolean));

    // 4. Score and validate show
    const showValidation = validateShow(showName);

    // 5. Import new records
    let imported = 0;
    let skipped  = 0;

    for (let i = 0; i < allRecords.length; i++) {
      const rec = allRecords[i];
      const companyName = (rec.companyName || '').trim();
      if (!companyName) { skipped++; continue; }

      const email = (rec.contactEmail || '').trim().toLowerCase();

      // Dedup: skip if email OR company name already exists
      if (email && existingEmails.has(email)) { skipped++; continue; }
      if (existingCompanies.has(companyName.toLowerCase())) { skipped++; continue; }

      // Scoring
      const industry = (rec.industry || '').toLowerCase();
      const coreIndustries = ['solar', 'energy', 'medical', 'healthcare', 'food', 'packaging', 'technology', 'industrial'];
      const adjIndustries  = ['automotive', 'construction', 'pharma', 'agriculture', 'retail'];
      let industryFit = 0;
      if (coreIndustries.some(k => industry.includes(k))) industryFit = 2;
      else if (adjIndustries.some(k => industry.includes(k))) industryFit = 1;

      const dmSignal  = rec.contactTitle ? 1 : 0;
      const showFit   = showValidation.valid ? 2 : 1;
      const timeline  = 1;
      const score     = showFit + industryFit + dmSignal + timeline;
      const status    = score >= 8 ? 'HOT' : score >= 5 ? 'WARM' : score >= 3 ? 'COLD' : 'DISQUALIFIED';

      const leadId = `SM-${Date.now()}-${i}`;
      const notes  = [
        rec.boothNumber ? `Booth: ${rec.boothNumber}` : '',
        rec.website     ? `Website: ${rec.website}`   : '',
        rec.country     ? `Country: ${rec.country}`   : '',
        rec.phone       ? `Phone: ${rec.phone}`       : '',
      ].filter(Boolean).join(' | ');

      await appendRow(SHEETS.LEAD_MASTER, objectToRow(SHEETS.LEAD_MASTER, {
        id:               leadId,
        timestamp:        new Date().toISOString(),
        companyName:      companyName,
        contactName:      rec.contactName  || '',
        contactEmail:     email,                         // col E
        contactTitle:     rec.contactTitle || '',
        showName:         showValidation.match?.name || showName,
        showCity:         showValidation.match?.city || '',
        standSize:        '',
        budget:           '',
        industry:         rec.industry || '',
        leadSource:       'drive-import',
        score:            score.toString(),
        scoreBreakdown:   JSON.stringify({ showFit, sizeSignal: 0, industryFit, dmSignal, timeline }),
        confidence:       showValidation.confidence,
        status,
        trelloCardId:     '',
        enrichmentStatus: 'PENDING',
        dmName:           rec.contactName  || '',
        dmTitle:          rec.contactTitle || '',
        dmLinkedIn:       '',
        dmEmail:          email,                         // col V — written here so /bulkoutreach finds it
        outreachReadiness: email ? '7' : '3',
        language:         'en',
        notes,
      }));

      existingEmails.add(email || `_noemail_${leadId}`);
      existingCompanies.add(companyName.toLowerCase());
      imported++;

      // Throttle writes to avoid Sheets quota (100ms gap per row)
      if (imported % 50 === 0) {
        await this.respond(ctx.chatId, `⏳ Imported ${imported} so far...`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    const summary =
      `✅ *Import complete for ${showName}*\n\n` +
      `Imported: *${imported}* new leads\n` +
      `Skipped:  ${skipped} (already in Lead Master)\n\n` +
      `Next step: run \`/bulkoutreach ${showName}\` to push all leads to Woodpecker.`;

    await this.respond(ctx.chatId, summary);
    return { success: true, message: `Imported ${imported} leads for ${showName}`, confidence: 'HIGH' };
  }

  // ---- /bulkoutreach [show name] — bulk push all LEAD_MASTER leads for a show ----
  // Reads LEAD_MASTER, filters by show name, resolves the Woodpecker campaign by name,
  // sends Mo ONE approval for all leads, then bulk-pushes them all at once.
  // Uses dmEmail (col V) with contactEmail (col E) as fallback so imported leads work too.

  private async runBulkOutreach(ctx: AgentContext): Promise<AgentResponse> {
    const rawArgs = (ctx.args || '').trim();

    // Optional trailing campaign ID: /bulkoutreach intersolar 2429293
    const parts = rawArgs.split(/\s+/);
    const lastPart = parts[parts.length - 1];
    const trailingId = /^\d+$/.test(lastPart) ? parseInt(lastPart) : 0;
    const showFilter = (trailingId > 0 ? parts.slice(0, -1).join(' ') : rawArgs).toLowerCase().trim();

    if (!showFilter) {
      await this.respond(ctx.chatId,
        'Usage: `/bulkoutreach [show name]`\nExample: `/bulkoutreach intersolar`\n\n' +
        'Reads all leads for that show from Lead Master and pushes them to the matching Woodpecker campaign in one batch.'
      );
      return { success: false, message: 'No show name', confidence: 'HIGH' };
    }

    await this.respond(ctx.chatId, `🔍 Scanning Lead Master for *${showFilter}* leads...`);

    // 1. Read LEAD_MASTER
    const masterRows = await readSheet(SHEETS.LEAD_MASTER).catch(() => [] as string[][]);

    // Filter by show name — use BOTH dmEmail (V=21) and contactEmail (E=4) as email source
    const leads = masterRows.slice(1).filter(r => {
      const show  = (r[6] || '').toLowerCase(); // G = showName
      const email = r[21] || r[4];              // V = dmEmail, E = contactEmail (fallback)
      return show.includes(showFilter) && !!email;
    });

    if (leads.length === 0) {
      // Diagnose: are there leads for this show but without emails?
      const showOnly = masterRows.slice(1).filter(r => (r[6] || '').toLowerCase().includes(showFilter));
      if (showOnly.length > 0) {
        await this.respond(ctx.chatId,
          `⚠️ Found *${showOnly.length}* ${showFilter} leads in Lead Master but none have email addresses.\n\n` +
          `Check columns E (contactEmail) and V (dmEmail) in the Leads sheet — at least one must be filled.`
        );
      } else {
        await this.respond(ctx.chatId,
          `No leads found for "*${showFilter}*" in Lead Master.\n\n` +
          `Tip: The show name must match what's in column G of the Leads sheet (partial match, case-insensitive).`
        );
      }
      return { success: false, message: 'No leads found', confidence: 'HIGH' };
    }

    // 2. Resolve Woodpecker campaign
    let campaigns: { id: number; name: string; status: string }[] = [];
    try {
      campaigns = await listCampaigns();
    } catch (err: any) {
      await this.respond(ctx.chatId, `⚠️ Could not connect to Woodpecker: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }

    let campaignId: number;
    let campaignName: string;
    let campaignStatus: string;

    if (trailingId > 0) {
      // Explicit campaign ID provided
      const found = campaigns.find(c => c.id === trailingId);
      campaignId   = trailingId;
      campaignName = found?.name || `Campaign ${trailingId}`;
      campaignStatus = found?.status || 'UNKNOWN';
    } else {
      const matched = campaigns.filter(c => c.name.toLowerCase().includes(showFilter));
      if (matched.length === 0) {
        const all = campaigns.slice(0, 12).map(c => `  • *${c.name}* [${c.status}] — \`/bulkoutreach ${showFilter} ${c.id}\``).join('\n');
        await this.respond(ctx.chatId,
          `No Woodpecker campaign found matching "*${showFilter}*".\n\nAvailable campaigns:\n${all}\n\n` +
          `Run \`/bulkoutreach ${showFilter} [ID]\` to use a specific campaign.`
        );
        return { success: false, message: 'No campaign matched', confidence: 'HIGH' };
      }
      // Pick best: prefer RUNNING, then DRAFT, then first
      const chosen = matched.find(c => c.status.toUpperCase() === 'RUNNING')
                  || matched.find(c => c.status.toUpperCase() === 'DRAFT')
                  || matched[0];
      campaignId     = chosen.id;
      campaignName   = chosen.name;
      campaignStatus = chosen.status;

      if (matched.length > 1) {
        const others = matched.filter(c => c.id !== campaignId)
          .map(c => `  • *${c.name}* [${c.status}] → \`/bulkoutreach ${showFilter} ${c.id}\``).join('\n');
        await this.respond(ctx.chatId,
          `Using campaign: *${campaignName}* [${campaignStatus}]\nOther matches (use campaign ID to pick):\n${others}`
        );
      }
    }

    // 3. Pre-generate industry hooks (one AI call per unique industry, cached)
    const uniqueIndustries = [...new Set(leads.map(r => (r[10] || '').trim()).filter(Boolean))];
    await this.respond(ctx.chatId,
      `📋 Found *${leads.length}* ${showFilter} leads with emails.\n` +
      `Generating email hooks for ${uniqueIndustries.length} unique industries...`
    );

    const industryHooks = new Map<string, string>();
    await Promise.all(uniqueIndustries.map(async industry => {
      const key = industry.toLowerCase();
      const hook = await generateText(
        `Write ONE cold email opening sentence (max 20 words) for a ${industry} company exhibiting at a major trade show. ` +
        `Be specific to what this industry values on the show floor. No em dashes. No filler.`,
        'Return only the sentence, nothing else.', 60,
      ).catch(() => '');
      industryHooks.set(key, hook.trim());
    }));

    // 4. Build Woodpecker prospects array
    const prospects: WoodpeckerProspect[] = [];
    for (const r of leads) {
      const email      = r[21] || r[4]; // dmEmail (V) → contactEmail (E)
      if (!email) continue;

      const companyName = r[2]  || '';  // C = companyName
      const dmName      = r[18] || r[3] || ''; // S = dmName → D = contactName
      const dmTitle     = r[19] || r[5] || ''; // T = dmTitle → F = contactTitle
      const industry    = r[10] || '';  // K = industry
      const showName    = r[6]  || '';  // G = showName
      const notes       = r[24] || '';  // Y = notes
      const websiteM    = notes.match(/Website:\s*([^|]+)/i);
      const website     = websiteM ? websiteM[1].trim() : '';

      const nameParts = (dmName).trim().split(' ').filter(Boolean);
      const hook = industryHooks.get(industry.toLowerCase()) || '';

      prospects.push({
        email,
        first_name: nameParts[0] || 'Team',
        last_name:  nameParts.slice(1).join(' ') || '',
        company:    companyName,
        industry,
        snippet1:   hook || industry || 'your upcoming trade show stand',
        snippet2:   dmTitle,
        snippet3:   website,
        tags: `standme-outreach,${showName.toLowerCase().replace(/\s+/g, '-')},bulk`,
      });
    }

    // 5. Build approval message and register single bulk approval
    const approvalId = `bulkoutreach_${showFilter.replace(/\s+/g, '_')}_${Date.now()}`;
    const draftWarning = campaignStatus.toUpperCase() === 'DRAFT'
      ? '\n\n⚠️ *Campaign is DRAFT* — go to Woodpecker UI and set it to RUNNING so emails actually send.'
      : '';

    registerApproval(approvalId, {
      action: `Bulk push ${prospects.length} ${showFilter} leads to "${campaignName}"`,
      data: { prospects, campaignId, campaignName, showFilter },
      timestamp: Date.now(),
      onApprove: async () => {
        try {
          const ids   = await addProspectsToCampaign(campaignId, prospects);
          const sent  = ids.filter(id => id !== null).length;
          const failed = ids.length - sent;

          // Log batch to OUTREACH_LOG (one row per lead)
          const logDate = new Date().toISOString();
          for (const p of prospects) {
            await appendRow(SHEETS.OUTREACH_LOG, objectToRow(SHEETS.OUTREACH_LOG, {
              id:                 `OL-BULK-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
              leadId:             '',
              companyName:        p.company,
              emailType:          'BULK_EMAIL_1',
              sentDate:           logDate,
              status:             'SENT',
              replyClassification: '',
              woodpeckerId:       '',
              notes:              `Bulk → campaign ${campaignId} (${campaignName}) | ${showFilter}`,
            })).catch(() => {});
          }

          return (
            `✅ *Bulk push complete!*\n\n` +
            `Campaign: *${campaignName}* (ID: ${campaignId})\n` +
            `Pushed: *${sent}* leads\n` +
            (failed > 0 ? `Skipped: ${failed} (already in campaign or invalid email)\n` : '') +
            (campaignStatus.toUpperCase() === 'DRAFT'
              ? '\n⚠️ Campaign is DRAFT — set to RUNNING in Woodpecker for emails to go out.'
              : '\n📧 Emails will send per campaign schedule.')
          );
        } catch (err: any) {
          return `❌ Bulk push failed: ${err.message}`;
        }
      },
      onReject: async () => `Bulk outreach to *${campaignName}* cancelled.`,
    });

    await sendToMo(formatType1(
      `Bulk Outreach: ${leads.length} ${showFilter} leads`,
      `→ ${campaignName}`,
      `*${prospects.length}* leads ready to push.\n\n` +
      `Campaign: *${campaignName}* [${campaignStatus}]\n` +
      `Industries: ${uniqueIndustries.slice(0, 5).join(', ')}${uniqueIndustries.length > 5 ? ` +${uniqueIndustries.length - 5} more` : ''}` +
      draftWarning +
      `\n\nApprove to push all *${prospects.length}* leads at once.`,
      approvalId
    ));

    await this.respond(ctx.chatId,
      `📤 *Approval sent to Mo.*\n\n` +
      `*${prospects.length}* ${showFilter} leads ready for *${campaignName}*.\n` +
      `Mo approves with \`/approve\\_${approvalId}\` to push all at once.` +
      draftWarning
    );

    return { success: true, message: `Bulk outreach: ${prospects.length} leads pending approval`, confidence: 'HIGH' };
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
        sections.push(`*Woodpecker:* Could not fetch stats — ${err.message}`);
      }
    } else {
      // No campaign auto-resolved — try to list what's available so Mo can pick one
      try {
        const campaigns = await listCampaigns();
        if (campaigns.length === 0) {
          sections.push(`*Woodpecker:* No campaigns found. Create a campaign in Woodpecker first, then run /outreach.`);
        } else {
          const list = campaigns.map(c => `  • *${c.name}* [${c.status}] → \`/outreach ${c.id}\``).join('\n');
          sections.push(`*Woodpecker:* No active campaign selected. Available campaigns:\n\n${list}\n\nRun \`/outreach [ID]\` to use one, or set WOODPECKER\\_CAMPAIGN\\_ID in Railway to auto-select.`);
        }
      } catch (err: any) {
        sections.push(`*Woodpecker:* Could not connect — ${err.message}\n\nCheck that WOODPECKER\\_API\\_KEY is set in Railway env.`);
      }
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
    const fromArg = parseInt(args?.trim() || '0');
    if (fromArg > 0) return fromArg;

    // 2. Env var override
    const fromEnv = parseInt(process.env.WOODPECKER_CAMPAIGN_ID || '0');
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
