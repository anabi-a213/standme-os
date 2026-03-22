import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { validateShow } from '../config/shows';
import { SHEETS } from '../config/sheets';
import { appendRow, readSheet, objectToRow } from '../services/google/sheets';
import { createCard, findListByName } from '../services/trello/client';
import { searchEmailsByQuery, sendEmail } from '../services/google/gmail';
import { generateText, detectLanguage } from '../services/ai/client';
import {
  saveKnowledge,
  buildKnowledgeContext,
  getKnowledgeBySource,
  sourceExistsInKnowledge,
} from '../services/knowledge';
import { sendToMo, formatType1, formatType2, formatType3 } from '../services/telegram/bot';
import { registerApproval } from '../services/approvals';

// ─── Types ─────────────────────────────────────────────────────────────────

interface ExtractedLead {
  companyName: string;
  contactName: string;
  contactEmail: string;
  showName: string;
  standSize: string;
  budget: string;
  industry: string;
  website: string;
  notes: string;
  isStandRequest: boolean;
  missingFields: string[];
}

interface PendingEmailLead {
  emailId: string;
  extractedData: ExtractedLead;
  originalSubject: string;
  originalMessageId: string;
}

// ─── Agent ─────────────────────────────────────────────────────────────────

export class GmailLeadMonitorAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Gmail Lead Monitor',
    id: 'agent-18',
    description: 'Monitor info@standme.de for stand request emails and auto-create leads',
    commands: ['/checkemails', '/emailstatus'],
    schedule: '*/30 * * * *',   // every 30 minutes
    requiredRole: UserRole.ADMIN,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    const cmd = ctx.command.toLowerCase();

    if (cmd === '/emailstatus') return this.handleEmailStatus(ctx);

    // Default: /checkemails or scheduled run
    return this.runEmailScan(ctx);
  }

  // ─── Main Scan ─────────────────────────────────────────────────────────

  private async runEmailScan(ctx: AgentContext): Promise<AgentResponse> {
    const isManual = ctx.userId !== 'SYSTEM';
    if (isManual) await this.respond(ctx.chatId, '📧 Scanning inbox for new stand request emails...');

    // Search last 3 days of emails to info@standme.de
    const emails = await searchEmailsByQuery(
      'to:info@standme.de newer_than:3d',
      50
    ).catch(() => []);

    if (!emails.length) {
      if (isManual) await this.respond(ctx.chatId, 'No emails found in the last 3 days.');
      return { success: true, message: 'No emails to process', confidence: 'HIGH' };
    }

    const newLeads: PendingEmailLead[] = [];
    const completedReplies: string[] = [];
    const irrelevant: number[] = [];
    let processed = 0;

    for (const email of emails) {
      // Skip already-processed emails
      const processedKey = `gmail-email-${email.id}`;
      const alreadyDone = await sourceExistsInKnowledge(processedKey);
      if (alreadyDone) continue;

      processed++;

      // Check if this is a reply to one of our info-request emails
      const subjectLower = (email.subject || '').toLowerCase();
      const isReply = subjectLower.startsWith('re:');

      if (isReply) {
        const handled = await this.handleInfoReply(email);
        if (handled) {
          completedReplies.push(email.from);
          await this.markProcessed(email.id, `info-reply from ${email.from}`);
          continue;
        }
      }

      // Extract lead data with Claude
      const extracted = await this.extractLeadData(email.body, email.from, email.subject);

      if (!extracted.isStandRequest) {
        irrelevant.push(1);
        await this.markProcessed(email.id, `not-a-stand-request`);
        continue;
      }

      newLeads.push({
        emailId: email.id,
        extractedData: extracted,
        originalSubject: email.subject,
        originalMessageId: email.messageId || email.id,
      });
    }

    if (!processed && isManual) {
      await this.respond(ctx.chatId, 'All recent emails already processed. Nothing new.');
      return { success: true, message: 'All emails already processed', confidence: 'HIGH' };
    }

    // Process each new stand request
    let leadsCreated = 0;
    let awaitingInfo = 0;

    for (const pending of newLeads) {
      const { extractedData } = pending;
      const hasCriticalFields = !!extractedData.companyName && !!(extractedData.showName || extractedData.notes);
      const requiredMissing = extractedData.missingFields.filter(f =>
        ['company name', 'show / exhibition name'].includes(f)
      );

      if (requiredMissing.length > 0) {
        // Missing critical info — email sender to ask
        await this.requestMissingInfo(pending, requiredMissing);
        awaitingInfo++;
      } else {
        // We have enough to create a lead — ask Mo to approve
        await this.requestLeadApproval(pending, ctx.chatId);
        leadsCreated++;
      }

      // Mark as processed regardless
      await this.markProcessed(pending.emailId, `stand-request-from-${extractedData.contactEmail || 'unknown'}`);
    }

    // Summary to Mo
    if (processed > 0) {
      const moId = parseInt(process.env.MO_TELEGRAM_ID || '0');
      await sendToMo(formatType3('📧 Gmail Scan Complete', [
        { label: 'Emails Scanned', content: `${processed} new email(s)` },
        { label: 'Stand Requests Found', content: `${newLeads.length}` },
        { label: 'Pending Your Approval', content: `${leadsCreated} lead(s) ready to create` },
        { label: 'Awaiting Client Info', content: `${awaitingInfo} email(s) sent asking for missing details` },
        { label: 'Info Replies Completed', content: `${completedReplies.length}` },
        { label: 'Irrelevant / Other', content: `${irrelevant.length}` },
      ]));
    }

    const summary = `Scanned ${processed} emails: ${newLeads.length} stand requests, ${leadsCreated} pending approval, ${awaitingInfo} awaiting client info.`;
    if (isManual) await this.respond(ctx.chatId, `✅ ${summary}`);

    return { success: true, message: summary, confidence: 'HIGH' };
  }

  // ─── Extract Lead Data from Email with Claude ───────────────────────────

  private async extractLeadData(
    body: string,
    from: string,
    subject: string
  ): Promise<ExtractedLead> {
    const kbContext = await buildKnowledgeContext('stand request exhibition').catch(() => '');

    const senderEmail = this.extractEmailFromHeader(from);
    const senderName = this.extractNameFromHeader(from);

    const prompt = `You are an expert at reading exhibition stand enquiry emails for StandMe, a stand design & build company.

Analyse this email and extract the structured information below.

---EMAIL---
From: ${from}
Subject: ${subject}
Body:
${body.substring(0, 3000)}
---END---

${kbContext ? `COMPANY KNOWLEDGE:\n${kbContext}\n\n` : ''}

Extract the following fields. Use EXACTLY this JSON format:
{
  "isStandRequest": true/false,
  "companyName": "",
  "contactName": "",
  "contactEmail": "",
  "showName": "",
  "standSize": "",
  "budget": "",
  "industry": "",
  "website": "",
  "notes": "",
  "missingFields": []
}

Rules:
- isStandRequest: true only if the email is about requesting a stand design/build/quote for an exhibition. False for newsletters, spam, supplier offers, etc.
- contactEmail: use sender email (${senderEmail}) unless a different one is explicitly stated
- contactName: use sender name (${senderName}) if not found in body
- showName: the name of the exhibition or trade show they want a stand for
- standSize: stand size in sqm if mentioned (just the number or range, e.g. "36" or "30-40")
- budget: budget if mentioned (keep original format, e.g. "€15,000" or "15k")
- industry: their business sector (medical, food, technology, industrial, solar, etc.)
- website: company website if mentioned
- notes: any other relevant details (special requirements, timeline, design wishes)
- missingFields: list the field names that are empty AND critical to creating a proper lead. Include from: ["company name", "show / exhibition name", "stand size", "budget", "industry"]

Return ONLY the JSON object. No explanation.`;

    try {
      const response = await generateText(prompt, undefined, 600);
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        isStandRequest: parsed.isStandRequest === true,
        companyName: parsed.companyName || '',
        contactName: parsed.contactName || senderName,
        contactEmail: parsed.contactEmail || senderEmail,
        showName: parsed.showName || '',
        standSize: parsed.standSize || '',
        budget: parsed.budget || '',
        industry: parsed.industry || '',
        website: parsed.website || '',
        notes: parsed.notes || '',
        missingFields: Array.isArray(parsed.missingFields) ? parsed.missingFields : [],
      };
    } catch {
      // Fallback: mark as a possible stand request with all data missing
      return {
        isStandRequest: subject.toLowerCase().includes('stand') || body.toLowerCase().includes('exhibition'),
        companyName: '',
        contactName: senderName,
        contactEmail: senderEmail,
        showName: '',
        standSize: '',
        budget: '',
        industry: '',
        website: '',
        notes: `Raw email — extraction failed. Subject: ${subject}`,
        missingFields: ['company name', 'show / exhibition name', 'stand size', 'budget', 'industry'],
      };
    }
  }

  // ─── Request Lead Approval from Mo ─────────────────────────────────────

  private async requestLeadApproval(pending: PendingEmailLead, chatId: number): Promise<void> {
    const { extractedData: d } = pending;
    const approvalId = `gmail-lead-${pending.emailId}`;

    // Validate show against known database
    const showValidation = d.showName ? validateShow(d.showName) : { valid: false, match: null, confidence: 'LOW' as const };

    const detail =
      `*Company:* ${d.companyName}\n` +
      `*Contact:* ${d.contactName} — ${d.contactEmail}\n` +
      `*Show:* ${d.showName || 'N/A'} ${showValidation.valid ? '✅' : '⚠️'}\n` +
      `*Stand Size:* ${d.standSize || 'N/A'} sqm\n` +
      `*Budget:* ${d.budget || 'N/A'}\n` +
      `*Industry:* ${d.industry || 'N/A'}\n` +
      `*Website:* ${d.website || 'N/A'}\n` +
      (d.notes ? `*Notes:* ${d.notes.substring(0, 200)}\n` : '') +
      `\n_Source: Email — ${pending.originalSubject}_`;

    // Save to KB so we can reconstruct on Railway redeploy
    await saveKnowledge({
      source: `gmail-approval-${approvalId}`,
      sourceType: 'manual',
      topic: d.companyName || 'Unknown',
      tags: `gmail,lead,pending-approval,${(d.industry || '').toLowerCase()}`,
      content: JSON.stringify({
        approvalId,
        extractedData: d,
        showValidation: { valid: showValidation.valid, confidence: showValidation.confidence },
        originalSubject: pending.originalSubject,
        emailId: pending.emailId,
      }),
    });

    registerApproval(approvalId, {
      onApprove: async () => {
        const result = await this.createLeadFromEmail(d, showValidation);
        return result;
      },
      onReject: async () => {
        await saveKnowledge({
          source: `gmail-email-${pending.emailId}-rejected`,
          sourceType: 'manual',
          topic: d.companyName || 'Unknown',
          tags: 'gmail,lead,rejected',
          content: `Lead from ${d.contactEmail} rejected by Mo. Company: ${d.companyName}, Show: ${d.showName}.`,
        });
        return `❌ Lead from ${d.companyName} rejected and archived.`;
      },
    });

    await sendToMo(formatType1(
      `New Lead from Gmail`,
      `Email from ${d.contactEmail}`,
      detail,
      approvalId
    ));
  }

  // ─── Create the Lead (called after Mo approves) ─────────────────────────

  private async createLeadFromEmail(
    d: ExtractedLead,
    showValidation: { valid: boolean; match: any; confidence: string }
  ): Promise<string> {
    const leadId = `SM-${Date.now()}`;
    const score = this.scoreLead(d, showValidation.valid);
    const language = d.contactEmail.includes('.de') ? 'de' :
                     d.contactEmail.includes('.fr') ? 'fr' : 'en';

    const leadData: Record<string, string> = {
      id: leadId,
      timestamp: new Date().toISOString(),
      companyName: d.companyName,
      contactName: d.contactName,
      contactEmail: d.contactEmail,
      contactTitle: '',
      showName: d.showName,
      showCity: showValidation.match?.city || '',
      standSize: d.standSize,
      budget: d.budget,
      industry: d.industry,
      leadSource: 'email',
      score: score.total.toString(),
      scoreBreakdown: JSON.stringify(score.breakdown),
      confidence: showValidation.confidence,
      status: score.status,
      trelloCardId: '',
      enrichmentStatus: 'PENDING',
      dmName: '',
      dmTitle: '',
      dmLinkedIn: '',
      dmEmail: d.contactEmail,
      outreachReadiness: '',
      language,
      notes: `Source: Gmail. Website: ${d.website || 'N/A'}. ${d.notes || ''}`.trim(),
    };

    await appendRow(SHEETS.LEAD_MASTER, objectToRow(SHEETS.LEAD_MASTER, leadData));

    await saveKnowledge({
      source: `lead-${leadId}`,
      sourceType: 'sheet',
      topic: d.companyName,
      tags: `lead,company,email-source,${(d.industry || '').toLowerCase()},${(d.showName || '').toLowerCase().replace(/\s+/g, '-')},${score.status.toLowerCase()}`,
      content: `${d.companyName} (${d.industry || 'unknown industry'}) attending ${d.showName || 'unknown show'}. Lead score: ${score.total}/10 (${score.status}). Contact: ${d.contactName || 'unknown'} <${d.contactEmail}>. Budget: ${d.budget || 'unknown'}. Stand: ${d.standSize || 'unknown'} sqm. Website: ${d.website || 'N/A'}. Source: email.`,
    });

    // Create Trello card for HOT/WARM
    let trelloCardId = '';
    if (score.status === 'HOT' || score.status === 'WARM') {
      const boardId = process.env.TRELLO_BOARD_SALES_PIPELINE || '';
      const list = await findListByName(boardId, '01 — New Inquiry').catch(() => null);
      if (list) {
        const card = await createCard(
          list.id,
          `${d.companyName} — ${d.showName || 'Unknown Show'}`,
          `Lead ID: ${leadId}\nScore: ${score.total}/10 (${score.status})\nSource: Gmail\n` +
          `Company: ${d.companyName}\nContact: ${d.contactName} <${d.contactEmail}>\n` +
          `Show: ${d.showName || 'N/A'}\nSize: ${d.standSize || 'N/A'} sqm\n` +
          `Budget: ${d.budget || 'N/A'}\nIndustry: ${d.industry || 'N/A'}\n` +
          `Website: ${d.website || 'N/A'}\n` +
          (d.notes ? `\nNotes: ${d.notes}` : '')
        ).catch(() => null);
        if (card) trelloCardId = card.id;
      }
    }

    const emoji = score.status === 'HOT' ? '🔥' : score.status === 'WARM' ? '🟡' : '❄️';
    return (
      `${emoji} *Lead Created: ${d.companyName}*\n` +
      `Score: ${score.total}/10 (${score.status})\n` +
      `Show: ${d.showName || 'N/A'} ${showValidation.valid ? '✅' : '⚠️'}\n` +
      `Contact: ${d.contactName} — ${d.contactEmail}\n` +
      `Lead ID: ${leadId}\n` +
      (trelloCardId ? `Trello card created ✅\n` : '') +
      `\nUse /enrich ${d.companyName} to enrich, or /brief ${d.companyName} for a concept brief.`
    );
  }

  // ─── Request Missing Info from Sender ──────────────────────────────────

  private async requestMissingInfo(
    pending: PendingEmailLead,
    missingFields: string[]
  ): Promise<void> {
    const { extractedData: d } = pending;

    const emailBody = await generateText(
      `Write a short, professional reply email from StandMe (info@standme.de) to ${d.contactName || 'the client'} at ${d.contactEmail}.

They sent an enquiry about exhibition stand design/build with subject: "${pending.originalSubject}"

We need the following information to prepare their quote:
${missingFields.map(f => `- ${f}`).join('\n')}

Write a friendly, helpful email (max 150 words). Do not use placeholders. Do not include a subject line — just the email body. Sign off as "The StandMe Team".`,
      undefined,
      300
    );

    await sendEmail(
      d.contactEmail,
      `Re: ${pending.originalSubject}`,
      emailBody,
      pending.originalMessageId
    ).catch(() => null);

    // Save pending state to KB so we can match the reply later
    await saveKnowledge({
      source: `gmail-pending-${pending.emailId}`,
      sourceType: 'manual',
      topic: d.companyName || d.contactEmail,
      tags: `gmail,pending,awaiting-info,${d.contactEmail}`,
      content: JSON.stringify({
        emailId: pending.emailId,
        contactEmail: d.contactEmail,
        contactName: d.contactName,
        companyName: d.companyName,
        partialData: d,
        missingFields,
        infoRequestedAt: new Date().toISOString(),
        originalSubject: pending.originalSubject,
        originalMessageId: pending.originalMessageId,
      }),
    });

    await sendToMo(formatType2(
      `Info Requested: ${d.companyName || d.contactEmail}`,
      `Email from *${d.contactEmail}* is missing: ${missingFields.join(', ')}.\nInfo-request reply sent automatically. Will create lead when they respond.`
    ));
  }

  // ─── Handle Reply to Our Info-Request ──────────────────────────────────

  private async handleInfoReply(email: { id: string; from: string; subject: string; body: string; messageId?: string }): Promise<boolean> {
    const senderEmail = this.extractEmailFromHeader(email.from);

    // Find matching pending entry by sender email in KB
    const rows = await readSheet(SHEETS.KNOWLEDGE_BASE).catch(() => [] as string[][]);
    let pendingEntry: any = null;
    let pendingSource = '';

    for (const row of rows) {
      const source = row[1] || '';
      const tags = row[4] || '';
      const content = row[5] || '';

      if (source.startsWith('gmail-pending-') && tags.includes(senderEmail)) {
        try {
          pendingEntry = JSON.parse(content);
          pendingSource = source;
          break;
        } catch { continue; }
      }
    }

    if (!pendingEntry) return false; // Not a reply to our info-request

    // Re-extract with new info + original partial data merged
    const mergedBody = `${email.body}\n\n---Previously known---\nCompany: ${pendingEntry.companyName || ''}\nContact: ${pendingEntry.contactName || ''}\nShow: ${pendingEntry.partialData?.showName || ''}\nSize: ${pendingEntry.partialData?.standSize || ''}\nBudget: ${pendingEntry.partialData?.budget || ''}`;

    const updated = await this.extractLeadData(mergedBody, email.from, email.subject);

    // Merge with original partial data (don't overwrite fields we already had)
    const merged: ExtractedLead = {
      isStandRequest: true,
      companyName: updated.companyName || pendingEntry.companyName || '',
      contactName: updated.contactName || pendingEntry.contactName || '',
      contactEmail: senderEmail,
      showName: updated.showName || pendingEntry.partialData?.showName || '',
      standSize: updated.standSize || pendingEntry.partialData?.standSize || '',
      budget: updated.budget || pendingEntry.partialData?.budget || '',
      industry: updated.industry || pendingEntry.partialData?.industry || '',
      website: updated.website || pendingEntry.partialData?.website || '',
      notes: [pendingEntry.partialData?.notes, updated.notes].filter(Boolean).join(' | '),
      missingFields: [],
    };

    const showValidation = merged.showName ? validateShow(merged.showName) : { valid: false, match: null, confidence: 'LOW' as const };
    const score = this.scoreLead(merged, showValidation.valid);

    // Create the lead now (Mo already implicitly approved by waiting for info)
    const result = await this.createLeadFromEmail(merged, showValidation);

    await sendToMo(formatType2(
      `Lead Completed from Reply: ${merged.companyName}`,
      `${merged.contactEmail} replied with the missing information.\n\n${result}`
    ));

    return true;
  }

  // ─── /emailstatus ───────────────────────────────────────────────────────

  private async handleEmailStatus(ctx: AgentContext): Promise<AgentResponse> {
    const rows = await readSheet(SHEETS.KNOWLEDGE_BASE).catch(() => [] as string[][]);

    const pendingCount = rows.filter(r => (r[1] || '').startsWith('gmail-pending-')).length;
    const processedToday = rows.filter(r => {
      if (!(r[1] || '').startsWith('gmail-email-')) return false;
      const updated = r[6] || '';
      return updated.startsWith(new Date().toISOString().substring(0, 10));
    }).length;
    const approvalsPending = rows.filter(r => (r[1] || '').startsWith('gmail-approval-')).length;

    await this.sendSummary(ctx.chatId, '📧 Gmail Lead Monitor Status', [
      { label: 'Schedule', content: 'Every 30 minutes' },
      { label: 'Emails Processed Today', content: `${processedToday}` },
      { label: 'Awaiting Client Reply', content: `${pendingCount} (sent info-request emails)` },
      { label: 'Awaiting Mo Approval', content: `${approvalsPending} lead(s) pending` },
      { label: 'Trigger Manual Scan', content: 'Use /checkemails to run immediately' },
    ]);

    return { success: true, message: 'Email status shown', confidence: 'HIGH' };
  }

  // ─── Mark Email as Processed ────────────────────────────────────────────

  private async markProcessed(emailId: string, reason: string): Promise<void> {
    await saveKnowledge({
      source: `gmail-email-${emailId}`,
      sourceType: 'manual',
      topic: 'processed-email',
      tags: 'gmail,processed',
      content: `Email ${emailId} processed. Reason: ${reason}. At: ${new Date().toISOString()}`,
    }).catch(() => null);
  }

  // ─── Lead Scorer (mirrors Agent-01 logic) ───────────────────────────────

  private scoreLead(
    d: ExtractedLead,
    showValid: boolean
  ): { total: number; breakdown: Record<string, number>; status: 'HOT' | 'WARM' | 'COLD' | 'DISQUALIFIED' } {
    const breakdown = { showFit: 0, sizeSignal: 0, industryFit: 0, dmSignal: 0, timeline: 0 };

    if (showValid) breakdown.showFit = 2;
    else if (d.showName) breakdown.showFit = 1;

    if (d.standSize && parseFloat(d.standSize) > 0) breakdown.sizeSignal = 2;
    else if (d.budget) breakdown.sizeSignal = 1;

    const coreIndustries = ['solar', 'energy', 'medical', 'healthcare', 'food', 'packaging', 'technology', 'industrial'];
    const adjIndustries = ['automotive', 'construction', 'pharma', 'agriculture', 'retail'];
    const lowerInd = (d.industry || '').toLowerCase();
    if (coreIndustries.some(i => lowerInd.includes(i))) breakdown.industryFit = 2;
    else if (adjIndustries.some(i => lowerInd.includes(i))) breakdown.industryFit = 1;

    if (d.contactName) breakdown.dmSignal = 1;
    if (d.showName) breakdown.timeline = 1;

    const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
    const status: 'HOT' | 'WARM' | 'COLD' | 'DISQUALIFIED' =
      total >= 8 ? 'HOT' : total >= 5 ? 'WARM' : total >= 3 ? 'COLD' : 'DISQUALIFIED';

    return { total, breakdown, status };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private extractEmailFromHeader(from: string): string {
    const match = from.match(/<([^>]+)>/) || from.match(/([^\s]+@[^\s]+)/);
    return match ? match[1].toLowerCase().trim() : from.toLowerCase().trim();
  }

  private extractNameFromHeader(from: string): string {
    const match = from.match(/^([^<]+)</);
    return match ? match[1].trim().replace(/^"|"$/g, '') : '';
  }
}
