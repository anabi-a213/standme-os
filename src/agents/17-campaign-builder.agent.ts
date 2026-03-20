/**
 * Agent 17: Campaign Builder — Professional Sales Loop
 *
 * /newcampaign [show name]
 *   Full show research → company discovery → expert email generation → Woodpecker launch
 *
 * /salesreplies (also scheduled every 2h)
 *   Poll Woodpecker for replies → find in Gmail → BANT qualify → handle objections →
 *   generate expert sales reply → Mo approval → send → track deal progress
 *
 * /campaignstatus [show name]
 *   Full pipeline view: Woodpecker stats + deal info per company
 *
 * /indexwoodpecker
 *   Read all Woodpecker campaign emails (sequences) → save to Knowledge Base →
 *   these become training material for future email generation
 */

import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { readSheet, appendRow, appendRows, updateCell, objectToRow, sheetUrl, hasSheet } from '../services/google/sheets';
import { createCard, findListByName } from '../services/trello/client';
import {
  listCampaigns, getCampaign, getCampaignSummary, getAllCampaignSummaries,
  addLeads, listAccounts, getReplies, findCampaignByName,
  campaignStatusLabel, CAMPAIGN_STATUS, isInstantlyConfigured,
  InstantlyLead, InstantlyCampaign,
} from '../services/instantly/client';
import {
  analyzeShow, generateCampaignEmail, generateSalesReply, extractCompaniesFromText, generateText,
} from '../services/ai/client';
import { searchKnowledge, buildKnowledgeContext, saveKnowledge, getKnowledgeByTopic } from '../services/knowledge';
import { searchFiles, readFileContent } from '../services/google/drive';
import { findExhibitorFile, findExhibitorFiles, listExhibitorFiles, parseExhibitorFile, ExhibitorRecord } from '../services/drive-exhibitor';
import { findDecisionMaker } from '../services/apollo';
import { searchEmailsByQuery, sendEmail, bulkSearchEmails } from '../services/google/gmail';
import { registerApproval } from '../services/approvals';
import { sendToMo, formatType1, formatType2, formatType3 } from '../services/telegram/bot';
import { logger } from '../utils/logger';

const SALES_INFO_FIELDS = ['standSize', 'budget', 'showDates', 'phone', 'website', 'requirements', 'logoUrl'];
// Fields that must be present before we can start a concept brief
const BRIEF_REQUIRED_FIELDS = ['standSize', 'budget', 'showDates', 'website'];

