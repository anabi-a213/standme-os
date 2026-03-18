/**
 * Agent 17: Campaign Builder — Full Sales Loop
 *
 * /newcampaign [show name]
 *   1. Research the show from Drive + Knowledge Base
 *   2. Discover all companies to target (LEAD_MASTER + Drive exhibitor lists)
 *   3. AI analyses the show and generates deep-context personalised emails
 *   4. Create or select a Woodpecker campaign for this show
 *   5. Send batch for Mo's approval → push to Woodpecker on approval
 *
 * /salesreplies
 *   Scheduled every 2h + manual trigger.
 *   1. Poll Woodpecker for REPLIED prospects
 *   2. Find the actual reply in Gmail
 *   3. AI classifies + generates a smart sales response
 *   4. Collects key deal info (stand size, budget, dates, phone…)
 *   5. Sends reply to Mo for approval → sends on approval
 *   6. Escalates to Mo on Telegram if uncertain
 *
 * /campaignstatus [show name]
 *   Full status of a show campaign: stats, pipeline, collected deal info
 */

import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import {
  readSheet, appendRow, updateCell, objectToRow, findRowByValue,
} from '../services/google/sheets';
import {
  listCampaigns, createCampaign, getProspectsByCampaign,
  addProspectToCampaign, WoodpeckerProspect,
} from '../services/woodpecker/client';
import {
  analyzeShow, generateCampaignEmail, generateSalesReply, extractCompaniesFromText,
} from '../services/ai/client';
import { searchKnowledge, buildKnowledgeContext, saveKnowledge } from '../services/knowledge';
import { searchFiles, readFileContent } from '../services/google/drive';
import { searchEmailsByQuery } from '../services/google/gmail';
import { registerApproval } from '../services/approvals';
import { sendToMo, formatType1, formatType2, formatType3 } from '../services/telegram/bot';
import { logger } from '../utils/logger';

interface SalesRecord {
  id: string;
  campaignId: string;
  showName: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  woodpeckerId: string;
  status: string;
  classification: string;
  standSize: string;
  budget: string;
  showDates: string;
  phone: string;
  requirements: string;
  conversationLog: string;
  lastReplyDate: string;
  lastActionDate: string;
  leadMasterId: string;
  notes: string;
}

const SALES_INFO_FIELDS = ['standSize', 'budget', 'showDates', 'phone', 'requirements'];

