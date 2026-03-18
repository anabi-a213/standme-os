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
import { readSheet, appendRow, updateCell, objectToRow, sheetUrl } from '../services/google/sheets';
import { createCard, findListByName } from '../services/trello/client';
import {
  listCampaigns, getCampaignDetails, getCampaignStats,
  getProspectsByCampaign, addProspectToCampaign, addProspectsToCampaign, WoodpeckerProspect,
} from '../services/woodpecker/client';
import {
  analyzeShow, generateCampaignEmail, generateSalesReply, extractCompaniesFromText, generateText,
} from '../services/ai/client';
import { searchKnowledge, buildKnowledgeContext, saveKnowledge, getKnowledgeByTopic } from '../services/knowledge';
import { searchFiles, readFileContent } from '../services/google/drive';
import { findExhibitorFile, findExhibitorFiles, listExhibitorFiles, parseExhibitorFile, ExhibitorRecord } from '../services/drive-exhibitor';
import { findDecisionMaker } from '../services/apollo';
import { searchEmailsByQuery, sendEmail } from '../services/google/gmail';
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
    description: 'Build and run full show email campaigns with professional sales loop via Woodpecker',
    commands: ['/newcampaign', '/discover', '/salesreplies', '/campaignstatus', '/indexwoodpecker'],
    schedule: '0 */2 * * *', // every 2 hours for reply monitoring
    requiredRole: UserRole.ADMIN,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    if (ctx.command === '/salesreplies' || ctx.command === 'scheduled') return this.handleSalesReplies(ctx);
    if (ctx.command === '/discover') return this.discoverLeads(ctx);
    if (ctx.command === '/campaignstatus') return this.showCampaignStatus(ctx);
    if (ctx.command === '/indexwoodpecker') return this.indexWoodpeckerEmails(ctx);
    return this.buildCampaign(ctx);
  }

  // =====================================================================
  // /indexwoodpecker — Read all campaign emails → save to Knowledge Base
  // =====================================================================

  private async indexWoodpeckerEmails(ctx: AgentContext): Promise<AgentResponse> {
    await this.respond(ctx.chatId, 'Reading all Woodpecker campaigns and email sequences...');

    let campaigns: { id: number; name: string; status: string }[] = [];
    try {
      campaigns = await listCampaigns();
    } catch (err: any) {
      await this.respond(ctx.chatId, `Failed to fetch campaigns: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }

    if (campaigns.length === 0) {
      await this.respond(ctx.chatId, 'No campaigns found in Woodpecker.');
      return { success: true, message: 'No campaigns', confidence: 'HIGH' };
    }

    let savedEmails = 0;
    let savedStats = 0;

    for (const campaign of campaigns) {
      try {
        // Get full campaign details including email sequences
        const details = await getCampaignDetails(campaign.id);
        const emails = details.emails || [];

        for (const emailStep of emails) {
          if (!emailStep.subject || !emailStep.body) continue;
          await saveKnowledge({
            source: `woodpecker-campaign-${campaign.id}`,
            sourceType: 'manual',
            topic: `email-template-${campaign.name}`,
            tags: `woodpecker,email,campaign,outreach,template,${campaign.status.toLowerCase()}`,
            content: `[CAMPAIGN: ${campaign.name}] SUBJECT: ${emailStep.subject}\n\nBODY: ${emailStep.body.slice(0, 400)}`,
          });
          savedEmails++;
        }

        // Also save campaign performance stats as knowledge
        try {
          const stats = await getCampaignStats(campaign.id);
          if (stats.sent > 0) {
            const openRate = Math.round((stats.opened / stats.sent) * 100);
            const replyRate = Math.round((stats.replied / stats.sent) * 100);
            await saveKnowledge({
              source: `woodpecker-campaign-${campaign.id}`,
              sourceType: 'manual',
              topic: `campaign-performance-${campaign.name}`,
              tags: `woodpecker,performance,analytics,campaign,${campaign.status.toLowerCase()}`,
              content: `Campaign "${campaign.name}": ${stats.sent} sent, ${openRate}% open rate, ${replyRate}% reply rate. Interested: ${stats.interested}. This campaign ${replyRate >= 10 ? 'performed well' : replyRate >= 5 ? 'performed average' : 'underperformed'}.`,
            });
            savedStats++;
          }
        } catch { /* stats optional */ }

      } catch (err: any) {
        logger.warn(`[CampaignBuilder] Could not read details for campaign "${campaign.name}": ${err.message}`);
      }
    }

    const summary =
      `Woodpecker indexed:\n` +
      `  ${campaigns.length} campaigns\n` +
      `  ${savedEmails} email sequences saved to Knowledge Base\n` +
      `  ${savedStats} performance snapshots saved\n\n` +
      `The agent will now use these as reference when writing new emails.`;

    await this.respond(ctx.chatId, summary);
    return { success: true, message: summary, confidence: 'HIGH' };
  }

  // =====================================================================
  // /discover [show name]
  // Scans the exhibitor list in Drive → finds DMs via Apollo →
  // writes to LEAD_MASTER + CAMPAIGN_SALES → creates Woodpecker campaign
  // =====================================================================

  private async discoverLeads(ctx: AgentContext): Promise<AgentResponse> {
    const showName = ctx.args.trim();
    if (!showName) {
      await this.respond(
        ctx.chatId,
        'Usage: /discover [show name]\n\nExample: /discover Arab Health\n\n' +
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
      process.env[SHEETS.CAMPAIGN_SALES.envKey]
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

    const campaignResult = await this.analyzeAndCreateCampaign(ctx, showName);
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

    // Write LEAD_MASTER rows
    for (const { exhibitor, contact, industry, snippet1, leadId } of entries) {
      try {
        await appendRow(SHEETS.LEAD_MASTER, objectToRow(SHEETS.LEAD_MASTER, {
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
        }));
        addedMaster++;
      } catch (err: any) {
        logger.warn(`[CampaignBuilder/discover] LEAD_MASTER failed for ${exhibitor.companyName}: ${err.message}`);
      }
    }

    // Batch-send all Woodpecker prospects in one pass (100 per request)
    const showTag = showName.toLowerCase().replace(/\s+/g, '-');
    const wpProspects: WoodpeckerProspect[] = entries.map(({ exhibitor, contact, industry, snippet1 }) => ({
      email:      contact.email,
      first_name: contact.firstName,
      last_name:  contact.lastName,
      company:    exhibitor.companyName,
      industry,
      snippet1,
      snippet2:   contact.title,
      snippet3:   exhibitor.website || exhibitor.country || '',
      tags:       `standme,${showTag},discovery`,
    }));

    let wpIds: (number | null)[] = [];
    try {
      wpIds = await addProspectsToCampaign(campaignId, wpProspects);
    } catch (err: any) {
      logger.warn(`[CampaignBuilder/discover] Batch Woodpecker add failed: ${err.message}`);
      wpIds = new Array(entries.length).fill(null);
    }

    // Write CAMPAIGN_SALES rows
    for (let i = 0; i < entries.length; i++) {
      const { exhibitor, contact, leadId } = entries[i];
      const wpId = wpIds[i] ?? null;
      try {
        const salesId = `CS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        if (process.env[SHEETS.CAMPAIGN_SALES.envKey]) await appendRow(SHEETS.CAMPAIGN_SALES, objectToRow(SHEETS.CAMPAIGN_SALES, {
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
        }));
        addedCampaign++;
      } catch (err: any) {
        logger.warn(`[CampaignBuilder/discover] CAMPAIGN_SALES failed for ${exhibitor.companyName}: ${err.message}`);
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
    const showName = ctx.args.trim();
    if (!showName) {
      await this.respond(ctx.chatId,
        'Usage: /newcampaign [show name]\n\nExample: /newcampaign Arab Health\n\nTip: run /indexwoodpecker first to give the agent access to past email performance data.'
      );
      return { success: false, message: 'No show name provided', confidence: 'LOW' };
    }

    await this.respond(ctx.chatId, `Researching *${showName}* and pulling past campaign data from Woodpecker...`);

    // ---- 1. Pull live Woodpecker history + create new campaign (runs in parallel with KB) ----

    const [showKnowledge, campaignResult] = await Promise.all([
      buildKnowledgeContext(showName),
      this.analyzeAndCreateCampaign(ctx, showName),
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
      industry: string;
      source: string;
    }

    const targets: Target[] = [];
    const seen = new Set<string>();

    for (const row of showLeads) {
      const email = (row[21] || '').trim();
      if (!email || seen.has(email.toLowerCase())) continue;
      seen.add(email.toLowerCase());
      targets.push({
        companyName: row[2] || '',
        contactName: row[18] || row[3] || '',
        contactEmail: email,
        industry: row[10] || showAnalysis.industries[0] || '',
        source: 'lead_master',
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

    interface EmailDraft { target: Target; subject: string; body: string; }
    const emailDrafts: EmailDraft[] = [];

    for (const target of targets.slice(0, 10)) {
      try {
        const companyKnowledge = await getKnowledgeByTopic(target.companyName, 3);
        const companyContext = companyKnowledge.map(k => k.content).join(' ');

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

    const approvalId = `campaign_${showName.replace(/\s+/g, '_').toLowerCase()}_${Date.now()}`;
    const preview = emailDrafts.slice(0, 5).map((d, i) =>
      `*${i + 1}. ${d.target.companyName}*\nSubject: ${d.subject}\n\n${d.body.slice(0, 300)}`
    ).join('\n\n---\n\n');

    const summaryMsg =
      `*Campaign: ${showName}*\n` +
      `Woodpecker Campaign ID: ${campaignId}\n` +
      `${emailDrafts.length} personalised emails\n\n` +
      `*Show angle:* ${showAnalysis.standMeAngle}\n\n` +
      `*Buying triggers:* ${showAnalysis.buyingTriggers}\n\n` +
      `---\n\n${preview}`;

    registerApproval(approvalId, {
      action: `Launch ${showName} campaign (${emailDrafts.length} emails)`,
      data: { campaignId, showName, emailDrafts },
      timestamp: Date.now(),
      onApprove: async () => {
        let pushed = 0;
        for (const draft of emailDrafts) {
          try {
            const nameParts = draft.target.contactName.trim().split(' ');
            const prospect: WoodpeckerProspect = {
              email: draft.target.contactEmail,
              first_name: nameParts[0] || draft.target.contactName,
              last_name: nameParts.slice(1).join(' ') || '',
              company: draft.target.companyName,
              industry: draft.target.industry,
              snippet1: showName,
              snippet2: draft.subject,
              snippet3: draft.body.slice(0, 255),
              tags: `standme,${showName.toLowerCase().replace(/\s+/g, '-')}`,
            };

            const wpId = await addProspectToCampaign(campaignId, prospect);
            const salesId = `CS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

            if (process.env[SHEETS.CAMPAIGN_SALES.envKey]) await appendRow(SHEETS.CAMPAIGN_SALES, objectToRow(SHEETS.CAMPAIGN_SALES, {
              id: salesId,
              campaignId: String(campaignId),
              showName,
              companyName: draft.target.companyName,
              contactName: draft.target.contactName,
              contactEmail: draft.target.contactEmail,
              woodpeckerId: String(wpId || ''),
              status: 'SENT',
              classification: '',
              standSize: '', budget: '', showDates: '', phone: '', requirements: '',
              conversationLog: JSON.stringify([{
                role: 'agent',
                message: `Subject: ${draft.subject}\n\n${draft.body}`,
                date: new Date().toISOString(),
              }]),
              lastReplyDate: '',
              lastActionDate: new Date().toISOString(),
              leadMasterId: '',
              notes: `Source: ${draft.target.source}`,
            }));
            pushed++;
          } catch (err: any) {
            logger.warn(`[CampaignBuilder] Push failed for ${draft.target.companyName}: ${err.message}`);
          }
        }
        const salesSheetLink = sheetUrl(SHEETS.CAMPAIGN_SALES);
        return `Campaign *${showName}* launched. ${pushed}/${emailDrafts.length} prospects in Woodpecker campaign ${campaignId}. Reply monitoring active every 2h.${salesSheetLink ? `\n📊 [View Campaign Sales](${salesSheetLink})` : ''}`;
      },
      onReject: async () => `Campaign *${showName}* cancelled.`,
    });

    await sendToMo(formatType1(
      `Launch Campaign: ${showName}`,
      `${emailDrafts.length} expert emails | Campaign ${campaignId}`,
      summaryMsg,
      approvalId
    ));

    await this.respond(ctx.chatId,
      `${emailDrafts.length} email drafts sent to Mo for approval.\n\n` +
      `Campaign: *${showName}* (Woodpecker ID: ${campaignId})\n\n` +
      `/approve\\_${approvalId} or /reject\\_${approvalId}`
    );

    return { success: true, message: `${emailDrafts.length} emails drafted for ${showName}`, confidence: 'HIGH' };
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
      if (!process.env[SHEETS.CAMPAIGN_SALES.envKey]) {
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

      // Batch fetch Woodpecker status
      const campaignIds = [...new Set(activeRecords.map(({ row }) => row[1]).filter(Boolean))];
      const prospectStatusMap = new Map<string, string>();

      for (const cid of campaignIds) {
        try {
          const prospects = await getProspectsByCampaign(Number(cid));
          for (const p of prospects) {
            if (p.email && p.status) prospectStatusMap.set(p.email.toLowerCase(), p.status);
          }
        } catch (err: any) {
          logger.warn(`[CampaignBuilder] Woodpecker fetch failed for campaign ${cid}: ${err.message}`);
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
          : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0].replace(/-/g, '/');

        let replyBody = '';
        let replyDate = '';
        try {
          const emails = await searchEmailsByQuery(`from:${contactEmail} after:${afterDate}`, 5);
          if (emails.length > 0) {
            replyBody = emails[0].body;
            replyDate = emails[0].date;
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
          data: { salesId, contactEmail, reply, updatedInfo, companyName, showName, index, conversationHistory, replyBody, replyDate },
          timestamp: Date.now(),
          onApprove: async () => {
            try {
              const subject = `Re: Your stand at ${showName}`;
              await sendEmail(contactEmail, subject, reply);

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

    if (!process.env[SHEETS.CAMPAIGN_SALES.envKey]) {
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

    // Live Woodpecker stats
    const campaignIds = [...new Set(records.map(r => r[1]).filter(Boolean))];
    for (const cid of campaignIds.slice(0, 3)) {
      try {
        const stats = await getCampaignStats(Number(cid));
        const openRate = stats.sent > 0 ? Math.round((stats.opened / stats.sent) * 100) : 0;
        const replyRate = stats.sent > 0 ? Math.round((stats.replied / stats.sent) * 100) : 0;
        sections.push({
          label: `Woodpecker #${cid}`,
          content: `Sent: ${stats.sent} | Opens: ${openRate}% | Replies: ${replyRate}% | Interested: ${stats.interested}`,
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
  // Helpers
  // =====================================================================

  /**
   * Called by the Woodpecker webhook for all non-reply events.
   * Updates CAMPAIGN_SALES status and notifies Mo where needed.
   */
  public async handleWebhookEvent(eventType: string, prospectEmail: string): Promise<void> {
    if (!prospectEmail) return;
    if (!process.env[SHEETS.CAMPAIGN_SALES.envKey]) return;

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
        leadSource: 'woodpecker-campaign',
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
          const list = await findListByName(boardId, '02 Qualifying');
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
   * Pull historical Woodpecker campaign data, analyse performance, always create a FRESH campaign.
   * Returns the new campaign ID + a performance analysis string for email generation.
   */
  private async analyzeAndCreateCampaign(
    ctx: AgentContext,
    showName: string
  ): Promise<{ campaignId: number; pastAnalysis: string } | null> {

    // ---- 1. Fetch all Woodpecker campaigns ----
    let allCampaigns: { id: number; name: string; status: string }[] = [];
    try {
      allCampaigns = await listCampaigns();
    } catch (err: any) {
      await this.respond(ctx.chatId, `Cannot reach Woodpecker: ${err.message}`);
      return null;
    }

    // ---- 2. Find past campaigns for this show (by name match) ----
    const pastCampaigns = allCampaigns.filter(c =>
      c.name.toLowerCase().includes(showName.toLowerCase().split(' ')[0]) ||
      showName.toLowerCase().split(' ').some(w => w.length > 3 && c.name.toLowerCase().includes(w))
    );

    // ---- 3. Pull stats + best email sequences from past campaigns ----
    const performanceLines: string[] = [];
    const bestEmailExamples: string[] = [];

    for (const past of pastCampaigns) {
      try {
        const [stats, details] = await Promise.all([
          getCampaignStats(past.id),
          getCampaignDetails(past.id),
        ]);

        if (stats.sent > 0) {
          const openRate  = Math.round((stats.opened  / stats.sent) * 100);
          const replyRate = Math.round((stats.replied / stats.sent) * 100);
          const grade = replyRate >= 10 ? 'HIGH PERFORMER' : replyRate >= 5 ? 'AVERAGE' : 'LOW PERFORMER';

          performanceLines.push(
            `Campaign "${past.name}": ${stats.sent} sent | ${openRate}% open | ${replyRate}% reply | ${stats.interested} interested [${grade}]`
          );

          // Save best-performing email sequences as examples
          if (replyRate >= 5 && details.emails?.length) {
            for (const email of details.emails.slice(0, 2)) {
              if (email.subject && email.body) {
                bestEmailExamples.push(
                  `[From "${past.name}" — ${replyRate}% reply rate]\n` +
                  `SUBJECT: ${email.subject}\n` +
                  `BODY: ${email.body.slice(0, 500)}`
                );
              }
            }
          }
        }
      } catch (err: any) {
        logger.warn(`[CampaignBuilder] Could not pull data for past campaign "${past.name}": ${err.message}`);
      }
    }

    const pastAnalysis = [
      pastCampaigns.length > 0
        ? `PAST WOODPECKER CAMPAIGNS FOR THIS SHOW (${pastCampaigns.length} found):\n${performanceLines.join('\n')}`
        : `No past Woodpecker campaigns found for ${showName} — this is the first one.`,
      bestEmailExamples.length > 0
        ? `\nBEST-PERFORMING EMAIL SEQUENCES (use these as style reference):\n\n${bestEmailExamples.join('\n\n---\n\n')}`
        : '',
    ].filter(Boolean).join('\n');

    if (pastCampaigns.length > 0) {
      await this.respond(
        ctx.chatId,
        `Analysed *${pastCampaigns.length}* past Woodpecker campaign(s) for ${showName}.\n` +
        performanceLines.map(l => `  • ${l}`).join('\n') +
        `\n\nCreating fresh campaign and building improved emails...`
      );
    }

    // ---- 4. Select campaign to use ----
    // Woodpecker Classic API does not support creating campaigns programmatically.
    // Use the most recent matching campaign, or guide Mo to create one.

    // Sort past campaigns so the most recently created (highest ID) is first
    const sorted = [...pastCampaigns].sort((a, b) => b.id - a.id);
    const chosen = sorted[0] || null;

    if (chosen) {
      await this.respond(
        ctx.chatId,
        `Using Woodpecker campaign: *${chosen.name}* (ID: ${chosen.id}, status: ${chosen.status})\n\n` +
        `To run this as a fresh campaign, pause it and duplicate it in Woodpecker UI, then re-run.`
      );
      return { campaignId: chosen.id, pastAnalysis };
    }

    // No matching campaign — list all available ones and ask Mo to create/pick one
    const campaignList = allCampaigns
      .slice(0, 10)
      .map(c => `  • ${c.name} (ID: ${c.id}, ${c.status})`)
      .join('\n');

    await sendToMo(formatType2(
      `No Woodpecker campaign for ${showName}`,
      `No campaign matching "${showName}" found.\n\nAvailable campaigns:\n${campaignList || '  (none)'}\n\n` +
      `Create a new campaign in Woodpecker UI named "${showName}" then run /discover ${showName} again.`
    ));
    await this.respond(
      ctx.chatId,
      `No Woodpecker campaign found for *${showName}*.\n\n` +
      `Available campaigns:\n${campaignList || '  (none)'}\n\n` +
      `Create one in Woodpecker UI, then run /discover ${showName} again.`
    );
    return null;
  }
}