export class CampaignBuilderAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Campaign Builder',
    id: 'agent-17',
    description: 'Build and run full show email campaigns with professional sales loop via Instantly',
    commands: ['/newcampaign', '/discover', '/salesreplies', '/campaignstatus', '/indexinstantly', '/indexgmail', '/testlead'],
    schedule: '0 */2 * * *', // every 2 hours for reply monitoring
    requiredRole: UserRole.ADMIN,
  };

  // Instance-level industry hook cache — persists across command executions so
  // approval callbacks (which fire hours after /newcampaign) can still resolve hooks.
  private campaignHookCache = new Map<string, string>();

  private async getCampaignIndustryHook(industry: string, showName: string): Promise<string> {
    const key = JSON.stringify([industry.toLowerCase(), showName.toLowerCase()]);
    if (this.campaignHookCache.has(key)) return this.campaignHookCache.get(key)!;
    const hook = await generateText(
      `Write ONE cold email opening sentence (max 20 words) for a ${industry} company exhibiting at ${showName}. ` +
      `Be specific about what this industry cares about on the show floor. No em dashes. No filler.`,
      'You write cold email opening lines. Return only the sentence, nothing else.',
      60,
    ).catch(() => '');
    this.campaignHookCache.set(key, hook.trim());
    return hook.trim();
  }

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    if (ctx.command === '/salesreplies' || ctx.command === 'scheduled') return this.handleSalesReplies(ctx);
    if (ctx.command === '/discover') return this.discoverLeads(ctx);
    if (ctx.command === '/campaignstatus') return this.showCampaignStatus(ctx);
    if (ctx.command === '/indexinstantly') return this.indexInstantlyEmails(ctx);
    if (ctx.command === '/indexgmail') return this.indexGmailInboxes(ctx);
    if (ctx.command === '/testlead') return this.createTestLead(ctx);
    return this.buildCampaign(ctx);
  }

  // =====================================================================
  // /indexinstantly — Read all Instantly campaign stats → save to Knowledge Base
  // =====================================================================

  private async indexInstantlyEmails(ctx: AgentContext): Promise<AgentResponse> {
    if (!isInstantlyConfigured()) {
      await this.respond(ctx.chatId, '⚠️ INSTANTLY_API_KEY not set in Railway env.');
      return { success: false, message: 'Not configured', confidence: 'HIGH' };
    }

    await this.respond(ctx.chatId, 'Reading all Instantly campaigns and performance data...');

    let campaigns: InstantlyCampaign[] = [];
    try {
      campaigns = await listCampaigns();
    } catch (err: any) {
      await this.respond(ctx.chatId, `Failed to fetch campaigns: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }

    if (!campaigns.length) {
      await this.respond(ctx.chatId, 'No campaigns found in Instantly. Run `/bulkoutreach [show]` to create the first one.');
      return { success: true, message: 'No campaigns', confidence: 'HIGH' };
    }

    let savedStats = 0;

    // Fetch all summaries in one request
    try {
      const summaries = await getAllCampaignSummaries(campaigns.map(c => c.id));
      for (const s of summaries) {
        if (s.emails_sent > 0) {
          await saveKnowledge({
            source:     `instantly-campaign-${s.campaign_id}`,
            sourceType: 'manual',
            topic:      `campaign-performance-${s.campaign_name}`,
            tags:       `instantly,performance,analytics,campaign,outreach`,
            content:    `Campaign "${s.campaign_name}": ${s.emails_sent} sent, ${s.open_rate}% open rate, ${s.reply_rate}% reply rate, ${s.bounce_rate}% bounce rate. ${s.replied} replies. This campaign ${s.reply_rate >= 10 ? 'performed well' : s.reply_rate >= 5 ? 'performed average' : 'underperformed'}.`,
          });
          savedStats++;
        }
      }
    } catch (err: any) {
      logger.warn(`[CampaignBuilder] Could not fetch Instantly summaries: ${err.message}`);
    }

    const summary =
      `Instantly indexed:\n` +
      `  ${campaigns.length} campaigns\n` +
      `  ${savedStats} performance snapshots saved to Knowledge Base\n\n` +
      `The agent will now use this performance data when writing new campaigns.\n` +
      `Note: Instantly does not expose email sequence bodies via API — add your best-performing emails to the Knowledge Base manually with /seedknowledge.`;

    await this.respond(ctx.chatId, summary);
    return { success: true, message: summary, confidence: 'HIGH' };
  }

  // =====================================================================
  // /discover [show name]
  // Scans the exhibitor list in Drive → finds DMs via Apollo →
  // writes to LEAD_MASTER + CAMPAIGN_SALES → creates Woodpecker campaign
  // =====================================================================

  private async discoverLeads(ctx: AgentContext): Promise<AgentResponse> {
    // Support: /discover Arab Health  OR  /discover Arab Health campaign:12345
    const argsRaw = ctx.args.trim();
    const campaignOverrideMatch = argsRaw.match(/\bcampaign:(\d+)\b/i);
    const campaignOverrideId = campaignOverrideMatch ? parseInt(campaignOverrideMatch[1]) : null;
    const showName = argsRaw.replace(/\bcampaign:\d+\b/i, '').trim();

    if (!showName) {
      await this.respond(
        ctx.chatId,
        'Usage: /discover [show name]\n\nExample: /discover Arab Health\n' +
        'Or with explicit campaign: /discover Arab Health campaign:12345\n\n' +
        'Scans the exhibitor list from Drive, finds decision makers via Apollo, ' +
        'and builds a Woodpecker campaign automatically. No manual steps needed.'
      );
      return { success: false, message: 'No show name', confidence: 'LOW' };
    }

    await this.respond(ctx.chatId, `Starting lead discovery for *${showName}*...\n\nScanning Drive folder for exhibitor files...`);

    // ---- 1. Find all matching exhibitor files ----

    const files = await findExhibitorFiles(showName);
    if (!files.length) {
      const allFiles = await listExhibitorFiles();
      const fileList = allFiles.length
        ? allFiles.map(f => `  • ${f.name}`).join('\n')
        : '  (folder is empty)';
      await this.respond(
        ctx.chatId,
        `No file found matching "*${showName}*" in the exhibitor folder.\n\n` +
        `Available files:\n${fileList}\n\n` +
        `Upload the exhibitor list to the Drive folder and run /discover again.`
      );
      return { success: false, message: 'No exhibitor file found', confidence: 'LOW' };
    }

    await this.respond(ctx.chatId, `Found *${files.length}* file(s):\n${files.map(f => `  • ${f.name}`).join('\n')}\n\nParsing columns and data...`);

    // ---- 2. Parse all files and merge (deduplicate by company name) ----

    let exhibitors: ExhibitorRecord[] = [];
    const seenCompanies = new Set<string>();
    for (const file of files) {
      try {
        const records = await parseExhibitorFile(file);
        for (const r of records) {
          const key = r.companyName.toLowerCase().trim();
          if (!seenCompanies.has(key)) {
            seenCompanies.add(key);
            exhibitors.push(r);
          }
        }
      } catch (err: any) {
        await this.respond(ctx.chatId, `Warning: could not parse "${file.name}": ${err.message}`);
      }
    }

    if (!exhibitors.length) {
      await this.respond(ctx.chatId, 'Files parsed but no company records found. Check file format and try again.');
      return { success: false, message: 'Empty file', confidence: 'LOW' };
    }

    // ---- 3. Detect if file already has email data (skip Apollo if yes) ----

    const withEmail = exhibitors.filter(e => e.contactEmail && e.contactEmail.includes('@')).length;
    const fileHasEmails = withEmail > 0;
    // If the file provides emails for any records, we're in "file-only mode" —
    // use file data as-is and skip Apollo entirely (no slow API calls, no enrichment needed)
    const skipApollo = fileHasEmails;

    await this.respond(
      ctx.chatId,
      `Parsed *${exhibitors.length}* unique companies from ${files.length} file(s).\n` +
      (skipApollo
        ? `Email data found in file (*${withEmail}* records have emails) — skipping Apollo, using file data directly.`
        : `No email data in file — will search Apollo for decision makers...`)
    );

    // ---- 4. Load LEAD_MASTER + CAMPAIGN_SALES for deduplication ----

    const [existingLeads, existingSalesRaw] = await Promise.all([
      readSheet(SHEETS.LEAD_MASTER).catch(() => [] as string[][]),
      hasSheet(SHEETS.CAMPAIGN_SALES)
        ? readSheet(SHEETS.CAMPAIGN_SALES).catch(() => [] as string[][])
        : Promise.resolve([] as string[][]),
    ]);
    const existingSales = existingSalesRaw;

    // Companies already in LEAD_MASTER for this show
    const existingCompanies = new Set<string>();
    for (const row of existingLeads.slice(1)) {
      const co   = (row[2] || '').toLowerCase().trim();
      const show = (row[6] || '').toLowerCase();
      if (co && show.includes(showName.toLowerCase())) existingCompanies.add(co);
    }

    // Emails already in CAMPAIGN_SALES for this show (prevent double-sending)
    const existingEmails = new Set<string>();
    for (const row of existingSales.slice(1)) {
      const show  = (row[2] || '').toLowerCase();
      const email = (row[5] || '').toLowerCase();
      if (email && show.includes(showName.toLowerCase())) existingEmails.add(email);
    }

    // ---- 5. Build verified lead list ----

    interface VerifiedLead {
      exhibitor: ExhibitorRecord;
      contact: {
        name: string; firstName: string; lastName: string;
        title: string; email: string; emailStatus: string; linkedinUrl: string;
      };
    }

    const verified: VerifiedLead[] = [];
    let skippedDupe  = 0;
    let noContact    = 0;
    let processed    = 0;

    for (const exhibitor of exhibitors) {
      processed++;
      const companyKey = exhibitor.companyName.toLowerCase().trim();

      // Skip companies already in the pipeline for this show
      if (existingCompanies.has(companyKey)) { skippedDupe++; continue; }

      // Use email from file if present
      if (exhibitor.contactEmail && exhibitor.contactEmail.includes('@')) {
        if (existingEmails.has(exhibitor.contactEmail.toLowerCase())) { skippedDupe++; continue; }
        verified.push({
          exhibitor,
          contact: {
            name:        exhibitor.contactName || exhibitor.companyName,
            firstName:   (exhibitor.contactName || '').split(' ')[0] || '',
            lastName:    (exhibitor.contactName || '').split(' ').slice(1).join(' ') || '',
            title:       exhibitor.contactTitle || '',
            email:       exhibitor.contactEmail,
            emailStatus: 'from_list',
            linkedinUrl: '',
          },
        });
        continue;
      }

      // File has email column but this row is missing one — skip (no Apollo)
      if (skipApollo) { noContact++; continue; }

      // File has no email data at all — fall back to Apollo
      const contact = await findDecisionMaker(
        exhibitor.companyName,
        exhibitor.website,
        exhibitor.contactEmail,
      );

      if (!contact) { noContact++; continue; }
      if (existingEmails.has(contact.email.toLowerCase())) { skippedDupe++; continue; }

      verified.push({ exhibitor, contact });

      // Progress update every 25 companies so Mo knows it's running
      if (processed % 25 === 0) {
        await this.respond(
          ctx.chatId,
          `Progress: ${processed}/${exhibitors.length} scanned — ${verified.length} verified so far...`
        );
      }
    }

    if (!verified.length) {
      await this.respond(
        ctx.chatId,
        `No new verified contacts found.\n\n` +
        `Scanned: ${exhibitors.length} | Skipped (already in pipeline): ${skippedDupe} | No email/DM: ${noContact}\n\n` +
        (skipApollo
          ? `Tip: The file has emails but all records are already in the pipeline or have no email in the file.`
          : `Tip: Ensure APOLLO_API_KEY is set and the exhibitor file includes company websites.`)
      );
      return { success: false, message: 'No new verified contacts', confidence: 'LOW' };
    }

    await this.respond(
      ctx.chatId,
      (skipApollo ? `File data loaded:\n` : `Apollo search done:\n`) +
      `  ${exhibitors.length} companies scanned\n` +
      `  ${skippedDupe} already in pipeline (skipped)\n` +
      `  ${noContact} no email in file (skipped)\n` +
      `  *${verified.length} new verified contacts*\n\n` +
      `Running show analysis and writing records...`
    );

    // ---- 5. Show analysis (one call — used for snippets + scoring) ----

    const showAnalysis = await analyzeShow(showName, '', '');

    // ---- 6. Pull past Woodpecker campaigns for this show + create new campaign ----

    const campaignResult = await this.analyzeAndCreateCampaign(ctx, showName, campaignOverrideId ?? undefined);
    if (!campaignResult) return { success: false, message: 'No Woodpecker campaign', confidence: 'LOW' };
    const { campaignId, pastAnalysis } = campaignResult;

    // Log the analysis to Knowledge Base so future campaigns can reference it
    if (pastAnalysis) {
      await saveKnowledge({
        source: `woodpecker-analysis-${showName}`,
        sourceType: 'manual',
        topic: `campaign-performance-${showName}`,
        tags: `woodpecker,performance,analytics,${showName.toLowerCase().replace(/\s+/g, '-')}`,
        content: pastAnalysis,
      });
    }

    // ---- 7. Industry hook cache — one Claude call per industry, not per company ----

    const industryHooks = new Map<string, string>();

    async function getIndustryHook(industry: string): Promise<string> {
      if (industryHooks.has(industry)) return industryHooks.get(industry)!;
      const hook = await generateText(
        `Write ONE cold email opening sentence (max 20 words) for a ${industry} company exhibiting at ${showName}. ` +
        `Be specific about what this industry cares about on the show floor. No em dashes. No filler.`,
        'You write cold email opening lines. Return only the sentence, nothing else.',
        60,
      );
      const trimmed = hook.trim();
      industryHooks.set(industry, trimmed);
      return trimmed;
    }

    // ---- 8. Write to LEAD_MASTER + CAMPAIGN_SALES + Woodpecker ----

    let addedMaster   = 0;
    let addedCampaign = 0;
    const now         = new Date().toISOString();

    // Pre-build enriched entries (industry hook lookup per unique industry)
    type EnrichedEntry = {
      exhibitor: ExhibitorRecord;
      contact: { name: string; firstName: string; lastName: string; title: string; email: string; emailStatus: string; linkedinUrl: string };
      industry: string;
      snippet1: string;
      leadId: string;
    };
    const entries: EnrichedEntry[] = [];
    for (const { exhibitor, contact } of verified) {
      const industry = exhibitor.industry || showAnalysis.industries[0] || 'Trade Show';
      const snippet1 = await getIndustryHook(industry);
      const leadId   = `SM-${Date.now()}-${Math.random().toString(36).slice(2, 5)}-D`;
      entries.push({ exhibitor, contact, industry, snippet1, leadId });
    }

    // Write LEAD_MASTER rows — single bulk API call
    const masterRows = entries.map(({ exhibitor, contact, industry, leadId }) =>
      objectToRow(SHEETS.LEAD_MASTER, {
        id:               leadId,
        timestamp:        now,
        companyName:      exhibitor.companyName,
        contactName:      contact.name,
        contactEmail:     exhibitor.contactEmail || '',
        contactTitle:     exhibitor.contactTitle || '',
        showName,
        showCity:         '',
        standSize:        '',
        budget:           '',
        industry,
        leadSource:       'exhibitor-list',
        score:            '6',
        scoreBreakdown:   JSON.stringify({ showFit: 2, exhibitorList: 2, dmFound: 2 }),
        confidence:       contact.emailStatus === 'verified' ? 'HIGH' : 'MEDIUM',
        status:           'WARM',
        trelloCardId:     '',
        enrichmentStatus: 'DONE',
        dmName:           contact.name,
        dmTitle:          contact.title,
        dmLinkedIn:       contact.linkedinUrl,
        dmEmail:          contact.email,
        outreachReadiness: 'READY',
        language:         (exhibitor.country || '').toLowerCase().includes('arab') ? 'ar' : 'en',
        notes:            [
          `Source: ${files.map(f => f.name).join(', ')}`,
          exhibitor.country     ? `Country: ${exhibitor.country}`     : '',
          exhibitor.website     ? `Website: ${exhibitor.website}`     : '',
          exhibitor.boothNumber ? `Booth: ${exhibitor.boothNumber}`   : '',
          `Email status: ${contact.emailStatus}`,
        ].filter(Boolean).join(' | '),
      })
    );
    try {
      await appendRows(SHEETS.LEAD_MASTER, masterRows);
      addedMaster = masterRows.length;
    } catch (err: any) {
      logger.warn(`[CampaignBuilder/discover] LEAD_MASTER bulk write failed: ${err.message}`);
    }

    // Batch-send all Instantly prospects in one pass
    const showTag = showName.toLowerCase().replace(/\s+/g, '-');
    const instantlyProspects: InstantlyLead[] = entries.map(({ exhibitor, contact, industry, snippet1 }) => ({
      email:          contact.email,
      first_name:     contact.firstName,
      last_name:      contact.lastName,
      company_name:   exhibitor.companyName,
      personalization: snippet1 || industry,
      website:        exhibitor.website || '',
      custom_variables: { title: contact.title, industry, country: exhibitor.country || '' },
    }));

    let addResult = { added: 0, skipped: 0, failed: 0 };
    try {
      addResult = await addLeads(String(campaignId), instantlyProspects);
    } catch (err: any) {
      logger.warn(`[CampaignBuilder/discover] Batch Instantly add failed: ${err.message}`);
    }
    const wpIds = entries.map((_, i) => i < addResult.added ? 'sent' : null);

    // Write CAMPAIGN_SALES rows — single bulk API call
    if (hasSheet(SHEETS.CAMPAIGN_SALES)) {
      const salesRows = entries.map(({ exhibitor, contact, leadId }, i) => {
        const salesId = `CS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${i}`;
        const wpId = wpIds[i] ?? null;
        return objectToRow(SHEETS.CAMPAIGN_SALES, {
          id:             salesId,
          campaignId:     String(campaignId),
          showName,
          companyName:    exhibitor.companyName,
          contactName:    contact.name,
          contactEmail:   contact.email,
          woodpeckerId:   String(wpId || ''),
          status:         'SENT',
          classification: '',
          standSize: '', budget: '', showDates: '', phone: '', requirements: '',
          conversationLog: '[]',
          lastReplyDate:  '',
          lastActionDate: now,
          leadMasterId:   leadId,
          notes:          `Discovery from ${files.map(f => f.name).join(', ')}`,
          website:        exhibitor.website || '',
          logoUrl:        '',
        });
      });
      try {
        await appendRows(SHEETS.CAMPAIGN_SALES, salesRows);
        addedCampaign = salesRows.length;
      } catch (err: any) {
        logger.warn(`[CampaignBuilder/discover] CAMPAIGN_SALES bulk write failed: ${err.message}`);
      }
    }

    // ---- 9. Notify Mo ----

    const summary =
      `*${showName} — Lead Discovery Complete*\n\n` +
      `Files: *${files.map(f => f.name).join(', ')}*\n` +
      `Companies scanned: ${exhibitors.length}\n` +
      `Already in pipeline: ${skippedDupe}\n` +
      `No DM found: ${noContact}\n` +
      `Added to LEAD_MASTER: ${addedMaster}\n` +
      `Added to Woodpecker campaign #${campaignId}: ${addedCampaign}\n\n` +
      `*Woodpecker campaign is ready.*\n` +
      `Set up your email sequence in Woodpecker using these personalisation fields:\n` +
      `  {{snippet1}} — industry-specific hook (unique per company type)\n` +
      `  {{snippet2}} — DM job title\n` +
      `  {{snippet3}} — company website or country\n\n` +
      `Once the sequence is set, activate the campaign. All replies will be handled automatically every 2h.`;

    await sendToMo(formatType2(`Discovery Done: ${showName}`, summary));
    await this.respond(ctx.chatId, summary);

    await this.log({
      actionType: 'LEAD_DISCOVERY',
      showName,
      detail: `Discovered ${addedMaster} leads from "${files.map(f => f.name).join(', ')}" → Woodpecker campaign #${campaignId}`,
      result: 'SUCCESS',
    });

    return { success: true, message: summary, confidence: 'HIGH' };
  }

  // =====================================================================
  // /newcampaign [show name]
  // =====================================================================

  private async buildCampaign(ctx: AgentContext): Promise<AgentResponse> {
    // Support: /newcampaign Arab Health  OR  /newcampaign Arab Health campaign:12345
    const argsRaw = ctx.args.trim();
    const campaignOverrideMatch = argsRaw.match(/\bcampaign:(\d+)\b/i);
    const campaignOverrideId = campaignOverrideMatch ? parseInt(campaignOverrideMatch[1]) : undefined;
    const showName = argsRaw.replace(/\bcampaign:\d+\b/i, '').trim();

    if (!showName) {
      await this.respond(ctx.chatId,
        'Usage: /newcampaign [show name]\n\nExample: /newcampaign Arab Health\n' +
        'Or with explicit campaign: /newcampaign Arab Health campaign:12345\n\n' +
        'Tip: run /indexinstantly first to give the agent access to past email performance data.'
      );
      return { success: false, message: 'No show name provided', confidence: 'LOW' };
    }

    await this.respond(ctx.chatId, `Researching *${showName}* and pulling past campaign data from Woodpecker...`);

    // ---- 1. Pull live Woodpecker history + pick campaign (runs in parallel with KB) ----

    const [showKnowledge, campaignResult] = await Promise.all([
      buildKnowledgeContext(showName),
      this.analyzeAndCreateCampaign(ctx, showName, campaignOverrideId),
    ]);

    if (!campaignResult) return { success: false, message: 'No Woodpecker campaign', confidence: 'LOW' };
    const { campaignId, pastAnalysis } = campaignResult;

    // pastAnalysis contains live stats + best email sequences from Woodpecker
    // Fall back to Knowledge Base examples if Woodpecker had no past campaigns
    const kbEmailExamples = (await searchKnowledge('email template outreach', 3))
      .map(k => k.content)
      .filter(c => c.includes('SUBJECT:'))
      .join('\n\n---\n\n');

    const pastEmailExamples = pastAnalysis || kbEmailExamples;

    // ---- 2. Drive research ----

    let driveContent = '';
    let driveCompanies: string[] = [];
    try {
      const driveFiles = await searchFiles(showName);
      const contentParts: string[] = [];
      for (const file of driveFiles.slice(0, 5)) {
        try {
          const content = await readFileContent(file);
          if (content && content.length > 100) {
            contentParts.push(`[${file.name}]\n${content.slice(0, 2000)}`);
            const companies = await extractCompaniesFromText(content, showName);
            driveCompanies.push(...companies);
          }
        } catch { /* skip unreadable */ }
      }
      driveContent = contentParts.join('\n\n---\n\n');
    } catch (err: any) {
      logger.warn(`[CampaignBuilder] Drive search failed: ${err.message}`);
    }

    // ---- 3. AI show analysis ----

    await this.respond(ctx.chatId, `Analysing *${showName}* with professional sales intelligence...`);
    const showAnalysis = await analyzeShow(showName, driveContent, showKnowledge);

    await saveKnowledge({
      source: 'agent-17',
      sourceType: 'manual',
      topic: showName,
      tags: `show,campaign,analysis,${showAnalysis.industries.join(',')}`,
      content: `${showName} show analysis: ${showAnalysis.summary} Buying triggers: ${showAnalysis.buyingTriggers}`,
    });

    // ---- 4. Company discovery ----

    const leadRows = await readSheet(SHEETS.LEAD_MASTER);
    const showLeads = leadRows.slice(1).filter(r => {
      const leadShow = (r[6] || '').toLowerCase();
      const hasDmEmail = !!(r[21] || '').trim();
      return leadShow.includes(showName.toLowerCase()) && hasDmEmail;
    });

    interface Target {
      companyName: string;
      contactName: string;
      contactEmail: string;
      contactTitle: string;  // DM job title → snippet2
      country: string;       // extracted from notes → snippet3 fallback
      website: string;       // extracted from notes → snippet3 primary
      industry: string;
      source: string;
      industryHook: string;  // computed during email gen loop → snippet1
    }

    // One helper to extract website / country from the notes column
    // Notes format: "Source: x | Country: x | Website: x | Booth: x | Email status: x"
    function parseNotes(notes: string): { website: string; country: string } {
      const w = notes.match(/Website:\s*([^|]+)/i);
      const c = notes.match(/Country:\s*([^|]+)/i);
      return { website: w ? w[1].trim() : '', country: c ? c[1].trim() : '' };
    }

    const targets: Target[] = [];
    const seen = new Set<string>();

    for (const row of showLeads) {
      const email = (row[21] || '').trim();
      if (!email || seen.has(email.toLowerCase())) continue;
      seen.add(email.toLowerCase());
      const { website, country } = parseNotes(row[24] || '');
      targets.push({
        companyName: row[2] || '',
        contactName: row[18] || row[3] || '',
        contactEmail: email,
        contactTitle: row[19] || row[5] || '',   // dmTitle (col T) or contactTitle (col F)
        country,
        website,
        industry: row[10] || showAnalysis.industries[0] || '',
        source: 'lead_master',
        industryHook: '',    // filled below in email gen loop
      });
    }

    const driveOnlyCompanies = [...new Set(driveCompanies)].filter(c =>
      !targets.some(t => t.companyName.toLowerCase().includes(c.toLowerCase()))
    );

    await this.respond(
      ctx.chatId,
      `*Show Intelligence Ready*\n\n` +
      `${showAnalysis.summary}\n\n` +
      `*Our angle:* ${showAnalysis.standMeAngle}\n\n` +
      `*Targets with emails:* ${targets.length}\n` +
      `*Drive companies (need enrichment):* ${driveOnlyCompanies.length}\n\n` +
      `Generating personalised emails...`
    );

    if (targets.length === 0) {
      const msg =
        `No leads with DM emails found for *${showName}*.\n\n` +
        (driveOnlyCompanies.length > 0
          ? `Found ${driveOnlyCompanies.length} companies in Drive files needing enrichment:\n` +
            driveOnlyCompanies.slice(0, 10).map(c => `  • ${c}`).join('\n') +
            `\n\nRun /enrich first, then /newcampaign again.`
          : `Add leads via /newlead, run /enrich, then try again.`);
      await this.respond(ctx.chatId, msg);
      return { success: true, message: 'No enriched targets', confidence: 'HIGH' };
    }

    // ---- 5. Generate expert emails ----

    // Industry hook cache — use instance-level cache so approval callbacks (fired hours later) still work

    interface EmailDraft { target: Target; subject: string; body: string; }
    const emailDrafts: EmailDraft[] = [];

    for (const target of targets.slice(0, 10)) {
      try {
        const companyKnowledge = await getKnowledgeByTopic(target.companyName, 3);
        const companyContext = companyKnowledge.map(k => k.content).join(' ');

        // Compute industry hook before email gen so it's in the approval closure
        target.industryHook = await this.getCampaignIndustryHook(target.industry, showName);

        const email = await generateCampaignEmail({
          companyName: target.companyName,
          contactName: target.contactName,
          showName,
          showSummary: showAnalysis.summary,
          standMeAngle: showAnalysis.standMeAngle,
          painPoints: showAnalysis.painPoints,
          buyingTriggers: showAnalysis.buyingTriggers,
          commonObjections: showAnalysis.commonObjections,
          companyContext,
          industry: target.industry,
          emailNumber: 1,
          pastEmailExamples: pastEmailExamples || undefined,
        });
        emailDrafts.push({ target, subject: email.subject, body: email.body });
      } catch (err: any) {
        logger.warn(`[CampaignBuilder] Email gen failed for ${target.companyName}: ${err.message}`);
      }
    }

    if (emailDrafts.length === 0) {
      await this.respond(ctx.chatId, 'Failed to generate emails. Check AI service.');
      return { success: false, message: 'Email generation failed', confidence: 'LOW' };
    }

    // ---- 7. Send batch for approval ----
    // NOTE: emailDrafts = 10 preview samples for Mo to review quality.
    // On approval, ALL targets (up to 1500+) are pushed to Woodpecker, not just the 10.

    const approvalId = `campaign_${showName.replace(/\s+/g, '_').toLowerCase()}_${Date.now()}`;
    const preview = emailDrafts.slice(0, 5).map((d, i) =>
      `*${i + 1}. ${d.target.companyName}*\nSubject: ${d.subject}\n\n${d.body.slice(0, 300)}`
    ).join('\n\n---\n\n');

    const summaryMsg =
      `*Campaign: ${showName}*\n` +
      `Woodpecker Campaign ID: ${campaignId}\n` +
      `*Total prospects to push: ${targets.length}*\n` +
      `(10 email samples shown for quality review)\n\n` +
      `*Show angle:* ${showAnalysis.standMeAngle}\n\n` +
      `*Buying triggers:* ${showAnalysis.buyingTriggers}\n\n` +
      `---\n\n${preview}`;

    registerApproval(approvalId, {
      action: `Launch ${showName} campaign (${targets.length} total prospects)`,
      data: { campaignId, showName, targets: targets.length },
      timestamp: Date.now(),
      onApprove: async () => {
        let pushed = 0;
        let failed = 0;
        const salesRows: string[][] = [];
        const BATCH_NOTIFY = 100; // send progress every N prospects
        const RATE_LIMIT_DELAY = 1000; // 1s pause every 50 WP API calls

        for (let i = 0; i < targets.length; i++) {
          const target = targets[i];
          try {
            // Ensure industry hook is computed (cached from preview or fresh for new industries)
            if (!target.industryHook) {
              target.industryHook = await this.getCampaignIndustryHook(target.industry, showName);
            }

            const nameParts = target.contactName.trim().split(/\s+/);
            const prospect: InstantlyLead = {
              email:          target.contactEmail,
              first_name:     nameParts[0] || target.contactName,
              last_name:      nameParts.slice(1).join(' ') || '',
              company_name:   target.companyName,
              personalization: target.industryHook || target.industry,
              website:        target.website || '',
              custom_variables: { title: target.contactTitle, country: target.country || '' },
            };

            await addLeads(String(campaignId), [prospect]);
            const wpId = 'sent';
            pushed++;

            // Batch CAMPAIGN_SALES rows — write in bulk later
            if (hasSheet(SHEETS.CAMPAIGN_SALES)) {
              salesRows.push(objectToRow(SHEETS.CAMPAIGN_SALES, {
                id: `CS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                campaignId: String(campaignId),
                showName,
                companyName: target.companyName,
                contactName: target.contactName,
                contactEmail: target.contactEmail,
                woodpeckerId: String(wpId || ''),
                status: 'SENT',
                classification: '',
                standSize: '', budget: '', showDates: '', phone: '', requirements: '',
                conversationLog: '',
                lastReplyDate: '',
                lastActionDate: new Date().toISOString(),
                leadMasterId: '',
                notes: `Source: ${target.source}`,
                website: target.website || '',
                logoUrl: '',
              }));
            }

            // Rate-limit: brief pause every 50 Instantly API calls
            if (i > 0 && i % 50 === 0) {
              await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY));
            }

            // Progress notification to Telegram every BATCH_NOTIFY
            if (i > 0 && i % BATCH_NOTIFY === 0) {
              await sendToMo(`⏳ *Campaign ${showName}* — ${pushed}/${targets.length} prospects added to Instantly...`);
            }

          } catch (err: any) {
            failed++;
            logger.warn(`[CampaignBuilder] Push failed for ${target.companyName}: ${err.message}`);
          }
        }

        // Bulk-write CAMPAIGN_SALES in one shot (avoid 1500 individual API calls)
        if (salesRows.length > 0 && hasSheet(SHEETS.CAMPAIGN_SALES)) {
          try {
            await appendRows(SHEETS.CAMPAIGN_SALES, salesRows);
          } catch (err: any) {
            logger.warn(`[CampaignBuilder] CAMPAIGN_SALES batch write failed: ${err.message}`);
          }
        }

        const salesSheetLink = sheetUrl(SHEETS.CAMPAIGN_SALES);
        return `✅ Campaign *${showName}* launched.\n\n` +
          `📬 *${pushed}/${targets.length}* prospects added to Instantly campaign ${campaignId}.\n` +
          (failed > 0 ? `⚠️ ${failed} failed (duplicate emails or API errors)\n` : '') +
          `Reply monitoring active every 2h.` +
          (salesSheetLink ? `\n📊 [View Campaign Sales](${salesSheetLink})` : '');
      },
      onReject: async () => `Campaign *${showName}* cancelled.`,
    });

    await sendToMo(formatType1(
      `Launch Campaign: ${showName}`,
      `${targets.length} total prospects | ${emailDrafts.length} email samples | Campaign ${campaignId}`,
      summaryMsg,
      approvalId
    ));

    await this.respond(ctx.chatId,
      `*${emailDrafts.length} email samples* sent to Mo for quality review.\n\n` +
      `Campaign: *${showName}* (Woodpecker ID: ${campaignId})\n` +
      `*Total prospects ready to push: ${targets.length}*\n\n` +
      `Mo reviews quality → approves → all ${targets.length} pushed to Woodpecker automatically.\n\n` +
      `/approve\\_${approvalId} or /reject\\_${approvalId}`
    );

    return { success: true, message: `${targets.length} prospects ready for ${showName} campaign — awaiting Mo approval`, confidence: 'HIGH' };
  }

  // =====================================================================
  // /salesreplies — Full professional sales loop
  // =====================================================================

  private async handleSalesReplies(ctx: AgentContext): Promise<AgentResponse> {
    const isScheduled = ctx.command === 'scheduled';
    if (!isScheduled) await this.respond(ctx.chatId, 'Checking for new replies...');

    let newReplies = 0;
    let escalations = 0;

    try {
      if (!hasSheet(SHEETS.CAMPAIGN_SALES)) {
        if (!isScheduled) await this.respond(ctx.chatId, 'SHEET_CAMPAIGN_SALES not configured — set this env var to enable reply tracking.');
        return { success: false, message: 'SHEET_CAMPAIGN_SALES not set', confidence: 'LOW' };
      }
      const salesRows = await readSheet(SHEETS.CAMPAIGN_SALES);
      const activeRecords = salesRows.slice(1)
        .map((r, i) => ({ row: r, index: i + 2 }))
        .filter(({ row }) => {
          const status = (row[7] || '').toUpperCase();
          return ['SENT', 'OPENED', 'REPLIED', 'MORE_INFO_NEEDED', 'INTERESTED'].includes(status);
        });

      if (activeRecords.length === 0) {
        if (!isScheduled) await this.respond(ctx.chatId, 'No active campaign records to monitor.');
        return { success: true, message: 'No active records', confidence: 'HIGH' };
      }

      // Batch fetch Woodpecker status + sending inbox per campaign
      const campaignIds = [...new Set(activeRecords.map(({ row }) => row[1]).filter(Boolean))];
      const prospectStatusMap = new Map<string, string>();
      const campaignFromEmailMap = new Map<string, string>(); // campaignId → from_email

      for (const cid of campaignIds) {
        try {
          // Use Instantly replies API to detect who has replied
          const replies = await getReplies({ campaignId: cid, limit: 500 }).catch(() => []);
          for (const r of replies) {
            if (r.lead_email) prospectStatusMap.set(r.lead_email.toLowerCase(), 'REPLIED');
          }
          // Get sending account from campaign details
          const campDetails = await getCampaign(cid).catch(() => null);
          if (campDetails) {
            logger.info(`[CampaignBuilder] Campaign ${cid} (${campDetails.name}) status: ${campaignStatusLabel(campDetails.status)}`);
          }
        } catch (err: any) {
          logger.warn(`[CampaignBuilder] Instantly fetch failed for campaign ${cid}: ${err.message}`);
        }
      }

      for (const { row, index } of activeRecords) {
        const salesId = row[0] || '';
        const campaignId = row[1] || '';
        const showName = row[2] || '';
        const companyName = row[3] || '';
        const contactName = row[4] || '';
        const contactEmail = (row[5] || '').toLowerCase();
        const currentStatus = (row[7] || '').toUpperCase();
        const lastReplyDate = row[15] || '';
        const existingLeadMasterId = row[17] || '';

        if (!contactEmail) continue;

        const wpStatus = prospectStatusMap.get(contactEmail);

        // Track opens
        if (wpStatus === 'OPENED' && currentStatus === 'SENT') {
          await updateCell(SHEETS.CAMPAIGN_SALES, index, 'H', 'OPENED');
          await updateCell(SHEETS.CAMPAIGN_SALES, index, 'Q', new Date().toISOString());
          continue;
        }

        const shouldCheckGmail = wpStatus === 'REPLIED' || currentStatus === 'REPLIED';
        if (!shouldCheckGmail) continue;

        // Find the reply in Gmail
        const afterDate = lastReplyDate
          ? new Date(lastReplyDate).toISOString().split('T')[0].replace(/-/g, '/')
          : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0].replace(/-/g, '/');

        let replyBody = '';
        let replyDate = '';
        let replyGmailId = '';   // Gmail internal message ID (for threadId lookup)
        let replyMessageId = ''; // RFC Message-ID header (for In-Reply-To / References)
        try {
          // Scope search to the specific inbox this campaign sends from (from_email)
          // so replies to other connected inboxes don't get mixed up.
          // in:anywhere ensures we also catch replies in Sent/All Mail.
          const fromEmail = campaignId ? campaignFromEmailMap.get(campaignId) : undefined;
          const toFilter = fromEmail ? ` to:${fromEmail}` : '';
          const emails = await searchEmailsByQuery(
            `in:anywhere from:${contactEmail} after:${afterDate}${toFilter}`, 5
          );
          if (emails.length > 0) {
            replyBody = emails[0].body;
            replyDate = emails[0].date;
            replyGmailId = emails[0].id;
            replyMessageId = emails[0].messageId || emails[0].id;
          }
        } catch (err: any) {
          logger.warn(`[CampaignBuilder] Gmail search failed for ${contactEmail}: ${err.message}`);
        }

        if (!replyBody) {
          if (wpStatus === 'REPLIED' && currentStatus !== 'REPLIED') {
            await updateCell(SHEETS.CAMPAIGN_SALES, index, 'H', 'REPLIED');
            await updateCell(SHEETS.CAMPAIGN_SALES, index, 'P', new Date().toISOString());
            await updateCell(SHEETS.CAMPAIGN_SALES, index, 'Q', new Date().toISOString());
          }
          continue;
        }

        // Parse stored state
        let conversationHistory: Array<{ role: string; message: string; date: string }> = [];
        try { conversationHistory = JSON.parse(row[14] || '[]'); } catch { /* empty */ }

        const collectedInfo: Record<string, string> = {
          standSize: row[9] || '',
          budget: row[10] || '',
          showDates: row[11] || '',
          phone: row[12] || '',
          requirements: row[13] || '',
          website: row[19] || '',
          logoUrl: row[20] || '',
        };
        const missingInfo = SALES_INFO_FIELDS.filter(f => !collectedInfo[f]);

        const historyText = conversationHistory
          .map(m => `${m.role === 'agent' ? 'StandMe (Mo)' : contactName}: ${m.message}`)
          .join('\n\n');

        // Get relevant knowledge context for this conversation
        const knowledgeCtx = await buildKnowledgeContext(`${showName} ${companyName} exhibition stand`);

        // Generate expert sales reply
        const salesResult = await generateSalesReply({
          companyName,
          contactName,
          showName,
          prospectMessage: replyBody,
          conversationHistory: historyText,
          collectedInfo,
          missingInfo,
          knowledgeContext: knowledgeCtx,
        });

        const { reply, classification, extractedInfo, urgencyUsed } = salesResult;
        const updatedInfo = { ...collectedInfo, ...extractedInfo };

        // Save the reply to knowledge base for learning
        await saveKnowledge({
          source: `sales-reply-${salesId}`,
          sourceType: 'manual',
          topic: `${companyName}-${showName}`,
          tags: `sales-reply,${classification.toLowerCase()},${showName.toLowerCase().replace(/\s+/g, '-')}`,
          content: `Reply from ${companyName} at ${showName}: "${replyBody.slice(0, 200)}" | Classification: ${classification} | Info extracted: ${JSON.stringify(extractedInfo)}`,
        });

        // NOT_INTERESTED — log and move on
        if (classification === 'NOT_INTERESTED') {
          await updateCell(SHEETS.CAMPAIGN_SALES, index, 'H', 'NOT_INTERESTED');
          await updateCell(SHEETS.CAMPAIGN_SALES, index, 'I', classification);
          await updateCell(SHEETS.CAMPAIGN_SALES, index, 'Q', new Date().toISOString());
          await sendToMo(formatType2(
            `Not Interested: ${companyName}`,
            `*Show:* ${showName}\n*Contact:* ${contactEmail}\n\nTheir message:\n${replyBody.slice(0, 300)}\n\nFiled as NOT_INTERESTED.`
          ));
          continue;
        }

        // READY_TO_CLOSE — escalate directly to Mo with full deal summary
        if (classification === 'READY_TO_CLOSE') {
          const dealInfo = Object.entries(updatedInfo)
            .filter(([, v]) => v)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n');

          await sendToMo(formatType2(
            `CLOSE THIS DEAL: ${companyName}`,
            `*Show:* ${showName}\n*Contact:* ${contactName} — ${contactEmail}\n\n*Deal Info:*\n${dealInfo || 'Check conversation'}\n\n*Their last message:*\n${replyBody.slice(0, 400)}\n\n*Proposed reply (send manually or approve via /salesreplies):*\n${reply}`
          ));
          await updateCell(SHEETS.CAMPAIGN_SALES, index, 'H', 'INTERESTED');
          await updateCell(SHEETS.CAMPAIGN_SALES, index, 'I', classification);

          // Auto-enter into sales pipeline immediately
          if (!existingLeadMasterId) {
            await this.convertToLead(row, index, updatedInfo, showName, contactName, contactEmail);
          }

          escalations++;
          newReplies++;
          continue;
        }

        newReplies++;

        // Register approval for sales reply
        const approvalId = `salesreply_${salesId}_${Date.now()}`;

        registerApproval(approvalId, {
          action: `Send sales reply to ${companyName}`,
          data: { salesId, contactEmail, reply, updatedInfo, companyName, showName, index, conversationHistory, replyBody, replyDate, replyGmailId },
          timestamp: Date.now(),
          onApprove: async () => {
            try {
              const subject = `Re: Your stand at ${showName}`;
              // Pass threading headers so our reply lands inside the prospect's existing thread
              // inReplyToMessageId = Gmail internal ID (for threadId lookup)
              // references = RFC Message-ID (for email client thread grouping)
              await sendEmail(contactEmail, subject, reply, replyGmailId || undefined, replyMessageId || undefined);

              conversationHistory.push(
                { role: 'prospect', message: replyBody, date: replyDate },
                { role: 'agent', message: reply, date: new Date().toISOString() }
              );

              await updateCell(SHEETS.CAMPAIGN_SALES, index, 'H', classification === 'INTERESTED' ? 'INTERESTED' : 'REPLIED');
              await updateCell(SHEETS.CAMPAIGN_SALES, index, 'I', classification);
              if (updatedInfo.standSize) await updateCell(SHEETS.CAMPAIGN_SALES, index, 'J', updatedInfo.standSize);
              if (updatedInfo.budget) await updateCell(SHEETS.CAMPAIGN_SALES, index, 'K', updatedInfo.budget);
              if (updatedInfo.showDates) await updateCell(SHEETS.CAMPAIGN_SALES, index, 'L', updatedInfo.showDates);
              if (updatedInfo.phone) await updateCell(SHEETS.CAMPAIGN_SALES, index, 'M', updatedInfo.phone);
              if (updatedInfo.requirements) await updateCell(SHEETS.CAMPAIGN_SALES, index, 'N', updatedInfo.requirements);
              await updateCell(SHEETS.CAMPAIGN_SALES, index, 'O', JSON.stringify(conversationHistory).slice(0, 5000));
              await updateCell(SHEETS.CAMPAIGN_SALES, index, 'P', replyDate);
              await updateCell(SHEETS.CAMPAIGN_SALES, index, 'Q', new Date().toISOString());
              if (updatedInfo.website) await updateCell(SHEETS.CAMPAIGN_SALES, index, 'T', updatedInfo.website);
              if (updatedInfo.logoUrl) await updateCell(SHEETS.CAMPAIGN_SALES, index, 'U', updatedInfo.logoUrl);

              // Save sent reply to KB for future learning
              await saveKnowledge({
                source: `sent-reply-${salesId}`,
                sourceType: 'manual',
                topic: `email-template-${showName}`,
                tags: `sent-reply,outreach,${classification.toLowerCase()},${showName.toLowerCase().replace(/\s+/g, '-')}`,
                content: `Sent reply to ${companyName} (${showName}): "${reply.slice(0, 400)}"`,
              });

              // Auto-enter pipeline when prospect shows interest
              if (classification === 'INTERESTED' && !existingLeadMasterId) {
                await this.convertToLead(row, index, updatedInfo, showName, contactName, contactEmail);
              }

              // When all key fields are collected, prompt Mo to run a concept brief
              const isReadyForBrief = BRIEF_REQUIRED_FIELDS.every(f => updatedInfo[f]);
              if (isReadyForBrief) {
                await sendToMo(formatType2(
                  `Brief Ready: ${companyName}`,
                  `All key info collected for *${companyName}* — ${showName}.\n\n` +
                  `Size: ${updatedInfo.standSize} sqm\nBudget: ${updatedInfo.budget}\nDates: ${updatedInfo.showDates}\nWebsite: ${updatedInfo.website}\n\n` +
                  `Run: \`/brief ${companyName} | ${showName}\` to generate the concept brief.`
                ));
              }

              return `Reply sent to *${companyName}* (${contactEmail}). Classification: ${classification}${urgencyUsed ? ' [urgency used]' : ''}`;
            } catch (err: any) {
              return `Failed to send reply to ${companyName}: ${err.message}`;
            }
          },
          onReject: async () => `Reply to *${companyName}* rejected. No email sent.`,
        });

        const approvalDetail =
          `*Company:* ${companyName} (${showName})\n` +
          `*Contact:* ${contactName} — ${contactEmail}\n` +
          `*Classification:* ${classification}\n\n` +
          `*Collected so far:* ${Object.entries(updatedInfo).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' | ') || 'none'}\n\n` +
          `*Their message:*\n${replyBody.slice(0, 400)}\n\n` +
          `*Proposed reply:*\n${reply}`;

        await sendToMo(formatType1(
          `Sales Reply: ${companyName}`,
          `${classification} — ${showName}`,
          approvalDetail,
          approvalId
        ));
      }

      const summary = newReplies > 0
        ? `${newReplies} repl${newReplies === 1 ? 'y' : 'ies'} processed. ${escalations > 0 ? `${escalations} deal(s) ready to close — escalated to Mo.` : ''}`
        : 'No new replies requiring action.';

      if (!isScheduled) await this.respond(ctx.chatId, summary);
      return { success: true, message: summary, confidence: 'HIGH' };

    } catch (err: any) {
      if (!isScheduled) await this.respond(ctx.chatId, `Error: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }
  }

  // =====================================================================
  // /campaignstatus [show name]
  // =====================================================================

  private async showCampaignStatus(ctx: AgentContext): Promise<AgentResponse> {
    const showFilter = ctx.args.trim().toLowerCase();
    await this.respond(ctx.chatId, 'Fetching campaign status...');

    if (!hasSheet(SHEETS.CAMPAIGN_SALES)) {
      await this.respond(ctx.chatId, 'SHEET_CAMPAIGN_SALES not configured — set this env var to enable campaign status tracking.');
      return { success: false, message: 'SHEET_CAMPAIGN_SALES not set', confidence: 'LOW' };
    }
    const salesRows = await readSheet(SHEETS.CAMPAIGN_SALES);
    const records = salesRows.slice(1).filter(r =>
      !showFilter || (r[2] || '').toLowerCase().includes(showFilter)
    );

    if (records.length === 0) {
      await this.respond(ctx.chatId,
        showFilter
          ? `No records for "${ctx.args.trim()}". Run /newcampaign ${ctx.args.trim()} to start.`
          : 'No campaign records. Run /newcampaign [show name] to start.'
      );
      return { success: true, message: 'No records', confidence: 'HIGH' };
    }

    const byShow = new Map<string, typeof records>();
    for (const r of records) {
      const show = r[2] || 'Unknown';
      if (!byShow.has(show)) byShow.set(show, []);
      byShow.get(show)!.push(r);
    }

    const sections: { label: string; content: string }[] = [];

    for (const [show, rows] of byShow) {
      const counts: Record<string, number> = {};
      for (const r of rows) {
        const s = (r[7] || 'SENT').toUpperCase();
        counts[s] = (counts[s] || 0) + 1;
      }

      const interested = rows.filter(r =>
        ['INTERESTED', 'READY_TO_CLOSE'].includes((r[7] || '').toUpperCase())
      );
      const interestedList = interested.length > 0
        ? '\n' + interested.map(r =>
            `  • ${r[3]} — Size: ${r[9] || '?'} | Budget: ${r[10] || '?'} | Phone: ${r[12] || '?'}`
          ).join('\n')
        : '';

      sections.push({
        label: show,
        content: Object.entries(counts).map(([s, n]) => `${s}: ${n}`).join(' | ') + interestedList,
      });
    }

    // Live Instantly stats
    const campaignIds = [...new Set(records.map(r => r[1]).filter(Boolean))];
    for (const cid of campaignIds.slice(0, 3)) {
      try {
        const s = await getCampaignSummary(cid);
        sections.push({
          label: `Instantly: ${s.campaign_name || cid}`,
          content: `Sent: ${s.emails_sent} | Opens: ${s.open_rate}% | Replies: ${s.reply_rate}% | Bounces: ${s.bounce_rate}%`,
        });
      } catch { /* skip */ }
    }

    await this.respond(ctx.chatId, formatType3(
      showFilter ? `Campaign: ${ctx.args.trim()}` : 'All Campaigns',
      sections
    ));
    return { success: true, message: `Status shown`, confidence: 'HIGH' };
  }

  // =====================================================================
  // /testlead — Insert a synthetic test record to verify the sales loop
  // =====================================================================

  /**
   * Usage: /testlead [contact@email.com]
   *
   * Inserts a row into CAMPAIGN_SALES with status REPLIED so you can:
   *   1. Send a real email from [contact@email.com] to info@standme.de saying
   *      "We're interested in a stand for Arab Health — 18sqm, budget €25k"
   *   2. Run /salesreplies to verify the full AI reply loop fires correctly
   *
   * Deletes the test row after 24h automatically (it's marked TEST_[timestamp]).
   */
  private async createTestLead(ctx: AgentContext): Promise<AgentResponse> {
    if (!hasSheet(SHEETS.CAMPAIGN_SALES)) {
      await this.respond(ctx.chatId, 'SHEET_CAMPAIGN_SALES not configured. Set that env var first.');
      return { success: false, message: 'SHEET_CAMPAIGN_SALES not set', confidence: 'LOW' };
    }

    const contactEmail = ctx.args.trim() || 'test@example.com';
    const testId = `TEST-${Date.now()}`;
    const now = new Date().toISOString();

    // Col order: A(id) B(campaignId) C(show) D(company) E(contact) F(email) G(wpId) H(status)
    const testRow = [
      testId,                  // A — id
      '',                      // B — campaignId (none — no real Woodpecker record)
      'Arab Health',           // C — showName
      'Test Company Ltd',      // D — companyName
      'Test Contact',          // E — contactName
      contactEmail,            // F — contactEmail
      '',                      // G — woodpeckerId
      'REPLIED',               // H — status (so /salesreplies picks it up)
      '',                      // I — classification
      '18sqm',                 // J — standSize
      '€25,000',               // K — budget
      'Jan 2026',              // L — showDates
      '',                      // M — phone
      'Custom stand, meeting area, branding walls', // N — requirements
      '[]',                    // O — conversationLog
      '',                      // P — lastReplyDate
      now,                     // Q — lastActionDate
      '',                      // R — leadMasterId
      `TEST RECORD — created ${now}. Delete manually after testing.`, // S — notes
      'https://testcompany.com', // T — website
    ];

    await appendRow(SHEETS.CAMPAIGN_SALES, testRow);

    const instructions = [
      `✅ *Test record created* (ID: \`${testId}\`)`,
      '',
      '*To test the full sales loop:*',
      `1. Send an email *from* \`${contactEmail}\` *to* \`info@standme.de\``,
      '   Subject: "Stand for Arab Health"',
      '   Body: "Hi, we\'re interested in a custom stand for Arab Health 2026. Looking at 18sqm, budget around €25k. Can you help?"',
      '',
      '2. Wait 1-2 minutes, then run /salesreplies',
      '',
      '3. If it works: you\'ll get Mo\'s AI-generated reply draft to approve',
      '',
      `*Delete the test row* from CAMPAIGN_SALES (row ID: \`${testId}\`) after testing.`,
    ].join('\n');

    await this.respond(ctx.chatId, instructions);
    return { success: true, message: `Test record ${testId} created`, confidence: 'HIGH' };
  }

  // =====================================================================
  // /indexgmail — Scan all Woodpecker-connected inboxes → Knowledge Base
  // =====================================================================

  /**
   * /indexgmail [days]
   *
   * Reads all Gmail inboxes that Woodpecker campaigns send FROM (plus
   * the main connected account). For every real business email found:
   *  - Classifies it: inquiry / reply / objection / close / other
   *  - Extracts show name, company, intent signals, requirements, pricing
   *  - Saves structured insight to the Knowledge Base
   *
   * This trains the AI to write better emails, handle objections smarter,
   * and understand your business patterns from real conversations.
   */
  private async indexGmailInboxes(ctx: AgentContext): Promise<AgentResponse> {
    const daysBack = Math.min(parseInt(ctx.args.trim() || '90', 10) || 90, 365);
    const afterDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0].replace(/-/g, '/');

    await this.respond(ctx.chatId, `📬 Scanning all Instantly-connected inboxes (last ${daysBack} days)...\n\nThis may take a few minutes for large inboxes.`);

    // ---- 1. Discover all sending inboxes from Instantly ----
    let sendingInboxes: string[] = [];
    try {
      const accounts = await listAccounts();
      sendingInboxes = accounts.map(a => a.email).filter(Boolean);
    } catch (err: any) {
      logger.warn(`[IndexGmail] Could not fetch Instantly accounts: ${err.message}`);
    }

    const mainEmail = process.env.SEND_FROM_EMAIL || 'info@standme.de';
    const allInboxes = [...new Set([mainEmail, ...sendingInboxes])];

    await this.respond(
      ctx.chatId,
      `Found *${allInboxes.length}* connected inbox(es):\n${allInboxes.map(e => `  • ${e}`).join('\n')}\n\nFetching emails...`
    );

    // ---- 2. Build Gmail search query ----
    // in:anywhere = INBOX + Sent + All Mail (without this Gmail only searches INBOX by default)
    // Match emails to/from any of the Woodpecker-connected inboxes
    // Exclude: newsletters, auto-replies, notifications, internal system emails
    const inboxFilters = allInboxes.map(e => `(to:${e} OR from:${e})`).join(' OR ');
    const excludeFilter = '-from:noreply -from:no-reply -from:mailer -from:newsletter -from:notification -from:automated -from:donotreply -from:postmaster -from:bounce -from:railwayapp -subject:unsubscribe';
    const query = `in:anywhere (${inboxFilters}) after:${afterDate} ${excludeFilter}`;

    let allEmails: Awaited<ReturnType<typeof bulkSearchEmails>> = [];
    try {
      allEmails = await bulkSearchEmails(query, 300);
    } catch (err: any) {
      await this.respond(ctx.chatId, `❌ Gmail scan failed: ${err.message}\n\nCheck that GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN are set correctly.`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }

    if (allEmails.length === 0) {
      await this.respond(ctx.chatId, `No business emails found in the last ${daysBack} days for: ${allInboxes.join(', ')}`);
      return { success: true, message: 'No emails found', confidence: 'HIGH' };
    }

    await this.respond(ctx.chatId, `Found *${allEmails.length}* emails. Analysing for business intelligence...`);

    // ---- 3. Filter out internal/system emails ----
    const autoSenderPatterns = /noreply|no-reply|newsletter|mailer|notification|automated|donotreply|postmaster|bounce|alert|digest|instantly|railwayapp|github|google|microsoft/i;
    const businessEmails = allEmails.filter(e => {
      if (autoSenderPatterns.test(e.from)) return false;
      if (e.body.length < 40) return false; // skip empty/very short messages
      return true;
    });

    await this.respond(ctx.chatId, `*${businessEmails.length}* business emails after filtering. Extracting insights in batches...`);

    // ---- 4. Extract intelligence in batches of 8 emails ----
    const BATCH_SIZE = 8;
    let savedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < businessEmails.length; i += BATCH_SIZE) {
      const batch = businessEmails.slice(i, i + BATCH_SIZE);

      // Build batch prompt — compact representation of each email
      const emailsText = batch.map((e, idx) =>
        `[EMAIL ${idx + 1}]\nFrom: ${e.from}\nTo: ${e.to}\nSubject: ${e.subject}\nDate: ${e.date}\nBody (first 600 chars): ${e.body.slice(0, 600)}`
      ).join('\n\n---\n\n');

      const extractionPrompt = `You are analysing sales emails for StandMe, an exhibition stand design & build company (Germany + MENA).

Extract business intelligence from these ${batch.length} emails. For each email that contains useful business info, output a JSON array item:

{
  "emailIndex": 1,
  "type": "inquiry|prospect_reply|objection|successful_close|supplier|industry_info|skip",
  "companyName": "...",
  "showName": "...",
  "standSize": "...",
  "budget": "...",
  "industry": "...",
  "keyInsight": "One sentence: what is the most useful thing this email reveals about the prospect, objection, requirement, or business pattern?",
  "emailPatterns": "What worked or didn't work in this email exchange? (tone, subject line, angle, timing)",
  "objection": "If type=objection: exact objection phrased as they said it",
  "tags": "comma-separated tags for KB search"
}

Rules:
- Skip type="skip" for: newsletters, notifications, internal admin, auto-replies, anything with no sales insight
- Be concise — keyInsight max 100 words
- Only include fields you have real data for (leave empty string if unknown)
- Output ONLY the JSON array, nothing else

EMAILS TO ANALYSE:
${emailsText}`;

      try {
        const raw = await generateText(extractionPrompt,
          'You extract business sales intelligence from emails. Output only valid JSON arrays.',
          600
        );

        // Parse Claude's JSON output
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        if (!jsonMatch) continue;
        const items: any[] = JSON.parse(jsonMatch[0]);

        for (const item of items) {
          if (!item || item.type === 'skip' || !item.keyInsight) continue;

          const email = batch[item.emailIndex - 1];
          if (!email) continue;

          const topic = [
            item.type === 'inquiry' ? 'prospect-inquiry' : item.type,
            item.showName || '',
            item.companyName || '',
          ].filter(Boolean).join('-');

          const content = [
            item.companyName ? `Company: ${item.companyName}` : '',
            item.showName ? `Show: ${item.showName}` : '',
            item.standSize ? `Stand size: ${item.standSize}` : '',
            item.budget ? `Budget: ${item.budget}` : '',
            item.industry ? `Industry: ${item.industry}` : '',
            `Type: ${item.type}`,
            `Insight: ${item.keyInsight}`,
            item.emailPatterns ? `Email patterns: ${item.emailPatterns}` : '',
            item.objection ? `Objection: ${item.objection}` : '',
            `From email: ${email.from} | Subject: ${email.subject} | Date: ${email.date}`,
          ].filter(Boolean).join('\n');

          const tags = [
            'gmail-index',
            item.type,
            item.showName ? item.showName.toLowerCase().replace(/\s+/g, '-') : '',
            item.industry ? item.industry.toLowerCase() : '',
            item.tags || '',
          ].filter(Boolean).join(',');

          await saveKnowledge({
            source: `gmail-${email.id}`,
            sourceType: 'manual',
            topic,
            tags,
            content,
          });
          savedCount++;
        }
      } catch (err: any) {
        logger.warn(`[IndexGmail] Batch ${i}-${i + BATCH_SIZE} extraction failed: ${err.message}`);
        errorCount++;
      }

      // Progress update every 5 batches
      if (i > 0 && (i / BATCH_SIZE) % 5 === 0) {
        await this.respond(ctx.chatId, `Progress: ${Math.min(i + BATCH_SIZE, businessEmails.length)}/${businessEmails.length} emails processed — ${savedCount} insights saved so far...`);
      }
    }

    const summary =
      `*Gmail Inbox Index Complete*\n\n` +
      `📬 Inboxes scanned: ${allInboxes.join(', ')}\n` +
      `📧 Emails fetched: ${allEmails.length}\n` +
      `✅ Business emails analysed: ${businessEmails.length}\n` +
      `💡 Insights saved to KB: ${savedCount}\n` +
      (errorCount > 0 ? `⚠️ Batch errors: ${errorCount}\n` : '') +
      `\nThe AI will now use these patterns to:\n` +
      `  • Write more personalised cold emails\n` +
      `  • Handle objections better in replies\n` +
      `  • Understand your clients' language and requirements\n\n` +
      `Run /indexgmail again anytime to update with newer emails.`;

    await this.respond(ctx.chatId, summary);
    return { success: true, message: summary, confidence: 'HIGH' };
  }

  // =====================================================================
  // Helpers
  // =====================================================================

  /**
   * Called by the Woodpecker webhook for all non-reply events.
   * Updates CAMPAIGN_SALES status and notifies Mo where needed.
   */
  public async handleWebhookEvent(eventType: string, prospectEmail: string): Promise<void> {
    if (!prospectEmail) return;
    if (!hasSheet(SHEETS.CAMPAIGN_SALES)) return;

    try {
      const salesRows = await readSheet(SHEETS.CAMPAIGN_SALES);
      const match = salesRows.slice(1)
        .map((row, i) => ({ row, index: i + 2 }))
        .find(({ row }) => (row[5] || '').toLowerCase() === prospectEmail.toLowerCase());

      if (!match) {
        logger.warn(`[CampaignBuilder] Webhook ${eventType}: no record for ${prospectEmail}`);
        return;
      }

      const { row, index } = match;
      const companyName = row[3] || '';
      const showName    = row[2] || '';
      const contactName = row[4] || '';
      const existingLeadMasterId = row[17] || '';
      const currentStatus = (row[7] || '').toUpperCase();
      const now = new Date().toISOString();

      switch (eventType.toUpperCase()) {

        case 'OPENED':
          // Only move forward — don't overwrite REPLIED/INTERESTED with OPENED
          if (currentStatus === 'SENT') {
            await updateCell(SHEETS.CAMPAIGN_SALES, index, 'H', 'OPENED');
            await updateCell(SHEETS.CAMPAIGN_SALES, index, 'Q', now);
            logger.info(`[CampaignBuilder] ${companyName} opened email`);
          }
          break;

        case 'BOUNCED':
        case 'INVALID':
          await updateCell(SHEETS.CAMPAIGN_SALES, index, 'H', 'BOUNCED');
          await updateCell(SHEETS.CAMPAIGN_SALES, index, 'I', eventType.toUpperCase());
          await updateCell(SHEETS.CAMPAIGN_SALES, index, 'Q', now);
          await sendToMo(formatType2(
            `Bounced: ${companyName}`,
            `*${companyName}* — ${showName}\nEmail bounced: ${prospectEmail}\n\nFind the correct contact email and update manually.`
          ));
          break;

        case 'INTERESTED':
          // Manually marked as interested in Woodpecker UI
          await updateCell(SHEETS.CAMPAIGN_SALES, index, 'H', 'INTERESTED');
          await updateCell(SHEETS.CAMPAIGN_SALES, index, 'Q', now);
          if (!existingLeadMasterId) {
            const collectedInfo: Record<string, string> = {
              standSize: row[9] || '', budget: row[10] || '',
              showDates: row[11] || '', phone: row[12] || '',
              requirements: row[13] || '', website: row[19] || '', logoUrl: row[20] || '',
            };
            await this.convertToLead(row, index, collectedInfo, showName, contactName, prospectEmail);
          }
          break;

        case 'NOT_INTERESTED':
        case 'UNSUBSCRIBED':
          await updateCell(SHEETS.CAMPAIGN_SALES, index, 'H', 'NOT_INTERESTED');
          await updateCell(SHEETS.CAMPAIGN_SALES, index, 'I', eventType.toUpperCase());
          await updateCell(SHEETS.CAMPAIGN_SALES, index, 'Q', now);
          await sendToMo(formatType2(
            `Not Interested: ${companyName}`,
            `*${companyName}* — ${showName}\n${eventType === 'UNSUBSCRIBED' ? 'Unsubscribed' : 'Marked not interested'}: ${prospectEmail}\n\nRecord closed automatically.`
          ));
          break;
      }
    } catch (err: any) {
      logger.warn(`[CampaignBuilder] handleWebhookEvent (${eventType}) error: ${err.message}`);
    }
  }

  /**
   * Convert a campaign reply into a full sales pipeline entry.
   * Creates a LEAD_MASTER row + Trello card in "02 Qualifying".
   * Safe to call multiple times — skips if leadMasterId already set on the row.
   */
  private async convertToLead(
    row: string[],
    sheetIndex: number,
    info: Record<string, string>,
    showName: string,
    contactName: string,
    contactEmail: string
  ): Promise<void> {
    const companyName = row[3] || '';
    const campaignIdVal = row[1] || '';

    // Guard: leadMasterId is column R (index 17) in CAMPAIGN_SALES.
    // If already set, this prospect was already converted — skip to prevent duplicate leads.
    if (row[17]) {
      logger.info(`[Campaign] Skipping duplicate convertToLead for "${companyName}" — leadMasterId already set: ${row[17]}`);
      return;
    }

    try {
      const leadId = `SM-${Date.now()}-C`; // C suffix = campaign origin

      await appendRow(SHEETS.LEAD_MASTER, objectToRow(SHEETS.LEAD_MASTER, {
        id: leadId,
        timestamp: new Date().toISOString(),
        companyName,
        contactName,
        contactEmail,
        contactTitle: '',
        showName,
        showCity: '',
        standSize: info.standSize || '',
        budget: info.budget || '',
        industry: '',
        leadSource: 'instantly-campaign',
        score: '9',
        scoreBreakdown: JSON.stringify({ showFit: 2, sizeSignal: 2, industryFit: 1, dmSignal: 2, timeline: 2 }),
        confidence: 'HIGH',
        status: 'HOT',
        trelloCardId: '',
        enrichmentStatus: 'DONE',
        dmName: contactName,
        dmTitle: '',
        dmLinkedIn: '',
        dmEmail: contactEmail,
        outreachReadiness: 'CONTACTED',
        language: 'en',
        notes: `Campaign ${campaignIdVal}. Website: ${info.website || '—'}. Logo: ${info.logoUrl || '—'}`,
      }));

      // Trello card in "02 Qualifying" — they already replied, so skip "01 New Inquiry"
      let trelloCardId = '';
      const boardId = process.env.TRELLO_BOARD_SALES_PIPELINE || '';
      if (boardId) {
        try {
          const list = await findListByName(boardId, '02 — Qualifying');
          if (list) {
            const card = await createCard(
              list.id,
              `${companyName} — ${showName}`,
              `Lead: ${leadId} | HOT (Campaign Reply)\n` +
              `Contact: ${contactName} (${contactEmail})\n` +
              `Size: ${info.standSize || 'TBC'} sqm | Budget: ${info.budget || 'TBC'}\n` +
              `Dates: ${info.showDates || 'TBC'}\n` +
              `Website: ${info.website || 'TBC'}\n` +
              `Logo: ${info.logoUrl || 'TBC'}\n` +
              `Source: Woodpecker Campaign ${campaignIdVal}`
            );
            trelloCardId = card.id;
          }
        } catch (err: any) {
          logger.warn(`[CampaignBuilder] Trello card failed for ${companyName}: ${err.message}`);
        }
      }

      // Link CAMPAIGN_SALES back to the lead
      await updateCell(SHEETS.CAMPAIGN_SALES, sheetIndex, 'R', leadId);

      await sendToMo(formatType2(
        `Pipeline Entry: ${companyName}`,
        `*${companyName}* replied to the ${showName} campaign and is now in the pipeline.\n\n` +
        `Lead ID: ${leadId} (HOT)\n` +
        `Contact: ${contactName} — ${contactEmail}\n` +
        `${info.standSize ? `Stand: ${info.standSize} sqm\n` : ''}` +
        `${info.budget ? `Budget: ${info.budget}\n` : ''}` +
        `${info.website ? `Website: ${info.website}\n` : ''}` +
        (trelloCardId ? `\nTrello: 02 Qualifying ✅` : '')
      ));

    } catch (err: any) {
      logger.warn(`[CampaignBuilder] convertToLead failed for ${companyName}: ${err.message}`);
    }
  }

  /**
   * Pull historical Woodpecker campaign data, analyse performance, select a campaign.
   * @param campaignIdOverride — If provided, skip name-matching and use this campaign ID directly.
   * Returns the campaign ID + a performance analysis string for email generation.
   */
  private async analyzeAndCreateCampaign(
    ctx: AgentContext,
    showName: string,
    campaignIdOverride?: number,
  ): Promise<{ campaignId: number; pastAnalysis: string } | null> {

    // ---- 1. Fetch all Woodpecker campaigns ----
    let allCampaigns: { id: number; name: string; status: string }[] = [];
    try {
      allCampaigns = await listCampaigns();
    } catch (err: any) {
      await this.respond(ctx.chatId,
        `❌ Cannot reach Woodpecker API: ${err.message}\n\n` +
        `Check that WOODPECKER_API_KEY is set correctly in Railway.`
      );
      return null;
    }

    // ---- 2. Select campaign ----
    // Priority: explicit override → name-match → ask Mo to create one

    let chosen: { id: number; name: string; status: string } | null = null;

    if (campaignIdOverride) {
      chosen = allCampaigns.find(c => c.id === campaignIdOverride) || null;
      if (!chosen) {
        // Still valid — use the override ID even if not found in list (might be a different account segment)
        chosen = { id: campaignIdOverride, name: `Campaign ${campaignIdOverride}`, status: 'UNKNOWN' };
      }
    } else {
      // Name-match: show name keywords against campaign name
      const showWords = showName.toLowerCase().split(/\s+/);
      const matched = allCampaigns.filter(c => {
        const cn = c.name.toLowerCase();
        return showWords.some(w => w.length > 2 && cn.includes(w));
      });
      // Use highest ID (most recently created) among matches
      const sorted = [...matched].sort((a, b) => b.id - a.id);
      chosen = sorted[0] || null;
    }

    // ---- 3. Pull stats + best email sequences from matched campaigns ----
    // Pull performance from ALL name-matched campaigns for learning, not just chosen
    const learnFromCampaigns = campaignIdOverride
      ? allCampaigns.filter(c => {
          const cn = c.name.toLowerCase();
          const showWords = showName.toLowerCase().split(/\s+/);
          return showWords.some(w => w.length > 2 && cn.includes(w));
        })
      : (chosen ? [chosen] : []);

    const performanceLines: string[] = [];
    const bestEmailExamples: string[] = [];

    for (const past of learnFromCampaigns) {
      try {
        const s = await getCampaignSummary(past.id);

        if (s.emails_sent > 0) {
          const grade = s.reply_rate >= 10 ? 'HIGH PERFORMER' : s.reply_rate >= 5 ? 'AVERAGE' : 'LOW PERFORMER';

          performanceLines.push(
            `Campaign "${past.name}": ${s.emails_sent} sent | ${s.open_rate}% open | ${s.reply_rate}% reply [${grade}]`
          );
        }
      } catch (err: any) {
        logger.warn(`[CampaignBuilder] Could not pull data for past campaign "${past.name}": ${err.message}`);
      }
    }

    const pastAnalysis = [
      learnFromCampaigns.length > 0
        ? `PAST INSTANTLY CAMPAIGNS FOR THIS SHOW (${learnFromCampaigns.length} found):\n${performanceLines.join('\n')}`
        : `No past Instantly campaigns found for ${showName} — this is the first one.`,
    ].filter(Boolean).join('\n');

    if (performanceLines.length > 0) {
      await this.respond(
        ctx.chatId,
        `Analysed *${learnFromCampaigns.length}* past Woodpecker campaign(s) for ${showName}.\n` +
        performanceLines.map(l => `  • ${l}`).join('\n') +
        `\n\nBuilding improved emails...`
      );
    }

    if (chosen) {
      await this.respond(
        ctx.chatId,
        `Using Woodpecker campaign: *${chosen.name}* (ID: \`${chosen.id}\`, status: ${chosen.status})\n\n` +
        (chosen.status === 'PAUSED' ? `⚠️ Campaign is PAUSED in Woodpecker — make sure to activate it after prospects are added.\n\n` : '') +
        `To run as a completely fresh campaign: duplicate it in Woodpecker UI then re-run with campaign:NEW_ID.`
      );
      return { campaignId: chosen.id, pastAnalysis };
    }

    // ---- No matching campaign — show all available campaigns and ask Mo to create/pick one ----
    const campaignList = allCampaigns.length > 0
      ? allCampaigns.slice(0, 15).map(c => `  • *${c.name}* (ID: \`${c.id}\`, ${c.status})`).join('\n')
      : '  (no campaigns found — check WOODPECKER_API_KEY)';

    const noMatchMsg =
      `❌ No Woodpecker campaign found matching *${showName}*.\n\n` +
      `*Your campaigns:*\n${campaignList}\n\n` +
      `*Options:*\n` +
      `1. Create a campaign in Woodpecker UI named "${showName}", then re-run\n` +
      `2. Use an existing campaign by ID: \`/discover ${showName} campaign:12345\``;

    await sendToMo(formatType2(`No Woodpecker campaign for ${showName}`, noMatchMsg));
    await this.respond(ctx.chatId, noMatchMsg);
    return null;
  }
}