export class CampaignBuilderAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Campaign Builder',
    id: 'agent-17',
    description: 'Build and run full show email campaigns with sales loop via Woodpecker',
    commands: ['/newcampaign', '/salesreplies', '/campaignstatus'],
    schedule: '0 */2 * * *', // every 2 hours for reply monitoring
    requiredRole: UserRole.ADMIN,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    if (ctx.command === '/salesreplies' || ctx.command === 'scheduled') return this.handleSalesReplies(ctx);
    if (ctx.command === '/campaignstatus') return this.showCampaignStatus(ctx);
    return this.buildCampaign(ctx);
  }

  // =====================================================================
  // /newcampaign [show name] — Research → Companies → Emails → Woodpecker
  // =====================================================================

  private async buildCampaign(ctx: AgentContext): Promise<AgentResponse> {
    const showName = ctx.args.trim();
    if (!showName) {
      await this.respond(ctx.chatId, 'Usage: /newcampaign [show name]\n\nExample: /newcampaign Arab Health');
      return { success: false, message: 'No show name provided', confidence: 'LOW' };
    }

    await this.respond(ctx.chatId, `Researching *${showName}*...\n\nSearching Drive, Knowledge Base, and Lead Master.`);

    // ---- 1. Research the show ----

    // a. Knowledge base
    const knowledgeCtx = await buildKnowledgeContext(showName);

    // b. Drive files related to the show
    let driveContent = '';
    let driveCompanies: string[] = [];
    try {
      const driveFiles = await searchFiles(showName);
      const readableFiles = driveFiles.slice(0, 5); // avoid timeout — top 5 most relevant
      const contentParts: string[] = [];
      for (const file of readableFiles) {
        try {
          const content = await readFileContent(file);
          if (content && content.length > 100) {
            contentParts.push(`[${file.name}]\n${content.slice(0, 2000)}`);
            // Extract companies from file
            const companies = await extractCompaniesFromText(content, showName);
            driveCompanies.push(...companies);
          }
        } catch { /* skip unreadable */ }
      }
      driveContent = contentParts.join('\n\n---\n\n');
    } catch (err: any) {
      logger.warn(`[CampaignBuilder] Drive search failed: ${err.message}`);
    }

    // c. AI show analysis
    await this.respond(ctx.chatId, `Analysing *${showName}* with AI...`);
    const showAnalysis = await analyzeShow(showName, driveContent, knowledgeCtx);

    // Save show analysis to knowledge base
    await saveKnowledge({
      source: 'agent-17-campaign-builder',
      sourceType: 'manual',
      topic: showName,
      tags: `show,campaign,${showAnalysis.industries.join(',')}`,
      content: showAnalysis.summary,
    });

    // ---- 2. Discover target companies ----

    // a. From LEAD_MASTER (leads linked to this show, enriched with DM email)
    const leadRows = await readSheet(SHEETS.LEAD_MASTER);
    const showLeads = leadRows.slice(1).filter(r => {
      const leadShow = (r[6] || '').toLowerCase();
      const hasDmEmail = !!(r[21] || '').trim(); // dmEmail col V (index 21)
      return leadShow.includes(showName.toLowerCase()) && hasDmEmail;
    });

    // b. From Drive exhibitor lists (AI-extracted companies)
    const uniqueDriveCompanies = [...new Set(driveCompanies)].slice(0, 30);

    // c. Build combined target list — Lead Master takes priority (we already have DM details)
    const targets: Array<{
      companyName: string;
      contactName: string;
      contactEmail: string;
      industry: string;
      source: string;
    }> = [];

    const seen = new Set<string>();

    for (const row of showLeads) {
      const email = (row[21] || '').trim(); // dmEmail
      if (!email || seen.has(email.toLowerCase())) continue;
      seen.add(email.toLowerCase());
      targets.push({
        companyName: row[2] || '',
        contactName: row[18] || row[3] || '', // dmName or contactName
        contactEmail: email,
        industry: row[10] || showAnalysis.industries[0] || '',
        source: 'lead_master',
      });
    }

    // For Drive companies not already in targets, we don't have email — skip for now
    // (they would need enrichment first via Agent 02)
    const driveOnlyCompanies = uniqueDriveCompanies.filter(c =>
      !targets.some(t => t.companyName.toLowerCase().includes(c.toLowerCase()))
    );

    await this.respond(
      ctx.chatId,
      `*Show Analysis Complete*\n\n` +
      `${showAnalysis.summary}\n\n` +
      `*Industries:* ${showAnalysis.industries.join(', ')}\n` +
      `*Target Profile:* ${showAnalysis.targetProfile}\n\n` +
      `*Targets found:* ${targets.length} from Lead Master with DM emails\n` +
      `*Companies in Drive files (need enrichment):* ${driveOnlyCompanies.length}\n\n` +
      `Generating personalised emails...`
    );

    if (targets.length === 0) {
      const msg =
        `No leads with DM emails found for *${showName}*.\n\n` +
        (driveOnlyCompanies.length > 0
          ? `Found ${driveOnlyCompanies.length} companies in Drive files that need enrichment first:\n` +
            driveOnlyCompanies.slice(0, 10).map(c => `  • ${c}`).join('\n') +
            `\n\nRun /enrich first to find DM emails, then /newcampaign again.`
          : `Add leads for this show via /newlead, run /enrich, then try again.`);
      await this.respond(ctx.chatId, msg);
      return { success: true, message: 'No enriched targets found', confidence: 'HIGH' };
    }

    // ---- 3. Generate personalised emails ----

    const emailDrafts: Array<{
      target: typeof targets[0];
      subject: string;
      body: string;
    }> = [];

    for (const target of targets.slice(0, 10)) { // cap at 10 per campaign run
      try {
        // Get company-specific context from knowledge base
        const companyKnowledge = await searchKnowledge(target.companyName, 3);
        const companyContext = companyKnowledge.map(k => k.content).join(' ');

        const email = await generateCampaignEmail({
          companyName: target.companyName,
          contactName: target.contactName,
          showName,
          showSummary: showAnalysis.summary,
          standMeAngle: showAnalysis.standMeAngle,
          painPoints: showAnalysis.painPoints,
          companyContext,
          industry: target.industry,
          emailNumber: 1,
        });
        emailDrafts.push({ target, subject: email.subject, body: email.body });
      } catch (err: any) {
        logger.warn(`[CampaignBuilder] Email gen failed for ${target.companyName}: ${err.message}`);
      }
    }

    if (emailDrafts.length === 0) {
      await this.respond(ctx.chatId, 'Failed to generate any emails. Check AI service.');
      return { success: false, message: 'Email generation failed', confidence: 'LOW' };
    }

    // ---- 4. Resolve or create Woodpecker campaign ----

    const campaignId = await this.resolveOrCreateCampaign(ctx, showName);
    if (!campaignId) return { success: false, message: 'No campaign resolved', confidence: 'LOW' };

    // ---- 5. Send batch approval to Mo ----

    const approvalId = `campaign_${showName.replace(/\s+/g, '_').toLowerCase()}_${Date.now()}`;
    const preview = emailDrafts.map((d, i) =>
      `*${i + 1}. ${d.target.companyName}* (${d.target.contactEmail})\n` +
      `Subject: ${d.subject}\n\n${d.body}`
    ).join('\n\n---\n\n');

    const summaryMsg =
      `*Campaign: ${showName}*\n` +
      `Campaign ID: ${campaignId}\n` +
      `${emailDrafts.length} personalised emails ready\n\n` +
      `*Show angle:* ${showAnalysis.standMeAngle}\n\n` +
      `---\n\n${preview.slice(0, 3500)}`;

    registerApproval(approvalId, {
      action: `Launch ${showName} campaign (${emailDrafts.length} emails)`,
      data: { campaignId, showName, emailDrafts },
      timestamp: Date.now(),
      onApprove: async () => {
        let pushed = 0;
        const salesIds: string[] = [];

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
              tags: `standme-campaign,${showName.toLowerCase().replace(/\s+/g, '-')}`,
            };

            const wpId = await addProspectToCampaign(campaignId, prospect);

            // Create CAMPAIGN_SALES record
            const salesId = `CS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            await appendRow(SHEETS.CAMPAIGN_SALES, objectToRow(SHEETS.CAMPAIGN_SALES, {
              id: salesId,
              campaignId: String(campaignId),
              showName,
              companyName: draft.target.companyName,
              contactName: draft.target.contactName,
              contactEmail: draft.target.contactEmail,
              woodpeckerId: String(wpId || ''),
              status: 'SENT',
              classification: '',
              standSize: '',
              budget: '',
              showDates: '',
              phone: '',
              requirements: '',
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

            salesIds.push(salesId);
            pushed++;
          } catch (err: any) {
            logger.warn(`[CampaignBuilder] Push failed for ${draft.target.companyName}: ${err.message}`);
          }
        }

        return `Campaign *${showName}* launched.\n${pushed}/${emailDrafts.length} prospects pushed to Woodpecker campaign ${campaignId}.\n\nReply monitoring active every 2h via /salesreplies.`;
      },
      onReject: async () => {
        return `Campaign *${showName}* cancelled by Mo.`;
      },
    });

    await sendToMo(formatType1(
      `Launch Campaign: ${showName}`,
      `${emailDrafts.length} personalised emails for Woodpecker campaign ${campaignId}`,
      summaryMsg,
      approvalId
    ));

    await this.respond(
      ctx.chatId,
      `${emailDrafts.length} email drafts sent to Mo for approval.\n\n` +
      `Campaign: *${showName}* (Woodpecker ID: ${campaignId})\n\n` +
      `Mo approves with /approve\\_${approvalId} or rejects with /reject\\_${approvalId}`
    );

    return { success: true, message: `${emailDrafts.length} emails drafted for ${showName}`, confidence: 'HIGH' };
  }

  // =====================================================================
  // /salesreplies — Poll Woodpecker + Gmail, run full sales loop
  // =====================================================================

  private async handleSalesReplies(ctx: AgentContext): Promise<AgentResponse> {
    const isScheduled = ctx.command === 'scheduled';
    if (!isScheduled) await this.respond(ctx.chatId, 'Checking for new replies across all campaigns...');

    let newReplies = 0;
    let escalations = 0;

    try {
      // Get all CAMPAIGN_SALES records not yet handled (status SENT or OPENED, no recent action)
      const salesRows = await readSheet(SHEETS.CAMPAIGN_SALES);
      const activeRecords = salesRows.slice(1)
        .map((r, i) => ({ row: r, index: i + 2 })) // 1-indexed, +1 for header
        .filter(({ row }) => {
          const status = (row[7] || '').toUpperCase(); // status col H
          return ['SENT', 'OPENED', 'REPLIED', 'MORE_INFO_NEEDED', 'INTERESTED'].includes(status);
        });

      if (activeRecords.length === 0) {
        if (!isScheduled) await this.respond(ctx.chatId, 'No active campaign records to monitor.');
        return { success: true, message: 'No active records', confidence: 'HIGH' };
      }

      // Group by campaign to batch Woodpecker API calls
      const campaignIds = [...new Set(activeRecords.map(({ row }) => row[1]).filter(Boolean))];

      const prospectStatusMap = new Map<string, string>(); // email → Woodpecker status

      for (const campaignId of campaignIds) {
        try {
          const prospects = await getProspectsByCampaign(Number(campaignId));
          for (const p of prospects) {
            if (p.email && p.status) {
              prospectStatusMap.set(p.email.toLowerCase(), p.status);
            }
          }
        } catch (err: any) {
          logger.warn(`[CampaignBuilder] Could not fetch prospects for campaign ${campaignId}: ${err.message}`);
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

        if (!contactEmail) continue;

        // Check Woodpecker status update
        const wpStatus = prospectStatusMap.get(contactEmail);

        // Update status if Woodpecker shows OPENED or CLICKED
        if (wpStatus === 'OPENED' && currentStatus === 'SENT') {
          await updateCell(SHEETS.CAMPAIGN_SALES, index, 'H', 'OPENED');
          await updateCell(SHEETS.CAMPAIGN_SALES, index, 'Q', new Date().toISOString());
          continue; // no action needed yet for opens
        }

        // Only process if Woodpecker shows REPLIED or we need to check Gmail
        const shouldCheckGmail = wpStatus === 'REPLIED' || currentStatus === 'REPLIED';
        if (!shouldCheckGmail) continue;

        // Search Gmail for actual reply
        const recentDate = lastReplyDate
          ? new Date(lastReplyDate).toISOString().split('T')[0]
          : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        let replyBody = '';
        let replyDate = '';
        try {
          const emails = await searchEmailsByQuery(
            `from:${contactEmail} after:${recentDate.replace(/-/g, '/')}`,
            5
          );
          if (emails.length > 0) {
            const latest = emails[0]; // most recent first
            replyBody = latest.body;
            replyDate = latest.date;
          }
        } catch (err: any) {
          logger.warn(`[CampaignBuilder] Gmail search failed for ${contactEmail}: ${err.message}`);
        }

        if (!replyBody) {
          // Woodpecker says REPLIED but we can't find the email yet — update status and move on
          if (wpStatus === 'REPLIED' && currentStatus !== 'REPLIED') {
            await updateCell(SHEETS.CAMPAIGN_SALES, index, 'H', 'REPLIED');
            await updateCell(SHEETS.CAMPAIGN_SALES, index, 'P', new Date().toISOString());
            await updateCell(SHEETS.CAMPAIGN_SALES, index, 'Q', new Date().toISOString());
          }
          continue;
        }

        // Parse existing conversation log and collected info
        let conversationHistory: Array<{ role: string; message: string; date: string }> = [];
        try { conversationHistory = JSON.parse(row[14] || '[]'); } catch { /* empty */ }

        const collectedInfo: Record<string, string> = {
          standSize: row[9] || '',
          budget: row[10] || '',
          showDates: row[11] || '',
          phone: row[12] || '',
          requirements: row[13] || '',
        };

        const missingInfo = SALES_INFO_FIELDS.filter(f => !collectedInfo[f]);

        const historyText = conversationHistory
          .map(m => `${m.role === 'agent' ? 'StandMe' : contactName}: ${m.message}`)
          .join('\n\n');

        // Generate AI sales reply
        let salesResult: { reply: string; classification: string; extractedInfo: Record<string, string> };
        try {
          salesResult = await generateSalesReply({
            companyName,
            contactName,
            showName,
            prospectMessage: replyBody,
            conversationHistory: historyText,
            collectedInfo,
            missingInfo,
          });
        } catch (err: any) {
          logger.warn(`[CampaignBuilder] Sales reply gen failed for ${companyName}: ${err.message}`);
          continue;
        }

        const { reply, classification, extractedInfo } = salesResult;

        // Update collected info with newly extracted data
        const updatedInfo = { ...collectedInfo, ...extractedInfo };

        // Mark NOT_INTERESTED — no reply needed
        if (classification === 'NOT_INTERESTED') {
          await updateCell(SHEETS.CAMPAIGN_SALES, index, 'H', 'NOT_INTERESTED');
          await updateCell(SHEETS.CAMPAIGN_SALES, index, 'I', classification);
          await updateCell(SHEETS.CAMPAIGN_SALES, index, 'Q', new Date().toISOString());

          // Notify Mo quietly
          await sendToMo(formatType2(
            `Not Interested: ${companyName}`,
            `Company: ${companyName} (${showName})\nThey replied not interested.\n\nTheir message:\n${replyBody.slice(0, 300)}`
          ));
          continue;
        }

        newReplies++;

        // If READY_TO_CLOSE — escalate to Mo with all collected info
        if (classification === 'READY_TO_CLOSE') {
          const infoSummary = Object.entries(updatedInfo)
            .filter(([, v]) => v)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n');

          await sendToMo(formatType2(
            `READY TO CLOSE: ${companyName}`,
            `*Show:* ${showName}\n*Contact:* ${contactName} (${contactEmail})\n\n*Deal Info:*\n${infoSummary || 'Minimal info — check conversation'}\n\n*Their last message:*\n${replyBody.slice(0, 300)}`
          ));
          escalations++;
          await updateCell(SHEETS.CAMPAIGN_SALES, index, 'H', 'INTERESTED');
          await updateCell(SHEETS.CAMPAIGN_SALES, index, 'I', classification);
          continue;
        }

        // Register approval for sending the sales reply
        const approvalId = `salesreply_${salesId}`;

        registerApproval(approvalId, {
          action: `Send sales reply to ${companyName} (${contactEmail})`,
          data: { salesId, contactEmail, reply, updatedInfo, companyName, showName, classification },
          timestamp: Date.now(),
          onApprove: async () => {
            try {
              const { sendEmail } = await import('../services/google/gmail');
              const subject = `Re: Your stand at ${showName}`;
              await sendEmail(contactEmail, subject, reply);

              // Update CAMPAIGN_SALES record
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

              return `Reply sent to *${companyName}* (${contactEmail}).\nClassification: ${classification}`;
            } catch (err: any) {
              return `Failed to send reply to ${companyName}: ${err.message}`;
            }
          },
          onReject: async () => {
            return `Sales reply to *${companyName}* rejected. No email sent.`;
          },
        });

        const theirMessage = replyBody.slice(0, 400);
        const approvalDetail =
          `*Company:* ${companyName} (${showName})\n` +
          `*Contact:* ${contactName} (${contactEmail})\n` +
          `*Classification:* ${classification}\n\n` +
          `*Their message:*\n${theirMessage}\n\n` +
          `*Proposed reply:*\n${reply}`;

        await sendToMo(formatType1(
          `Sales Reply: ${companyName}`,
          `${classification} — ${showName}`,
          approvalDetail,
          approvalId
        ));
      }

      const summary =
        newReplies > 0
          ? `${newReplies} new repl${newReplies === 1 ? 'y' : 'ies'} processed. ${escalations > 0 ? `${escalations} escalated to you directly.` : ''}`
          : 'No new replies requiring action.';

      if (!isScheduled) await this.respond(ctx.chatId, summary);

      return { success: true, message: summary, confidence: 'HIGH' };

    } catch (err: any) {
      if (!isScheduled) await this.respond(ctx.chatId, `Error checking replies: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }
  }

  // =====================================================================
  // /campaignstatus [show name] — Full status view
  // =====================================================================

  private async showCampaignStatus(ctx: AgentContext): Promise<AgentResponse> {
    const showFilter = ctx.args.trim().toLowerCase();
    await this.respond(ctx.chatId, 'Fetching campaign status...');

    const salesRows = await readSheet(SHEETS.CAMPAIGN_SALES);
    const records = salesRows.slice(1).filter(r =>
      !showFilter || (r[2] || '').toLowerCase().includes(showFilter)
    );

    if (records.length === 0) {
      await this.respond(ctx.chatId,
        showFilter
          ? `No campaign records found for "${ctx.args.trim()}". Run /newcampaign ${ctx.args.trim()} to start one.`
          : 'No campaign records found. Run /newcampaign [show name] to start a campaign.'
      );
      return { success: true, message: 'No records', confidence: 'HIGH' };
    }

    // Group by show
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

      const interested = rows.filter(r => ['INTERESTED', 'READY_TO_CLOSE'].includes((r[7] || '').toUpperCase()));
      const interestedList = interested.length > 0
        ? '\n' + interested.map(r =>
            `  • ${r[3]} — Size: ${r[9] || '?'} | Budget: ${r[10] || '?'} | Phone: ${r[12] || '?'}`
          ).join('\n')
        : '';

      const statsLine = Object.entries(counts)
        .map(([s, n]) => `${s}: ${n}`)
        .join(' | ');

      sections.push({
        label: show,
        content: `${rows.length} prospects — ${statsLine}${interestedList}`,
      });
    }

    // Also pull Woodpecker live stats for each distinct campaign ID
    const campaignIds = [...new Set(records.map(r => r[1]).filter(Boolean))];
    const wpSections: { label: string; content: string }[] = [];
    for (const cid of campaignIds.slice(0, 3)) {
      try {
        const { getCampaignStats } = await import('../services/woodpecker/client');
        const stats = await getCampaignStats(Number(cid));
        const openRate = stats.sent > 0 ? Math.round((stats.opened / stats.sent) * 100) : 0;
        const replyRate = stats.sent > 0 ? Math.round((stats.replied / stats.sent) * 100) : 0;
        wpSections.push({
          label: `Woodpecker #${cid}`,
          content: `Sent: ${stats.sent} | Opens: ${stats.opened} (${openRate}%) | Replies: ${stats.replied} (${replyRate}%) | Interested: ${stats.interested}`,
        });
      } catch { /* skip */ }
    }

    const allSections = [...sections, ...wpSections];
    await this.respond(ctx.chatId, formatType3(
      showFilter ? `Campaign Status: ${ctx.args.trim()}` : 'All Campaign Status',
      allSections
    ));

    return { success: true, message: `Status shown for ${byShow.size} show(s)`, confidence: 'HIGH' };
  }

  // =====================================================================
  // Helpers
  // =====================================================================

  private async resolveOrCreateCampaign(ctx: AgentContext, showName: string): Promise<number | null> {
    // 1. Check env override
    const fromEnv = parseInt(process.env.WOODPECKER_CAMPAIGN_ID || '');
    if (fromEnv > 0) return fromEnv;

    // 2. Look for existing campaign matching the show name
    let campaigns: { id: number; name: string; status: string }[] = [];
    try {
      campaigns = await listCampaigns();
    } catch (err: any) {
      await this.respond(ctx.chatId, `Could not fetch Woodpecker campaigns: ${err.message}`);
      return null;
    }

    const existing = campaigns.find(c =>
      c.name.toLowerCase().includes(showName.toLowerCase()) ||
      showName.toLowerCase().includes(c.name.toLowerCase())
    );

    if (existing) {
      await this.respond(ctx.chatId, `Using existing campaign: *${existing.name}* (ID: ${existing.id})`);
      return existing.id;
    }

    // 3. Create a new campaign for this show
    try {
      const fromName = process.env.WOODPECKER_FROM_NAME || 'Mo';
      const fromEmail = process.env.SEND_FROM_EMAIL || process.env.WOODPECKER_FROM_EMAIL || 'info@standme.de';
      const campaignId = await createCampaign(`${showName} — StandMe Outreach`, fromName, fromEmail);
      await this.respond(ctx.chatId, `Created new Woodpecker campaign for *${showName}* (ID: ${campaignId})`);
      return campaignId;
    } catch (err: any) {
      // createCampaign may fail if Woodpecker plan doesn't allow it via API — fall back to asking Mo
      await sendToMo(formatType2(
        `Campaign creation needed: ${showName}`,
        `Could not auto-create a Woodpecker campaign for *${showName}* via API (${err.message}).\n\nPlease create it manually in Woodpecker, then re-run: /newcampaign ${showName}`
      ));
      await this.respond(ctx.chatId,
        `Could not auto-create the Woodpecker campaign (API limitation).\n\nMo has been notified. Please create a campaign for *${showName}* in Woodpecker and run /newcampaign again.`
      );
      return null;
    }
  }
}
