import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { readSheet, updateCell, updateRange, appendRow, appendRows, objectToRow } from '../services/google/sheets';
import {
  listCampaigns, getCampaign, createCampaign, findCampaignByName,
  setCampaignStatus, activateCampaign,
  addLeads, getReplies, getCampaignSummary, getAllCampaignSummaries,
  listAccounts, getDailyCapacity, testConnection, isInstantlyConfigured,
  campaignStatusLabel, CAMPAIGN_STATUS, sanitizeLead,
  InstantlyLead, InstantlyCampaign, InstantlyEmailStep,
} from '../services/instantly/client';
import { findExhibitorFiles, parseExhibitorFile } from '../services/drive-exhibitor';
import { validateShow } from '../config/shows';
import { generateOutreachEmail, generateText } from '../services/ai/client';
import { saveKnowledge, buildKnowledgeContext, searchKnowledge, getKnowledgeBySource, updateKnowledge } from '../services/knowledge';
import { registerApproval } from '../services/approvals';
import { pipelineRunner } from '../services/pipeline-runner';
import { sendToMo, formatType1, formatType2 } from '../services/telegram/bot';
import { logger } from '../utils/logger';
import { generateLeadId } from '../utils/lead-id';

export class OutreachAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Automated Outreach Sender',
    id: 'agent-13',
    description: 'Run personalised outreach sequences via Instantly.ai',
    commands: ['/outreach', '/outreachstatus', '/campaigns', '/bulkoutreach', '/importleads', '/instantlyverify', '/generateemails', '/replies', '/launch', '/convert'],
    requiredRole: UserRole.ADMIN,
    schedule: '0 9 * * 1', // Every Monday 9am — auto-push new leads to all active campaigns
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    if (ctx.command === '/outreachstatus')    return this.showStatus(ctx);
    if (ctx.command === '/campaigns')         return this.showCampaigns(ctx);
    if (ctx.command === '/bulkoutreach')      return this.runBulkOutreach(ctx);
    if (ctx.command === '/importleads')       return this.runImportLeads(ctx);
    if (ctx.command === '/instantlyverify')   return this.runInstantlyVerify(ctx);
    if (ctx.command === '/generateemails')    return this.runGenerateEmails(ctx);
    if (ctx.command === '/replies')           return this.showReplies(ctx);
    if (ctx.command === '/launch')            return this.runLaunch(ctx);
    if (ctx.command === '/convert')           return this.runConvert(ctx);
    return this.runOutreach(ctx);
  }

  // ── Scheduled: every Monday 9am — notify Mo of new leads ready to launch ──
  async runScheduled(): Promise<AgentResponse> {
    logger.info('[Outreach] Scheduled Monday briefing starting...');

    if (!isInstantlyConfigured()) {
      logger.warn('[Outreach] Monday briefing skipped: INSTANTLY_API_KEY not set');
      return { success: true, message: 'Briefing skipped: not configured', confidence: 'LOW' as any };
    }

    let campaigns: InstantlyCampaign[] = [];
    try {
      campaigns = await listCampaigns();
    } catch (err: any) {
      logger.warn(`[Outreach] Monday briefing: could not fetch campaigns: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' as any };
    }

    const activeCampaigns = campaigns.filter(c => c.status === CAMPAIGN_STATUS.ACTIVE);
    if (!activeCampaigns.length) {
      logger.info('[Outreach] Monday briefing: no ACTIVE campaigns.');
      return { success: true, message: 'No active campaigns', confidence: 'LOW' as any };
    }

    const [masterRows, logRows] = await Promise.all([
      readSheet(SHEETS.LEAD_MASTER).catch(() => [] as string[][]),
      readSheet(SHEETS.OUTREACH_LOG).catch(() => [] as string[][]),
    ]);

    const pushedEmails = new Set(
      logRows.slice(1).map(r => (r[4] || '').toLowerCase().trim()).filter(Boolean)
    );

    const sections: string[] = [];

    for (const campaign of activeCampaigns) {
      const showFilter = campaign.name.toLowerCase()
        .replace(/\s*\d{4}.*$/, '')
        .replace(/standme\s*(os)?/gi, '')
        .trim();

      if (!showFilter) continue;

      const newLeads = masterRows.slice(1).filter(r => {
        const rowShow = (r[6] || '').toLowerCase();
        if (!rowShow.includes(showFilter) && !showFilter.includes(rowShow.substring(0, 6))) return false;
        const email = (r[21] || r[4] || '').toLowerCase().trim();
        return email && email.includes('@') && !pushedEmails.has(email);
      });

      if (newLeads.length > 0) {
        sections.push(`  • *${campaign.name}*: ${newLeads.length} new leads → \`/launch ${showFilter}\``);
      }
    }

    if (sections.length > 0) {
      await sendToMo(formatType2(
        '📬 Monday Outreach Briefing',
        `New leads ready to push:\n\n${sections.join('\n')}\n\n` +
        `Run the \`/launch\` commands above when ready. Mo approves before any emails are sent.`
      ));
    } else {
      logger.info('[Outreach] Monday briefing: no new leads to push to active campaigns.');
    }

    return { success: true, message: sections.length > 0 ? 'Monday briefing sent' : 'No new leads', confidence: 'HIGH' as any };
  }

  // ── Auto-sync LEAD_MASTER → OUTREACH_QUEUE ────────────────────────────────

  private async syncLeadMasterToQueue(): Promise<number> {
    let added = 0;
    try {
      const [masterRows, queueRows] = await Promise.all([
        readSheet(SHEETS.LEAD_MASTER),
        readSheet(SHEETS.OUTREACH_QUEUE),
      ]);

      const queuedLeadIds = new Set(queueRows.slice(1).map(r => r[1]).filter(Boolean));

      for (let i = 1; i < masterRows.length; i++) {
        const r            = masterRows[i];
        const leadId       = r[0];
        const email        = r[21];
        const enrichStatus = r[17];
        const score        = parseInt(r[12] || '0');

        if (!leadId || !email || enrichStatus !== 'ENRICHED' || score < 6) continue;
        if (queuedLeadIds.has(leadId)) continue;

        await appendRow(SHEETS.OUTREACH_QUEUE, objectToRow(SHEETS.OUTREACH_QUEUE, {
          id:             `OQ-${Date.now()}-${i}`,
          leadId,
          companyName:    r[2]  || '',
          dmName:         r[18] || '',
          dmEmail:        email,
          showName:       r[6]  || '',
          readinessScore: r[22] || '6',
          sequenceStatus: 'READY',
          addedDate:      new Date().toISOString(),
          lastAction:     '',
        }));

        queuedLeadIds.add(leadId);
        added++;
      }
    } catch (err: any) {
      logger.warn(`[Outreach] syncLeadMasterToQueue failed: ${err.message}`);
    }
    return added;
  }

  // ── /outreach — draft + send to Mo for individual approval ────────────────

  private async runOutreach(ctx: AgentContext): Promise<AgentResponse> {
    if (!isInstantlyConfigured()) {
      await this.respond(ctx.chatId, '⚠️ INSTANTLY_API_KEY not set in Railway env. Add it to enable outreach.');
      return { success: false, message: 'Instantly not configured', confidence: 'HIGH' };
    }

    const synced = await this.syncLeadMasterToQueue();
    if (synced > 0) {
      await this.respond(ctx.chatId, `📥 Auto-queued *${synced}* enriched lead(s) from Lead Master.`);
    }

    const queue = await readSheet(SHEETS.OUTREACH_QUEUE);
    const ready = queue.slice(1)
      .map((r, i) => ({ row: r, sheetRowIndex: i + 2 }))
      .filter(({ row: r }) => r[7] === 'READY' && parseInt(r[6] || '0') >= 6);

    if (!ready.length) {
      await this.respond(ctx.chatId, 'No leads ready for outreach (score 6+ and status READY).');
      return { success: true, message: 'No leads ready', confidence: 'HIGH' };
    }

    // Resolve campaign
    const campaign = await this.resolveCampaign(ctx, ctx.args);
    if (!campaign) return { success: false, message: 'No campaign resolved', confidence: 'LOW' };

    const masterRows = await readSheet(SHEETS.LEAD_MASTER).catch(() => [] as string[][]);
    const masterById = new Map<string, string[]>();
    for (const row of masterRows.slice(1)) {
      if (row[0]) masterById.set(row[0], row);
    }

    const industryHooks = new Map<string, string>();
    const getHook = async (industry: string, show: string): Promise<string> => {
      const key = `${industry}|${show}`.toLowerCase();
      if (industryHooks.has(key)) return industryHooks.get(key)!;
      const hook = await generateText(
        `Write ONE cold email opening sentence (max 20 words) for a ${industry} company exhibiting at ${show}. Be specific. No em dashes. No filler.`,
        'Return only the sentence.', 60,
      ).catch(() => '');
      industryHooks.set(key, hook.trim());
      return hook.trim();
    };

    let drafted = 0;
    let skippedNoEmail = 0;

    for (const { row: lead, sheetRowIndex } of ready.slice(0, 5)) {
      const leadId   = lead[0] || '';
      const masterRef = lead[1] || '';
      const company  = lead[2] || '';
      const dmName   = lead[3] || '';
      const dmEmail  = lead[4] || '';
      const showName = lead[5] || '';

      if (!dmEmail) { skippedNoEmail++; continue; }

      const masterRow = masterById.get(masterRef) || [];
      const dmTitle   = masterRow[19] || masterRow[5] || '';
      const industry  = masterRow[10] || '';
      const notes     = masterRow[24] || '';
      const websiteM  = notes.match(/Website:\s*([^|]+)/i);
      const hook      = industry ? await getHook(industry, showName) : '';

      const companyContext = await buildKnowledgeContext(`${company} ${showName} outreach email`);

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

      const logId = `OL-${Date.now()}`;
      await appendRow(SHEETS.OUTREACH_LOG, objectToRow(SHEETS.OUTREACH_LOG, {
        id: logId, leadId, companyName: company,
        emailType: 'EMAIL_1', sentDate: new Date().toISOString(),
        status: 'PENDING_APPROVAL', replyClassification: '',
        woodpeckerId: '',
        notes: `To: ${dmEmail} | Subject: ${email.subject}`,
      }));

      const nameParts = (dmName || '').trim().split(' ').filter(Boolean);
      const lead_prospect: InstantlyLead = {
        email: dmEmail,
        first_name: nameParts[0] || 'Team',
        last_name: nameParts.slice(1).join(' ') || '',
        company_name: company,
        personalization: hook || industry || '',
        website: websiteM ? websiteM[1].trim() : '',
        custom_variables: { title: dmTitle },
      };

      const approvalId = `outreach_${leadId}`;
      registerApproval(approvalId, {
        action: `Send outreach to ${company} (${dmEmail})`,
        data: { lead_prospect, campaignId: campaign.id, logId, company, dmEmail },
        timestamp: Date.now(),
        onApprove: async () => {
          try {
            await addLeads(campaign.id, [lead_prospect]);
            await this.updateLogStatus(logId, 'SENT', campaign.id);
            await updateCell(SHEETS.OUTREACH_QUEUE, sheetRowIndex, 'H', 'SENT').catch(() => {});
            return `✅ Sent to Instantly: *${company}* (${dmEmail})\nCampaign: ${campaign.name}`;
          } catch (err: any) {
            await this.updateLogStatus(logId, 'ERROR', '');
            return `❌ Instantly push failed for ${company}: ${err.message}`;
          }
        },
        onReject: async () => {
          await this.updateLogStatus(logId, 'REJECTED', '');
          return `Rejected outreach to *${company}*.`;
        },
      });

      await sendToMo(formatType1(
        `Outreach: ${company}`,
        `${dmName} attending ${showName}`,
        `📧 *To:* ${dmEmail}\n*Subject:* ${email.subject}\n\n${email.body}`,
        approvalId
      ));

      drafted++;
    }

    let msg = `📧 *${drafted}* outreach draft(s) sent to Mo for approval.`;
    if (skippedNoEmail > 0) {
      msg += `\n\n⚠️ *${skippedNoEmail}* lead(s) skipped — no email found. Run /enrich first.`;
    }
    await this.respond(ctx.chatId, msg);
    return { success: true, message: `${drafted} outreach emails drafted`, confidence: 'HIGH' };
  }

  // ── /importleads [show name] — import from Drive → LEAD_MASTER ───────────

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

    let files: Awaited<ReturnType<typeof findExhibitorFiles>> = [];
    try {
      files = await findExhibitorFiles(showName);
    } catch (err: any) {
      await this.respond(ctx.chatId, `⚠️ Could not search Drive: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }

    if (!files.length) {
      await this.respond(ctx.chatId,
        `No exhibitor files found for "*${showName}*" in Google Drive.\n\n` +
        `Files must be in the exhibitor folder and named after the show (e.g. "Intersolar 2026.xlsx").`
      );
      return { success: false, message: 'No files found', confidence: 'HIGH' };
    }

    await this.respond(ctx.chatId, `📂 Found *${files.length}* file(s). Parsing exhibitor data...`);

    const allRecords: Awaited<ReturnType<typeof parseExhibitorFile>> = [];
    for (const file of files) {
      try {
        const records = await parseExhibitorFile(file);
        allRecords.push(...records);
      } catch (err: any) {
        logger.warn(`[ImportLeads] Failed to parse "${file.name}": ${err.message}`);
      }
    }

    if (!allRecords.length) {
      await this.respond(ctx.chatId,
        `Found the file(s) but could not extract any records. Make sure the file has a header row with company names and emails.`
      );
      return { success: false, message: 'No records parsed', confidence: 'HIGH' };
    }

    const masterRows = await readSheet(SHEETS.LEAD_MASTER).catch(() => [] as string[][]);
    const existingEmails    = new Set(masterRows.slice(1).map(r => (r[21] || r[4] || '').toLowerCase()).filter(Boolean));
    const existingCompanies = new Set(masterRows.slice(1).map(r => (r[2] || '').toLowerCase().trim()).filter(Boolean));
    const showValidation    = validateShow(showName);

    let imported = 0;
    let skipped  = 0;
    const rowBatch: string[][] = [];

    for (let i = 0; i < allRecords.length; i++) {
      const rec         = allRecords[i];
      const companyName = (rec.companyName || '').trim();
      if (!companyName) { skipped++; continue; }

      const email = (rec.contactEmail || '').trim().toLowerCase();
      if (email && existingEmails.has(email))               { skipped++; continue; }
      if (existingCompanies.has(companyName.toLowerCase())) { skipped++; continue; }

      const industry    = (rec.industry || '').toLowerCase();
      const coreInds    = ['solar', 'energy', 'medical', 'healthcare', 'food', 'packaging', 'technology', 'industrial'];
      const adjInds     = ['automotive', 'construction', 'pharma', 'agriculture', 'retail'];
      let   industryFit = 0;
      if (coreInds.some(k => industry.includes(k))) industryFit = 2;
      else if (adjInds.some(k => industry.includes(k))) industryFit = 1;

      const dmSignal  = rec.contactTitle ? 1 : 0;
      const showFit   = showValidation.valid ? 2 : 1;
      const score     = showFit + industryFit + dmSignal + 1;
      const status    = score >= 8 ? 'HOT' : score >= 5 ? 'WARM' : score >= 3 ? 'COLD' : 'DISQUALIFIED';
      const leadId    = await generateLeadId();
      const notes     = [
        rec.boothNumber ? `Booth: ${rec.boothNumber}` : '',
        rec.website     ? `Website: ${rec.website}`   : '',
        rec.country     ? `Country: ${rec.country}`   : '',
        rec.phone       ? `Phone: ${rec.phone}`       : '',
      ].filter(Boolean).join(' | ');

      rowBatch.push(objectToRow(SHEETS.LEAD_MASTER, {
        id: leadId, timestamp: new Date().toISOString(),
        companyName, contactName: rec.contactName || '',
        contactEmail: email,
        contactTitle: rec.contactTitle || '',
        showName: showValidation.match?.name || showName,
        showCity: showValidation.match?.city || '',
        standSize: '', budget: '',
        industry: rec.industry || '',
        leadSource: 'drive-import',
        score: score.toString(),
        scoreBreakdown: JSON.stringify({ showFit, sizeSignal: 0, industryFit, dmSignal, timeline: 1 }),
        confidence: showValidation.confidence,
        status, trelloCardId: '',
        enrichmentStatus: 'PENDING',
        dmName: rec.contactName || '',
        dmTitle: rec.contactTitle || '',
        dmLinkedIn: '',
        dmEmail: email,  // col V — so /bulkoutreach finds it immediately
        outreachReadiness: email ? '7' : '3',
        language: 'en', notes,
      }));

      existingEmails.add(email || `_noemail_${leadId}`);
      existingCompanies.add(companyName.toLowerCase());
      imported++;
    }

    // Write ALL rows in a single batch — avoids Sheets 60-writes/min quota
    if (rowBatch.length > 0) {
      await this.respond(ctx.chatId, `⏳ Writing ${rowBatch.length} records to Lead Master...`);
      await appendRows(SHEETS.LEAD_MASTER, rowBatch);
    }

    await this.respond(ctx.chatId,
      `✅ *Import complete for ${showName}*\n\n` +
      `Imported: *${imported}* new leads\n` +
      `Skipped:  ${skipped} (already in Lead Master)\n\n` +
      `Next step: run \`/bulkoutreach ${showName}\` to push all leads to Instantly.`
    );
    return { success: true, message: `Imported ${imported} leads for ${showName}`, confidence: 'HIGH' };
  }

  // ── /bulkoutreach [show name] — create campaign + push all leads at once ──

  private async runBulkOutreach(ctx: AgentContext): Promise<AgentResponse> {
    if (!isInstantlyConfigured()) {
      await this.respond(ctx.chatId, '⚠️ INSTANTLY_API_KEY not set in Railway env. Add it to enable outreach.');
      return { success: false, message: 'Instantly not configured', confidence: 'HIGH' };
    }

    const rawArgs    = (ctx.args || '').trim();
    const showFilter = rawArgs.toLowerCase().trim();

    if (!showFilter) {
      await this.respond(ctx.chatId,
        'Usage: `/bulkoutreach [show name]`\nExample: `/bulkoutreach intersolar`\n\n' +
        'Creates an Instantly campaign (or reuses existing), generates email sequence, and pushes all leads at once.\nOne approval covers every lead.'
      );
      return { success: false, message: 'No show name', confidence: 'HIGH' };
    }

    await this.respond(ctx.chatId, `🔍 Scanning Lead Master for *${showFilter}* leads...`);

    const masterRows = await readSheet(SHEETS.LEAD_MASTER).catch(() => [] as string[][]);
    let droppedBadEmail = 0;
    const leads = masterRows.slice(1).filter(r => {
      const show  = (r[6] || '').toLowerCase();
      if (!show.includes(showFilter)) return false;
      const email = (r[21] || r[4] || '').trim();
      if (!email) return false;
      // Require at least one @ with a dot in the domain — sanitizeLead will do full validation later
      const parts = email.split('@');
      if (parts.length !== 2 || !parts[0] || !parts[1] || !parts[1].includes('.')) {
        droppedBadEmail++;
        return false;
      }
      return true;
    });
    if (droppedBadEmail > 0) {
      logger.warn(`[Outreach] runBulkOutreach: dropped ${droppedBadEmail} ${showFilter} leads with malformed emails at pre-filter`);
    }

    if (!leads.length) {
      const showOnly = masterRows.slice(1).filter(r => (r[6] || '').toLowerCase().includes(showFilter));
      if (showOnly.length > 0) {
        await this.respond(ctx.chatId,
          `⚠️ Found *${showOnly.length}* ${showFilter} leads but none have email addresses.\n\n` +
          `Run \`/enrich ${showFilter}\` to find DM emails, then retry.`
        );
        return { success: false, message: 'Leads found but no emails', confidence: 'HIGH' };
      }

      // No leads at all — check Drive for importable files before giving up
      await this.respond(ctx.chatId,
        `No leads found for "*${showFilter}*" in Lead Master.\n\n` +
        `🔍 Checking Google Drive for exhibitor files...`
      );

      let driveFiles: Awaited<ReturnType<typeof findExhibitorFiles>> = [];
      try {
        driveFiles = await findExhibitorFiles(showFilter);
      } catch { /* ignore Drive errors here */ }

      if (driveFiles.length > 0) {
        const fileList = driveFiles.map(f => `  📄 ${f.name}`).join('\n');
        await this.respond(ctx.chatId,
          `Found *${driveFiles.length}* exhibitor file(s) in Drive for *${showFilter}*:\n${fileList}\n\n` +
          `Run this to import them into Lead Master first:\n\`/importleads ${showFilter}\`\n\n` +
          `Then run \`/bulkoutreach ${showFilter}\` again.`
        );
      } else {
        const allShows = [...new Set(masterRows.slice(1).map(r => r[6]).filter(Boolean))].slice(0, 15);
        const showList = allShows.length > 0
          ? `\n\n*Shows currently in Lead Master:*\n${allShows.map(s => `  • ${s}`).join('\n')}`
          : '';
        await this.respond(ctx.chatId,
          `No leads found for "*${showFilter}*" in Lead Master, and no Drive files found either.${showList}\n\n` +
          `Upload an exhibitor list (xlsx/csv) to Google Drive with "${showFilter}" in the filename, then run \`/importleads ${showFilter}\`.`
        );
      }
      return { success: false, message: 'No leads found', confidence: 'HIGH' };
    }

    // Check if Instantly has an existing campaign for this show
    // If one is found, REUSE it — never create a duplicate for the same show.
    let campaign: InstantlyCampaign | null = null;
    try {
      campaign = await findCampaignByName(showFilter);
      if (campaign) {
        logger.info(`[Outreach] runBulkOutreach: reusing existing campaign "${campaign.name}" (${campaign.id}) for "${showFilter}"`);
      } else {
        logger.info(`[Outreach] runBulkOutreach: no existing campaign for "${showFilter}" — will create new`);
      }
    } catch (err: any) {
      await this.respond(ctx.chatId, `⚠️ Could not connect to Instantly: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }

    // Generate industry hooks + email sequence
    const uniqueIndustries = [...new Set(leads.map(r => (r[10] || '').trim()).filter(Boolean))];
    await this.respond(ctx.chatId,
      `📋 Found *${leads.length}* ${showFilter} leads.\n` +
      (campaign ? `Using existing campaign: *${campaign.name}*\n` : '') +
      `Generating email sequence for ${uniqueIndustries.length} industries...`
    );

    const industryHooks = new Map<string, string>();
    await Promise.all(uniqueIndustries.slice(0, 10).map(async industry => {
      const hook = await generateText(
        `Write ONE cold email opening sentence (max 20 words) for a ${industry} company exhibiting at a major trade show. Be specific. No em dashes.`,
        'Return only the sentence.', 60,
      ).catch(() => '');
      industryHooks.set(industry.toLowerCase(), hook.trim());
    }));

    // Generate 4-step email sequence via Claude
    const showValidation = validateShow(showFilter);
    const showDisplayName = showValidation.match?.name || showFilter;
    const emailSequence = await this.generateEmailSequenceSteps(showDisplayName, uniqueIndustries[0] || 'trade show');

    // Build prospects array — sanitizeLead cleans emails, names, URLs, lengths
    // Deduplicate by email using a Set — duplicate rows in the sheet should not
    // result in duplicate leads being pushed to Instantly.
    const seenEmails = new Set<string>();
    const prospects: InstantlyLead[] = [];
    let totalScanned = 0;
    let totalWithEmail = 0;
    let totalDroppedDupe = 0;
    let totalDroppedInvalid = 0;

    for (const r of leads) {
      totalScanned++;
      const rawEmail = (r[21] || r[4] || '').trim();
      if (!rawEmail) continue;
      totalWithEmail++;

      const dmName   = r[18] || r[3] || '';
      const parts    = dmName.trim().split(' ').filter(Boolean);
      const industry = r[10] || '';
      const notes    = r[24] || '';
      const wm       = notes.match(/Website:\s*([^|]+)/i);

      const raw: InstantlyLead = {
        email:            rawEmail,
        first_name:       parts[0] || 'Team',
        last_name:        parts.slice(1).join(' ') || '',
        company_name:     r[2]  || '',
        personalization:  industryHooks.get(industry.toLowerCase()) || industry || 'your upcoming trade show stand',
        website:          wm ? wm[1].trim() : '',
        custom_variables: { title: r[19] || r[5] || '', show: r[6] || '' },
      };
      const clean = sanitizeLead(raw);
      if (!clean) { totalDroppedInvalid++; continue; }

      // Deduplicate: skip if this email was already added in this batch
      const emailKey = clean.email.toLowerCase();
      if (seenEmails.has(emailKey)) { totalDroppedDupe++; continue; }
      seenEmails.add(emailKey);
      prospects.push(clean);
    }

    // Diagnostic log — visible in Railway logs to diagnose empty or reduced batches
    const sampleEmails = prospects.slice(0, 3).map(p => p.email);
    logger.info(
      `[Outreach] runBulkOutreach prospect build for "${showFilter}": ` +
      `scanned=${totalScanned} withEmail=${totalWithEmail} ` +
      `invalidDropped=${totalDroppedInvalid} dupeDropped=${totalDroppedDupe} ` +
      `uniqueValid=${prospects.length} sampleEmails=${JSON.stringify(sampleEmails)}`
    );

    // ── Campaign creation strategy ──────────────────────────────────────────
    // Instantly supports full API campaign creation — no manual UI needed.
    // If no existing campaign: create it with email sequence built in.
    // If existing: reuse it (leads go into its existing sequence).

    const campaignName = campaign?.name
      ?? `${showDisplayName} ${new Date().getFullYear()} - StandMe`;

    const approvalId = `bulkoutreach_${showFilter.replace(/\s+/g, '_')}_${Date.now()}`;

    // Persist params to KB so the approval survives a Railway redeploy
    await saveKnowledge({
      source:     `bulk-approval-${approvalId}`,
      sourceType: 'sheet',
      topic:      'bulk-approval-pending',
      tags:       `bulk-approval,${showFilter.replace(/\s+/g, '-')},pending`,
      content:    JSON.stringify({
        approvalId, showFilter, campaignId: campaign?.id ?? null, campaignName,
        createNew: !campaign, emailSequence, timestamp: Date.now(),
      }),
    }).catch(() => {});

    registerApproval(approvalId, {
      action:    `Bulk push ${prospects.length} ${showFilter} leads to "${campaignName}"`,
      data:      { prospects, campaign, campaignName, showFilter, emailSequence },
      timestamp: Date.now(),
      onApprove: async () => {
        try {
          let targetCampaign = campaign;

          // Create campaign if it doesn't exist yet
          if (!targetCampaign) {
            const newId = await createCampaign(campaignName, emailSequence);
            targetCampaign = { id: newId, name: campaignName, status: CAMPAIGN_STATUS.DRAFT };
            logger.info(`[Outreach] Created Instantly campaign: ${campaignName} (${newId})`);
          }

          // Push all leads
          const result = await addLeads(targetCampaign.id, prospects);

          // Activate campaign automatically if it was just created or is DRAFT
          let activationWarning = '';
          if (targetCampaign.status === CAMPAIGN_STATUS.DRAFT) {
            try {
              await activateCampaign(targetCampaign.id);
            } catch (err: any) {
              logger.warn(`[Outreach] Could not activate campaign: ${err.message}`);
              activationWarning = `\n⚠️ Campaign activation failed: ${err.message}\nActivate it manually in the Instantly dashboard.`;
            }
          }

          // Log to OUTREACH_LOG — single batch write to avoid Google Sheets quota
          const logDate = new Date().toISOString();
          const logRows = prospects.map(p => objectToRow(SHEETS.OUTREACH_LOG, {
            id:                  `OL-BULK-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            leadId:              '',
            companyName:         p.company_name || '',
            emailType:           'BULK_EMAIL_1',
            sentDate:            logDate,
            status:              'SENT',
            replyClassification: '',
            woodpeckerId:        targetCampaign.id,
            notes:               `Bulk → Instantly campaign ${targetCampaign.id} (${targetCampaign.name}) | ${showFilter}`,
          }));
          await appendRows(SHEETS.OUTREACH_LOG, logRows).catch((err: any) =>
            logger.warn(`[Outreach] OUTREACH_LOG write failed (non-fatal): ${err.message}`)
          );

          return (
            `✅ *Bulk push complete!*\n\n` +
            `Campaign: *${targetCampaign.name}*\n` +
            `Pushed: *${result.added}* leads\n` +
            (result.skipped > 0 ? `Skipped: ${result.skipped} (dupes)\n` : '') +
            (result.failed  > 0 ? `Failed: ${result.failed}\n` : '') +
            activationWarning +
            `\n📧 Instantly is sending emails per the campaign schedule. Check Instantly dashboard for live stats.`
          );
        } catch (err: any) {
          return `❌ Bulk push failed: ${err.message}`;
        }
      },
      onReject: async () => `Bulk outreach to *${campaignName}* cancelled.`,
    });

    const campaignNote = campaign
      ? `Using existing campaign: *${campaign.name}* [${campaignStatusLabel(campaign.status)}]`
      : `*New campaign will be created:* "${campaignName}" with a 4-step email sequence`;

    await sendToMo(formatType1(
      `Bulk Outreach: ${leads.length} ${showFilter} leads`,
      `→ ${campaignName}`,
      `*${prospects.length}* leads ready.\n\n` +
      `${campaignNote}\n` +
      `Industries: ${uniqueIndustries.slice(0, 5).join(', ')}${uniqueIndustries.length > 5 ? ` +${uniqueIndustries.length - 5} more` : ''}\n\n` +
      `Approve to push all *${prospects.length}* leads at once.`,
      approvalId
    ));

    await this.respond(ctx.chatId,
      `📤 *Approval sent to Mo.*\n\n` +
      `*${prospects.length}* ${showFilter} leads ready for *${campaignName}*.\n` +
      `${campaignNote}\n\n` +
      `Mo approves with \`/approve_${approvalId}\` to push all at once.`
    );

    return { success: true, message: `Bulk outreach: ${prospects.length} leads pending approval`, confidence: 'HIGH' };
  }

  // ── /outreachstatus — Instantly campaign stats + local log ───────────────

  private async showStatus(ctx: AgentContext): Promise<AgentResponse> {
    await this.respond(ctx.chatId, 'Fetching outreach status...');

    const sections: string[] = [];

    // Local log stats
    try {
      const log  = await readSheet(SHEETS.OUTREACH_LOG);
      const rows = log.slice(1);
      const stats = { sent: 0, pending: 0, rejected: 0, error: 0 };
      for (const r of rows) {
        const s = (r[5] || '').toUpperCase();
        if (s === 'SENT')            stats.sent++;
        else if (s.includes('PENDING')) stats.pending++;
        else if (s === 'REJECTED')   stats.rejected++;
        else if (s === 'ERROR')      stats.error++;
      }
      sections.push(
        `*Local Log (${rows.length} total):*\n` +
        `  Sent to Instantly: ${stats.sent}\n` +
        `  Pending Approval: ${stats.pending}\n` +
        `  Rejected: ${stats.rejected}\n` +
        `  Errors: ${stats.error}`
      );
    } catch { /* silent */ }

    if (!isInstantlyConfigured()) {
      sections.push(`*Instantly:* INSTANTLY_API_KEY not set. Add it in Railway env vars.`);
    } else {
      try {
        const campaigns = await listCampaigns();
        if (!campaigns.length) {
          sections.push(`*Instantly:* No campaigns yet. Run \`/bulkoutreach [show]\` to create the first one.`);
        } else {
          const active = campaigns.filter(c => c.status === CAMPAIGN_STATUS.ACTIVE);
          const ids    = active.length ? active.map(c => c.id) : [campaigns[0].id];
          const summaries = await getAllCampaignSummaries(ids).catch(() => []);

          for (const s of summaries) {
            sections.push(
              `*${s.campaign_name || 'Campaign'}:*\n` +
              `  Sent: ${s.emails_sent} | Opened: ${s.opened} (${s.open_rate}%)\n` +
              `  Replied: ${s.replied} (${s.reply_rate}%) | Bounced: ${s.bounced} (${s.bounce_rate}%)\n` +
              (s.bounce_rate > 3 ? `  ⚠️ Bounce rate >3% — sender reputation risk!\n` : '')
            );
          }

          if (!summaries.length) {
            const list = campaigns.slice(0, 8).map(c =>
              `  • *${c.name}* [${campaignStatusLabel(c.status)}]`
            ).join('\n');
            sections.push(`*Instantly Campaigns:*\n${list}`);
          }
        }
      } catch (err: any) {
        sections.push(`*Instantly:* Could not connect — ${err.message}`);
      }
    }

    await this.respond(ctx.chatId, `📊 *Outreach Status*\n\n${sections.join('\n\n')}`);
    return { success: true, message: 'Outreach status shown', confidence: 'HIGH' };
  }

  // ── /campaigns — list all Instantly campaigns ────────────────────────────

  private async showCampaigns(ctx: AgentContext): Promise<AgentResponse> {
    if (!isInstantlyConfigured()) {
      await this.respond(ctx.chatId, '⚠️ INSTANTLY_API_KEY not set in Railway env.');
      return { success: false, message: 'Not configured', confidence: 'HIGH' };
    }
    try {
      const campaigns = await listCampaigns();
      if (!campaigns.length) {
        await this.respond(ctx.chatId,
          'No campaigns in Instantly yet.\n\nRun `/bulkoutreach [show name]` to create the first campaign automatically.'
        );
        return { success: true, message: 'No campaigns', confidence: 'HIGH' };
      }

      const list = campaigns.map(c =>
        `  *${c.name}* — ${campaignStatusLabel(c.status)}`
      ).join('\n');

      const accounts = await listAccounts().catch(() => []);
      const capacity = accounts.reduce((s, a) => s + (a.daily_limit ?? 50), 0);

      await this.respond(ctx.chatId,
        `*Instantly Campaigns (${campaigns.length}):*\n\n${list}\n\n` +
        `*Daily send capacity:* ${capacity} emails across ${accounts.length} inboxes\n\n` +
        `Run \`/bulkoutreach [show name]\` to push leads to any campaign.`
      );
      return { success: true, message: `${campaigns.length} campaigns`, confidence: 'HIGH' };
    } catch (err: any) {
      await this.respond(ctx.chatId, `Failed to fetch campaigns: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }
  }

  // ── /replies [campaign] — show and score recent replies ─────────────────

  private async showReplies(ctx: AgentContext): Promise<AgentResponse> {
    if (!isInstantlyConfigured()) {
      await this.respond(ctx.chatId, '⚠️ INSTANTLY_API_KEY not set in Railway env.');
      return { success: false, message: 'Not configured', confidence: 'HIGH' };
    }

    await this.respond(ctx.chatId, '📬 Fetching recent replies...');

    try {
      const showFilter = (ctx.args || '').trim().toLowerCase();
      let campaignId: string | undefined;

      if (showFilter) {
        const campaign = await findCampaignByName(showFilter);
        if (campaign) campaignId = campaign.id;
      }

      const since    = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // last 7 days
      const replies  = await getReplies({ campaignId, since, limit: 50 });

      if (!replies.length) {
        await this.respond(ctx.chatId, `No replies in the last 7 days${showFilter ? ` for *${showFilter}*` : ''}.`);
        return { success: true, message: 'No replies', confidence: 'HIGH' };
      }

      // Score intent with Claude
      const scored: { reply: typeof replies[0]; intent: string; label: string }[] = [];
      for (const r of replies.slice(0, 20)) {
        const body = (r.body || '').slice(0, 500);
        if (!body) continue;
        const intent = await generateText(
          `Classify this cold email reply intent as HIGH, MEDIUM, or LOW.\nHIGH = interested, wants to discuss, asks questions, requests quote.\nMEDIUM = curious, vague positive.\nLOW = unsubscribe, not interested, OOO.\n\nReply: "${body}"\n\nReturn only: HIGH, MEDIUM, or LOW`,
          undefined, 10
        ).catch(() => 'UNKNOWN');
        const label = intent.trim().toUpperCase().startsWith('HIGH') ? '🔥 HIGH'
          : intent.trim().toUpperCase().startsWith('MED') ? '🟡 MEDIUM' : '❄️ LOW';
        scored.push({ reply: r, intent: intent.trim().toUpperCase(), label });
      }

      const high   = scored.filter(s => s.intent.startsWith('HIGH'));
      const medium = scored.filter(s => s.intent.startsWith('MED'));

      let msg = `📬 *Replies (last 7 days)* — ${replies.length} total\n\n`;

      if (high.length) {
        msg += `*🔥 High Intent (${high.length}) — Convert to pipeline:*\n`;
        for (const { reply } of high) {
          msg += `  • ${reply.from_email} — "${(reply.body || '').slice(0, 80)}..."\n`;
          msg += `    → \`/convert ${reply.from_email}\`\n`;
          // Save pending-conversion KB entry so W5 briefing can surface it
          await saveKnowledge({
            source: `pending-conversion-${reply.from_email.toLowerCase()}`,
            sourceType: 'manual',
            topic: 'pending-conversion',
            tags: `pending-conversion,high-intent,campaign-reply`,
            content: `High-intent campaign reply from ${reply.from_email}. Not yet converted. Reply: "${(reply.body || '').slice(0, 300)}"`,
          }).catch(() => {});
        }
        msg += '\n';
      }

      if (medium.length) {
        msg += `*🟡 Medium Intent (${medium.length}) — Follow up:*\n`;
        for (const { reply } of medium.slice(0, 5)) {
          msg += `  • ${reply.from_email}\n`;
        }
        msg += '\n';
      }

      msg += `❄️ Low intent / unsubscribes: ${scored.length - high.length - medium.length}`;

      await this.respond(ctx.chatId, msg);

      // Alert Mo to high-intent replies immediately with /convert hint
      if (high.length > 0) {
        await sendToMo(formatType2(
          `🔥 ${high.length} High-Intent Replies Need Attention`,
          high.map(({ reply }) =>
            `*${reply.from_email}*\n"${(reply.body || '').slice(0, 150)}"\n\`/convert ${reply.from_email}\``
          ).join('\n\n')
        ));
      }

      return { success: true, message: `${replies.length} replies fetched`, confidence: 'HIGH' };
    } catch (err: any) {
      await this.respond(ctx.chatId, `Failed to fetch replies: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }
  }

  // ── /generateemails [show] — generate sequence AND create campaign in Instantly ──

  private async runGenerateEmails(ctx: AgentContext): Promise<AgentResponse> {
    const showName = ctx.args?.trim();
    if (!showName) {
      await this.respond(ctx.chatId,
        'Usage: `/generateemails [show name]`\nExample: `/generateemails intersolar`\n\n' +
        'Generates a 4-step email sequence and creates the Instantly campaign automatically.'
      );
      return { success: false, message: 'No show name', confidence: 'HIGH' };
    }

    await this.respond(ctx.chatId, `✍️ Generating email sequence for *${showName}*...`);

    const showInfo        = validateShow(showName);
    const industry        = showInfo.match?.industry || 'trade show';
    const steps           = await this.generateEmailSequenceSteps(showName, industry);

    if (!isInstantlyConfigured()) {
      // Just show the sequence for manual use
      const stepsText = steps.map((s, i) =>
        `*Step ${i + 1}* (Day ${s.delay}):\nSubject: ${s.subject}\n\n${s.body}`
      ).join('\n\n---\n\n');
      await this.respond(ctx.chatId,
        `📧 *Email Sequence — ${showName}*\n\n${stepsText}\n\n` +
        `⚠️ Add INSTANTLY_API_KEY to Railway env to auto-create the campaign.`
      );
      return { success: true, message: 'Sequence generated (no API key)', confidence: 'HIGH' };
    }

    // Create the Instantly campaign with emails built in
    const campaignName = `${showInfo.match?.name || showName} ${new Date().getFullYear()} - StandMe`;
    try {
      const existing = await findCampaignByName(showName);
      if (existing) {
        await this.respond(ctx.chatId,
          `Campaign *"${existing.name}"* already exists [${campaignStatusLabel(existing.status)}].\n\n` +
          `Run \`/bulkoutreach ${showName}\` to push leads to it.`
        );
        return { success: true, message: 'Campaign already exists', confidence: 'HIGH' };
      }

      const campaignId = await createCampaign(campaignName, steps);

      await this.respond(ctx.chatId,
        `✅ *Campaign created in Instantly!*\n\n` +
        `Name: *${campaignName}*\n` +
        `Emails: ${steps.length} steps (day 0, 4, 8, 12)\n\n` +
        `Next: run \`/bulkoutreach ${showName}\` to push all leads and activate the campaign.`
      );

      await saveKnowledge({
        source: `campaign-created-${campaignId}`,
        sourceType: 'manual',
        topic: showName,
        tags: `campaign,instantly,${showName.toLowerCase().replace(/\s+/g, '-')}`,
        content: `Instantly campaign "${campaignName}" created (ID: ${campaignId}). 4-step sequence for ${industry}.`,
      }).catch(() => {});

    } catch (err: any) {
      await this.respond(ctx.chatId, `❌ Failed to create campaign: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }

    return { success: true, message: `Campaign created for ${showName}`, confidence: 'HIGH' };
  }

  // ── /instantlyverify — connection + account diagnostic ───────────────────

  private async runInstantlyVerify(ctx: AgentContext): Promise<AgentResponse> {
    if (!isInstantlyConfigured()) {
      await this.respond(ctx.chatId,
        '⚠️ *INSTANTLY_API_KEY not set*\n\n' +
        '1. Go to app.instantly.ai → Settings → API\n' +
        '2. Copy your API key\n' +
        '3. Add `INSTANTLY_API_KEY=your_key` in Railway → Variables'
      );
      return { success: false, message: 'No API key', confidence: 'HIGH' };
    }

    await this.respond(ctx.chatId, '🔬 Running Instantly diagnostic...');

    const lines: string[] = [];

    // Connection test
    try {
      const count = await testConnection();
      lines.push(`✅ *API Connection:* OK (${count} campaigns found)`);
    } catch (err: any) {
      lines.push(`❌ *API Connection:* ${err.message}`);
      await this.respond(ctx.chatId, `*Instantly Diagnostic*\n\n${lines.join('\n')}`);
      return { success: false, message: 'Connection failed', confidence: 'HIGH' };
    }

    // Sending accounts
    try {
      const accounts = await listAccounts();
      const active   = accounts.filter(a => a.status === 'active' || a.status === 'connected');
      const capacity = active.reduce((s, a) => s + (a.daily_limit ?? 50), 0);
      lines.push(`✅ *Sending Accounts:* ${accounts.length} total, ${active.length} active`);
      lines.push(`📧 *Daily Send Capacity:* ${capacity} emails/day`);
      for (const a of active.slice(0, 5)) {
        lines.push(`   • ${a.email} (${a.daily_limit ?? 50}/day)`);
      }
    } catch (err: any) {
      lines.push(`⚠️ *Accounts:* ${err.message}`);
    }

    // Recent campaigns
    try {
      const campaigns = await listCampaigns();
      const active    = campaigns.filter(c => c.status === CAMPAIGN_STATUS.ACTIVE);
      lines.push(`\n*Campaigns:* ${campaigns.length} total, ${active.length} active`);
      for (const c of campaigns.slice(0, 5)) {
        lines.push(`  • *${c.name}* [${campaignStatusLabel(c.status)}]`);
      }
    } catch (err: any) {
      lines.push(`⚠️ *Campaigns:* ${err.message}`);
    }

    await this.respond(ctx.chatId, `🔬 *Instantly Diagnostic*\n\n${lines.join('\n')}`);
    return { success: true, message: 'Diagnostic complete', confidence: 'HIGH' };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Resolve best Instantly campaign for a show. Returns null if cannot be determined. */
  private async resolveCampaign(ctx: AgentContext, args: string): Promise<InstantlyCampaign | null> {
    if (!isInstantlyConfigured()) return null;

    // Look up by show name from args
    const showFilter = (args || '').trim().toLowerCase();

    try {
      const all    = await listCampaigns();
      const active = all.filter(c => c.status === CAMPAIGN_STATUS.ACTIVE);

      if (showFilter) {
        // Use the strict matcher (exact / starts-with / whole-word, ≥4 chars) so a
        // short or ambiguous filter never silently returns the wrong campaign.
        const match = await findCampaignByName(showFilter);
        if (match) return match;
      }

      if (active.length === 1) {
        await this.respond(ctx.chatId, `Using campaign: *${active[0].name}*`);
        return active[0];
      }

      if (active.length > 1) {
        const list = active.map(c => `  • *${c.name}* → /outreach ${c.name.toLowerCase().split(' ')[0]}`).join('\n');
        await this.respond(ctx.chatId, `Multiple active campaigns — specify a show name:\n\n${list}`);
        return null;
      }

      if (all.length > 0) {
        const list = all.slice(0, 8).map(c => `  • *${c.name}* [${campaignStatusLabel(c.status)}]`).join('\n');
        await this.respond(ctx.chatId, `No active campaigns. Available:\n\n${list}\n\nRun \`/bulkoutreach [show]\` to push leads.`);
        return null;
      }

      await this.respond(ctx.chatId, 'No campaigns in Instantly yet. Run `/bulkoutreach [show name]` to create the first one.');
      return null;
    } catch (err: any) {
      await this.respond(ctx.chatId, `Could not fetch campaigns: ${err.message}`);
      return null;
    }
  }

  /** Generate a 4-step email sequence using Claude */
  private async generateEmailSequenceSteps(showName: string, industry: string): Promise<InstantlyEmailStep[]> {
    const showInfo  = validateShow(showName);
    const city      = showInfo.match?.city || showName;
    const country   = showInfo.match?.country || 'Europe';

    const prompt =
      `You are StandMe, an exhibition stand design & build company (standme.de).\n` +
      `Target: companies exhibiting at ${showName} (${industry} industry, ${city}, ${country}).\n` +
      `StandMe offers: full-service custom stands — design, production, installation, strip.\n` +
      `Budget range: €15,000–80,000+. Focus on ROI, brand impact, stress-free execution.\n\n` +
      `Write a 4-step cold email sequence. Output EXACTLY this JSON array format:\n` +
      `[\n` +
      `  {"subject": "...", "body": "...", "delay": 0},\n` +
      `  {"subject": "...", "body": "...", "delay": 4},\n` +
      `  {"subject": "...", "body": "...", "delay": 8},\n` +
      `  {"subject": "...", "body": "...", "delay": 12}\n` +
      `]\n\n` +
      `Rules:\n` +
      `- Use {{first_name}}, {{company_name}} personalisation tokens\n` +
      `- Step 1 (day 0): value-led cold intro — one specific insight about ${industry} exhibiting\n` +
      `- Step 2 (day 4): social proof / case study angle — reference a real exhibition challenge\n` +
      `- Step 3 (day 8): qualifying question — ask about their stand goals\n` +
      `- Step 4 (day 12): urgency — stands book up 6+ months before show, deadline framing\n` +
      `- Each email max 120 words. Plain text. No em dashes. No excessive punctuation.\n` +
      `- Sign off: Mohammed | StandMe | standme.de\n` +
      `Output ONLY the JSON array. No other text.`;

    const raw = await generateText(prompt, undefined, 1500).catch(() => null);

    if (!raw) return this.fallbackEmailSequence(showName);

    try {
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      if (Array.isArray(parsed) && parsed.length >= 2) {
        return parsed.slice(0, 4).map((s: any, i: number) => ({
          subject: String(s.subject || `Follow up ${i + 1}`),
          body:    String(s.body    || ''),
          delay:   Number(s.delay   ?? (i * 4)),
        }));
      }
    } catch { /* fall through */ }

    return this.fallbackEmailSequence(showName);
  }

  private fallbackEmailSequence(showName: string): InstantlyEmailStep[] {
    return [
      {
        subject: `Your ${showName} stand — quick question`,
        body: `Hi {{first_name}},\n\nSeeing {{company_name}} is exhibiting at ${showName} — are you sorted for the stand build?\n\nWe design and build custom exhibition stands across Europe and MENA. If you're still looking, I'd love to share some options.\n\nMohammed | StandMe | standme.de`,
        delay: 0,
      },
      {
        subject: `Re: Your ${showName} stand`,
        body: `Hi {{first_name}},\n\nJust following up — we recently built a stand for a similar company at ${showName} and they saw a 40% increase in visitor engagement.\n\nHappy to send photos and pricing. Worth a quick call?\n\nMohammed | StandMe | standme.de`,
        delay: 4,
      },
      {
        subject: `${showName} stand — still deciding?`,
        body: `Hi {{first_name}},\n\nWhat's the biggest priority for your ${showName} stand — design impact, logistics, or cost control?\n\nAsking because we tailor our approach based on what matters most. 5 min call this week?\n\nMohammed | StandMe | standme.de`,
        delay: 8,
      },
      {
        subject: `Last chance — ${showName} stand slots filling`,
        body: `Hi {{first_name}},\n\nStand production typically needs 12+ weeks. ${showName} is approaching fast.\n\nIf you haven't locked in your builder yet, now is the time. We still have a few slots available.\n\nWant a quick quote? Reply here or book at standme.de.\n\nMohammed | StandMe | standme.de`,
        delay: 12,
      },
    ];
  }

  // ── /launch [show name] — Drive → Instantly full pipeline with Mo approval ──

  private async runLaunch(ctx: AgentContext): Promise<AgentResponse> {
    if (!isInstantlyConfigured()) {
      await this.respond(ctx.chatId, '⚠️ INSTANTLY_API_KEY not set in Railway env. Add it to enable outreach.');
      return { success: false, message: 'Instantly not configured', confidence: 'HIGH' };
    }

    const showName = (ctx.args || '').trim();
    if (!showName) {
      await this.respond(ctx.chatId,
        'Usage: `/launch [show name]`\n\n' +
        'Finds exhibitor files in Drive, deduplicates vs sent history, gets Mo approval, then pushes to Instantly in one batch.\n\n' +
        'Example: `/launch intersolar`'
      );
      return { success: false, message: 'No show name', confidence: 'HIGH' };
    }

    await this.respond(ctx.chatId, `🔍 Searching Google Drive for *${showName}* exhibitor files...`);

    // Step 1 — Find Drive files
    let files: Awaited<ReturnType<typeof findExhibitorFiles>> = [];
    try {
      files = await findExhibitorFiles(showName);
    } catch (err: any) {
      await this.respond(ctx.chatId, `⚠️ Could not search Drive: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }

    if (!files.length) {
      await this.respond(ctx.chatId,
        `No exhibitor files found for "*${showName}*" in Google Drive.\n\n` +
        `Upload an Excel/CSV file named after the show (e.g. "Intersolar 2026.xlsx") to the exhibitor folder in Drive.`
      );
      return { success: false, message: 'No files found', confidence: 'HIGH' };
    }

    await this.respond(ctx.chatId, `📂 Found *${files.length}* file(s). Parsing exhibitor data...`);

    // Step 2 — Parse files
    const allRecords: Awaited<ReturnType<typeof parseExhibitorFile>> = [];
    for (const file of files) {
      try {
        const records = await parseExhibitorFile(file);
        allRecords.push(...records);
      } catch (err: any) {
        logger.warn(`[Launch] Failed to parse "${file.name}": ${err.message}`);
      }
    }

    if (!allRecords.length) {
      await this.respond(ctx.chatId,
        `Found the file(s) but could not extract any records. Make sure the file has a header row with company names and emails.`
      );
      return { success: false, message: 'No records parsed', confidence: 'HIGH' };
    }

    // Step 3 — Dedup vs OUTREACH_LOG and CAMPAIGN_SALES
    const [logRows, campaignSalesRows] = await Promise.all([
      readSheet(SHEETS.OUTREACH_LOG).catch(() => [] as string[][]),
      readSheet(SHEETS.CAMPAIGN_SALES).catch(() => [] as string[][]),
    ]);

    const sentEmails = new Set<string>();
    logRows.slice(1).forEach(r => {
      const e = (r[4] || '').toLowerCase().trim();
      if (e) sentEmails.add(e);
    });
    campaignSalesRows.slice(1).forEach(r => {
      const e = (r[5] || '').toLowerCase().trim();
      if (e) sentEmails.add(e);
    });

    // Step 4 — Find or create Instantly campaign
    let campaign: InstantlyCampaign | null = null;
    try {
      campaign = await findCampaignByName(showName);
    } catch (err: any) {
      await this.respond(ctx.chatId, `⚠️ Could not connect to Instantly: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }

    // Step 5 — Build new prospects list (deduped)
    const showValidation = validateShow(showName);
    const uniqueIndustries = [...new Set(allRecords.map(r => (r.industry || '').trim()).filter(Boolean))];

    const industryHooks = new Map<string, string>();
    await Promise.all(uniqueIndustries.slice(0, 10).map(async industry => {
      const hook = await generateText(
        `Write ONE cold email opening sentence (max 20 words) for a ${industry} company exhibiting at a major trade show. Be specific. No em dashes.`,
        'Return only the sentence.', 60,
      ).catch(() => '');
      industryHooks.set(industry.toLowerCase(), hook.trim());
    }));

    const seenEmails = new Set<string>();
    const newProspects: { lead: InstantlyLead; record: typeof allRecords[0] }[] = [];
    let skippedAlreadySent = 0;

    for (const rec of allRecords) {
      const email = (rec.contactEmail || '').trim().toLowerCase();
      if (!email || !email.includes('@')) continue;
      if (sentEmails.has(email)) { skippedAlreadySent++; continue; }
      if (seenEmails.has(email)) continue;
      seenEmails.add(email);

      const dmName = (rec.contactName || '').trim();
      const parts  = dmName.split(' ').filter(Boolean);
      const industry = (rec.industry || '').toLowerCase();

      const raw: InstantlyLead = {
        email,
        first_name:  parts[0] || 'Team',
        last_name:   parts.slice(1).join(' ') || '',
        company_name: rec.companyName || '',
        personalization: industryHooks.get(industry) || industry || 'your upcoming trade show stand',
        website:     rec.website || '',
        custom_variables: { title: rec.contactTitle || '', show: showValidation.match?.name || showName },
      };
      const clean = sanitizeLead(raw);
      if (clean) newProspects.push({ lead: clean, record: rec });
    }

    if (!newProspects.length) {
      await this.respond(ctx.chatId,
        `Found ${allRecords.length} records but all emails were already in OUTREACH_LOG or CAMPAIGN_SALES.\n\n` +
        `Upload a new exhibitor file with fresh contacts to send a new batch.`
      );
      return { success: true, message: 'All leads already sent', confidence: 'HIGH' };
    }

    // Step 6 — Generate email sequence + build approval
    const showDisplayName = showValidation.match?.name || showName;
    const emailSequence = await this.generateEmailSequenceSteps(showDisplayName, uniqueIndustries[0] || 'trade show');
    const campaignName  = campaign?.name ?? `${showDisplayName} ${new Date().getFullYear()} - StandMe`;

    const approvalId = `launch_${showName.replace(/\s+/g, '_')}_${Date.now()}`;

    await saveKnowledge({
      source:     `bulk-approval-${approvalId}`,
      sourceType: 'sheet',
      topic:      'bulk-approval-pending',
      tags:       `bulk-approval,${showName.replace(/\s+/g, '-')},pending`,
      content:    JSON.stringify({
        approvalId, showFilter: showName, campaignId: campaign?.id ?? null, campaignName,
        createNew: !campaign, emailSequence, timestamp: Date.now(),
      }),
    }).catch(() => {});

    const prospects = newProspects.map(p => p.lead);

    // Step 7 — Register approval; onApprove does batch push + all sheet writes
    registerApproval(approvalId, {
      action:    `Launch ${prospects.length} ${showName} leads to "${campaignName}"`,
      data:      { prospects, campaign, campaignName, showName, emailSequence },
      timestamp: Date.now(),
      onApprove: async () => {
        try {
          let targetCampaign = campaign;

          if (!targetCampaign) {
            const newId = await createCampaign(campaignName, emailSequence);
            targetCampaign = { id: newId, name: campaignName, status: CAMPAIGN_STATUS.DRAFT };
            logger.info(`[Launch] Created Instantly campaign: ${campaignName} (${newId})`);
          }

          const result = await addLeads(targetCampaign.id, prospects);

          let activationWarning = '';
          if (targetCampaign.status === CAMPAIGN_STATUS.DRAFT) {
            try {
              await activateCampaign(targetCampaign.id);
            } catch (err: any) {
              activationWarning = `\n⚠️ Campaign activation failed: ${err.message}`;
            }
          }

          const logDate = new Date().toISOString();

          // Batch-write OUTREACH_LOG
          const olRows = prospects.map(p => objectToRow(SHEETS.OUTREACH_LOG, {
            id:          `OL-LAUNCH-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            leadId:      '',
            companyName: p.company_name || '',
            emailType:   'LAUNCH_EMAIL_1',
            sentDate:    logDate,
            status:      'SENT',
            replyClassification: '',
            woodpeckerId: targetCampaign.id,
            notes:       `Launch → Instantly campaign ${targetCampaign.id} (${targetCampaign.name}) | ${showName}`,
          }));
          await appendRows(SHEETS.OUTREACH_LOG, olRows).catch((err: any) =>
            logger.warn(`[Launch] OUTREACH_LOG write failed: ${err.message}`)
          );

          // Batch-write CAMPAIGN_SALES
          const csRows = newProspects.map((p, i) => objectToRow(SHEETS.CAMPAIGN_SALES, {
            id:              `CS-LAUNCH-${Date.now()}-${i}`,
            campaignId:      targetCampaign!.id,
            showName:        showDisplayName,
            companyName:     p.lead.company_name || '',
            contactName:     `${p.lead.first_name} ${p.lead.last_name}`.trim(),
            contactEmail:    p.lead.email,
            instantlyId:     targetCampaign!.id,
            status:          'SENT',
            classification:  '',
            standSize:       '',
            budget:          '',
            showDates:       '',
            phone:           '',
            requirements:    '',
            conversationLog: '[]',
            lastReplyDate:   '',
            lastActionDate:  logDate,
            leadMasterId:    '',
            notes:           `Drive launch | ${showName}`,
            website:         p.record.website || '',
            logoUrl:         '',
          }));
          await appendRows(SHEETS.CAMPAIGN_SALES, csRows).catch((err: any) =>
            logger.warn(`[Launch] CAMPAIGN_SALES write failed: ${err.message}`)
          );

          // Batch-write LEAD_MASTER for new companies not already there
          const freshMasterRows = await readSheet(SHEETS.LEAD_MASTER).catch(() => [] as string[][]);
          const existingCos  = new Set(freshMasterRows.slice(1).map(r => (r[2] || '').toLowerCase().trim()));
          const existingMails = new Set(freshMasterRows.slice(1).map(r => (r[21] || r[4] || '').toLowerCase().trim()).filter(Boolean));

          const lmRows: string[][] = [];
          for (const p of newProspects) {
            const co = (p.lead.company_name || '').trim();
            if (!co || existingCos.has(co.toLowerCase())) continue;
            if (existingMails.has(p.lead.email.toLowerCase())) continue;
            const leadId = await generateLeadId();
            lmRows.push(objectToRow(SHEETS.LEAD_MASTER, {
              id:              leadId,
              timestamp:       logDate,
              companyName:     co,
              contactName:     `${p.lead.first_name} ${p.lead.last_name}`.trim(),
              contactEmail:    p.lead.email,
              contactTitle:    (p.lead.custom_variables as any)?.title || '',
              showName:        showDisplayName,
              showCity:        showValidation.match?.city || '',
              standSize:       '',
              budget:          '',
              industry:        p.record.industry || '',
              leadSource:      'launch-campaign',
              score:           '5',
              scoreBreakdown:  JSON.stringify({ showFit: 2, sizeSignal: 0, industryFit: 1, dmSignal: 1, timeline: 1 }),
              confidence:      'MEDIUM',
              status:          'COLD',
              trelloCardId:    '',
              enrichmentStatus: 'PENDING',
              dmName:          `${p.lead.first_name} ${p.lead.last_name}`.trim(),
              dmTitle:         (p.lead.custom_variables as any)?.title || '',
              dmLinkedIn:      '',
              dmEmail:         p.lead.email,
              outreachReadiness: '5',
              language:        'en',
              notes:           `Campaign: ${targetCampaign!.name}`,
            }));
            existingCos.add(co.toLowerCase());
          }
          if (lmRows.length > 0) {
            await appendRows(SHEETS.LEAD_MASTER, lmRows).catch((err: any) =>
              logger.warn(`[Launch] LEAD_MASTER write failed: ${err.message}`)
            );
          }

          return (
            `✅ *Campaign launched!*\n\n` +
            `Campaign: *${targetCampaign.name}*\n` +
            `Pushed: *${result.added}* leads\n` +
            (result.skipped > 0 ? `Skipped: ${result.skipped} (dupes in Instantly)\n` : '') +
            (lmRows.length > 0 ? `Lead Master: ${lmRows.length} new rows added\n` : '') +
            activationWarning +
            `\n📧 Emails sending per campaign schedule. Check \`/replies ${showName}\` in 3-4 days.`
          );
        } catch (err: any) {
          return `❌ Launch failed: ${err.message}`;
        }
      },
      onReject: async () => `Campaign launch for *${campaignName}* cancelled.`,
    });

    const campaignNote = campaign
      ? `Using existing campaign: *${campaign.name}* [${campaignStatusLabel(campaign.status)}]`
      : `*New campaign will be created:* "${campaignName}"`;

    await sendToMo(formatType1(
      `Launch Campaign: ${showName}`,
      `${prospects.length} new leads → ${campaignName}`,
      `*${prospects.length}* new leads from Drive.\n` +
      `${skippedAlreadySent > 0 ? `${skippedAlreadySent} already sent — deduped.\n\n` : '\n'}` +
      `${campaignNote}\n\n` +
      `Approve to push all at once.`,
      approvalId
    ));

    await this.respond(ctx.chatId,
      `📤 *Approval sent to Mo.*\n\n` +
      `*${prospects.length}* new ${showName} leads ready.\n` +
      `${skippedAlreadySent > 0 ? `${skippedAlreadySent} already sent — deduped.\n` : ''}` +
      `${campaignNote}\n\n` +
      `Mo approves with \`/approve_${approvalId}\` to push all at once.`
    );

    return { success: true, message: `Launch: ${prospects.length} leads pending approval for ${showName}`, confidence: 'HIGH' };
  }

  // ── /convert [email or company] — campaign reply → LEAD_MASTER pipeline ───

  private async runConvert(ctx: AgentContext): Promise<AgentResponse> {
    const query = (ctx.args || '').trim();
    if (!query) {
      await this.respond(ctx.chatId,
        'Usage: `/convert [email or company name]`\n\n' +
        'Converts a campaign reply into a LEAD_MASTER pipeline entry and creates an EMAIL_FUNNEL row for Agent-19.\n\n' +
        'Example: `/convert john@pharma.de`\nExample: `/convert PharmaCorp`'
      );
      return { success: false, message: 'No query', confidence: 'HIGH' };
    }

    // Step 1 — Find in CAMPAIGN_SALES by email or company name
    const salesRows = await readSheet(SHEETS.CAMPAIGN_SALES).catch(() => [] as string[][]);
    const queryLower = query.toLowerCase().trim();
    const isEmail    = queryLower.includes('@');

    let matchIndex = -1;
    let matchRow: string[] = [];
    for (let i = 1; i < salesRows.length; i++) {
      const rowEmail   = (salesRows[i][5] || '').toLowerCase().trim();
      const rowCompany = (salesRows[i][3] || '').toLowerCase().trim();
      if (isEmail ? rowEmail === queryLower : rowCompany.includes(queryLower)) {
        matchIndex = i + 1; // 1-indexed sheet row
        matchRow   = salesRows[i];
        break;
      }
    }

    if (!matchRow.length) {
      await this.respond(ctx.chatId,
        `No campaign record found for "*${query}*" in CAMPAIGN_SALES.\n\n` +
        `Run \`/replies\` to see recent campaign replies and get the email address.`
      );
      return { success: false, message: 'Not found in CAMPAIGN_SALES', confidence: 'HIGH' };
    }

    const companyName    = matchRow[3] || '';
    const contactName    = matchRow[4] || '';
    const contactEmail   = matchRow[5] || '';
    const showName       = matchRow[2] || '';
    const campaignId     = matchRow[1] || '';
    const existingLeadId = matchRow[17] || '';

    // Step 2 — Already converted?
    if (existingLeadId) {
      await this.respond(ctx.chatId,
        `*${companyName}* is already in the pipeline as lead \`${existingLeadId}\`.\n\n` +
        `Run \`/brief ${companyName}\` to generate a concept brief.`
      );
      return { success: true, message: 'Already converted', confidence: 'HIGH' };
    }

    // Step 3 — Check LEAD_MASTER dedup by email or company name
    const masterRows = await readSheet(SHEETS.LEAD_MASTER).catch(() => [] as string[][]);
    const emailLower  = contactEmail.toLowerCase().trim();
    const existingRow = masterRows.slice(1).find(r =>
      (r[4]  || '').toLowerCase() === emailLower ||
      (r[21] || '').toLowerCase() === emailLower ||
      (r[2]  || '').toLowerCase().trim() === companyName.toLowerCase().trim()
    );

    if (existingRow) {
      const existingId = existingRow[0];
      await updateCell(SHEETS.CAMPAIGN_SALES, matchIndex, 'R', existingId).catch(() => {});
      await this.respond(ctx.chatId,
        `*${companyName}* is already in Lead Master as \`${existingId}\`.\n\n` +
        `CAMPAIGN_SALES linked. Run \`/brief ${companyName}\` to proceed.`
      );
      return { success: true, message: 'Already in LEAD_MASTER, linked', confidence: 'HIGH' };
    }

    const leadId = await generateLeadId();
    const now    = new Date().toISOString();

    const collectedInfo = {
      standSize: matchRow[9]  || '',
      budget:    matchRow[10] || '',
      website:   matchRow[19] || '',
    };

    // Step 3 — Create LEAD_MASTER row
    await appendRow(SHEETS.LEAD_MASTER, objectToRow(SHEETS.LEAD_MASTER, {
      id:              leadId,
      timestamp:       now,
      companyName,
      contactName,
      contactEmail,
      contactTitle:    '',
      showName,
      showCity:        '',
      standSize:       collectedInfo.standSize,
      budget:          collectedInfo.budget,
      industry:        '',
      leadSource:      'instantly-campaign',
      score:           '9',
      scoreBreakdown:  JSON.stringify({ showFit: 2, sizeSignal: 2, industryFit: 1, dmSignal: 2, timeline: 2 }),
      confidence:      'HIGH',
      status:          'HOT',
      trelloCardId:    '',
      enrichmentStatus: 'DONE',
      dmName:          contactName,
      dmTitle:         '',
      dmLinkedIn:      '',
      dmEmail:         contactEmail,
      outreachReadiness: 'CONTACTED',
      language:        'en',
      notes:           `Campaign reply converted. Campaign: ${campaignId}. Website: ${collectedInfo.website || '—'}`,
    }));

    // Step 4 — Create EMAIL_FUNNEL row so Agent-19 can continue the conversation
    await appendRow(SHEETS.EMAIL_FUNNEL, objectToRow(SHEETS.EMAIL_FUNNEL, {
      id:              `EF-${Date.now()}`,
      leadId,
      companyName,
      contactName,
      contactEmail,
      gmailThreadId:   '',
      lastMessageId:   '',
      funnelStage:     'QUALIFYING',
      lastContact:     now,
      sentCount:       '0',
      showName,
      standSize:       collectedInfo.standSize,
      budget:          collectedInfo.budget,
      notes:           `Converted from Instantly campaign reply`,
      conversationLog: '[]',
    })).catch((err: any) => logger.warn(`[Convert] EMAIL_FUNNEL write failed: ${err.message}`));

    // Step 5 — Start pipeline tracker
    pipelineRunner.start(leadId, companyName);

    // Step 6 — Link CAMPAIGN_SALES back to the lead
    await updateCell(SHEETS.CAMPAIGN_SALES, matchIndex, 'R', leadId).catch(() => {});

    // Mark pending-conversion KB entry as resolved
    await updateKnowledge(`pending-conversion-${emailLower}`, {
      tags:    'pending-conversion,resolved',
      content: `Converted to LEAD_MASTER (${leadId}) on ${now}. Company: ${companyName}`,
    }).catch(() => {});

    await sendToMo(formatType2(
      `Pipeline Entry: ${companyName}`,
      `*${companyName}* added to pipeline from Instantly campaign reply.\n\n` +
      `Lead ID: ${leadId} (HOT)\n` +
      `Contact: ${contactName} — ${contactEmail}\n` +
      `${collectedInfo.standSize ? `Stand: ${collectedInfo.standSize} sqm\n` : ''}` +
      `${collectedInfo.budget ? `Budget: ${collectedInfo.budget}\n` : ''}` +
      `\nRun \`/brief ${companyName}\` to generate a concept brief.`
    ));

    await this.respond(ctx.chatId,
      `✅ *${companyName}* converted to pipeline!\n\n` +
      `Lead ID: \`${leadId}\` (HOT)\n` +
      `Show: ${showName}\n` +
      `Contact: ${contactName} — ${contactEmail}\n` +
      `${collectedInfo.standSize ? `Stand: ${collectedInfo.standSize} sqm\n` : ''}` +
      `${collectedInfo.budget ? `Budget: ${collectedInfo.budget}\n` : ''}` +
      `\nNext: \`/brief ${companyName}\` to generate concept brief.`
    );

    return { success: true, message: `Converted ${companyName} to pipeline (${leadId})`, confidence: 'HIGH' };
  }

  private async updateLogStatus(logId: string, status: string, ref: string): Promise<void> {
    try {
      const log    = await readSheet(SHEETS.OUTREACH_LOG);
      const rowIdx = log.findIndex(r => r[0] === logId);
      if (rowIdx < 0) return;
      const row = rowIdx + 1;

      // Columns F (status) and H (instantlyId/ref) are not adjacent — update
      // them separately but back-to-back to minimise the half-update window.
      // We still use two calls because updateRange requires a contiguous range.
      if (status) await updateCell(SHEETS.OUTREACH_LOG, row, 'F', status);
      if (ref)    await updateCell(SHEETS.OUTREACH_LOG, row, 'H', ref);
    } catch (err: any) {
      logger.warn(`[Outreach] Could not update log status for ${logId}: ${err.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported: Reconstruct and execute a bulk outreach approval after a redeploy.
// Called from index.ts when handleApproval() returns null for bulkoutreach_ IDs.
// ─────────────────────────────────────────────────────────────────────────────
export async function reconstructBulkApproval(approvalId: string): Promise<string | null> {
  try {
    // Use exact source lookup — avoids fuzzy search returning the wrong approval
    // when multiple bulk outreach approvals are pending simultaneously.
    const entry = await getKnowledgeBySource(`bulk-approval-${approvalId}`).catch(() => null);
    if (!entry) return null;
    const entries = [entry];

    let params: {
      showFilter: string;
      campaignId: string | null;
      campaignName: string;
      createNew: boolean;
      emailSequence?: InstantlyEmailStep[];
    } | null = null;
    try { params = JSON.parse(entries[0].content); } catch { return null; }
    if (!params?.showFilter) return null;

    let { showFilter, campaignId, campaignName, emailSequence } = params;

    // Re-verify or find campaign
    try {
      const liveCampaigns = await listCampaigns();
      const matched = liveCampaigns.filter(c => c.name.toLowerCase().includes(showFilter.toLowerCase()));
      if (matched.length > 0) {
        const exact   = campaignId ? matched.find(c => c.id === campaignId) : null;
        const active  = matched.find(c => c.status === CAMPAIGN_STATUS.ACTIVE);
        const chosen  = exact || active || matched[0];
        campaignId    = chosen.id;
        campaignName  = chosen.name;
      }
    } catch { /* proceed with saved params */ }

    // Rebuild prospects from LEAD_MASTER
    const master   = await readSheet(SHEETS.LEAD_MASTER);
    const showLow  = showFilter.toLowerCase();
    const prospects: InstantlyLead[] = [];

    for (const r of master.slice(1)) {
      const rowShow = (r[6] || '').toLowerCase();
      if (!rowShow.includes(showLow) && !showLow.includes(rowShow)) continue;
      const email = r[21] || r[4];
      if (!email || !email.includes('@')) continue;
      const dmName = r[18] || r[3] || '';
      const parts  = dmName.trim().split(' ').filter(Boolean);
      const raw: InstantlyLead = {
        email,
        first_name: parts[0] || 'Team',
        last_name:  parts.slice(1).join(' ') || '',
        company_name: r[2]  || '',
        personalization: r[10] || 'your upcoming trade show stand',
      };
      // Always sanitize before pushing — strips BOM, control chars, validates email format
      const clean = sanitizeLead(raw);
      if (clean) prospects.push(clean);
    }

    if (!prospects.length) return null;

    // Create campaign if needed
    if (!campaignId && emailSequence?.length) {
      campaignId = await createCampaign(
        campaignName ?? `${showFilter} ${new Date().getFullYear()} - StandMe`,
        emailSequence
      );
    }
    if (!campaignId) return null;

    const result   = await addLeads(campaignId, prospects);
    const logDate  = new Date().toISOString();

    // Batch-write all log rows in a single Sheets API call to avoid quota exhaustion
    const logRows = prospects.map(p => objectToRow(SHEETS.OUTREACH_LOG, {
      id:                 `OL-BULK-R-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      leadId:             '',
      companyName:        p.company_name || '',
      emailType:          'BULK_EMAIL_1',
      sentDate:           logDate,
      status:             'SENT',
      replyClassification: '',
      woodpeckerId:       campaignId,
      notes:              `Bulk reconstruct → Instantly campaign ${campaignId} (${campaignName}) | ${showFilter}`,
    }));
    await appendRows(SHEETS.OUTREACH_LOG, logRows).catch((err: any) =>
      logger.warn(`[Outreach] reconstructBulkApproval OUTREACH_LOG write failed (non-fatal): ${err.message}`)
    );

    // Activate campaign if it was just created — surface any failure clearly
    let reconstructActivationWarning = '';
    try {
      await activateCampaign(campaignId);
    } catch (err: any) {
      logger.warn(`[Outreach] reconstructBulkApproval: could not activate campaign: ${err.message}`);
      reconstructActivationWarning = `\n⚠️ Campaign activation failed: ${err.message}\nActivate it manually in the Instantly dashboard.`;
    }

    return (
      `✅ *Bulk push complete (reconstructed after redeploy)*\n\n` +
      `Campaign: *${campaignName}*\n` +
      `Pushed: *${result.added}* ${showFilter} leads\n` +
      (result.skipped > 0 ? `Skipped: ${result.skipped} (dupes)\n` : '') +
      reconstructActivationWarning +
      `\n📧 Instantly is sending emails per campaign schedule.`
    );
  } catch (err: any) {
    logger.warn(`[Outreach] reconstructBulkApproval failed: ${err.message}`);
    return null;
  }
}
