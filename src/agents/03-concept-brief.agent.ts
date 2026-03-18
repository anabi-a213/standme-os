import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { readSheet, findRowByValue, appendRow, objectToRow } from '../services/google/sheets';
import { addComment } from '../services/trello/client';
import { createGoogleDoc } from '../services/google/drive';
import { getFolderIdForCategory } from '../config/drive-folders';
import { generateBrief, generateText } from '../services/ai/client';
import { saveKnowledge, buildKnowledgeContext } from '../services/knowledge';
import { sendToMo, formatType1, formatType2 } from '../services/telegram/bot';
import { sendToTeam } from '../services/telegram/bot';

export class ConceptBriefAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'AI Concept Brief Generator',
    id: 'agent-03',
    description: 'Generate research-backed design briefs',
    commands: ['/brief'],
    requiredRole: UserRole.OPS_LEAD,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    const clientName = ctx.args.trim();
    if (!clientName) {
      await this.respond(ctx.chatId, 'Usage: /brief [client name or lead ID]');
      return { success: false, message: 'No client specified', confidence: 'LOW' };
    }

    // Find lead in master sheet
    let leadRow = await findRowByValue(SHEETS.LEAD_MASTER, 'C', clientName);
    if (!leadRow) {
      leadRow = await findRowByValue(SHEETS.LEAD_MASTER, 'A', clientName);
    }

    if (!leadRow) {
      await this.respond(ctx.chatId, `Lead "${clientName}" not found in the system.`);
      return { success: false, message: 'Lead not found', confidence: 'HIGH' };
    }

    const companyName = leadRow.data[2];
    const showName = leadRow.data[6];
    const showCity = leadRow.data[7];
    const standSize = leadRow.data[8];
    const budget = leadRow.data[9];
    const industry = leadRow.data[10];
    const trelloCardId = leadRow.data[16];

    // Check if we have all 4 required fields
    const missing: string[] = [];
    if (!showName) missing.push('show name');
    if (!standSize) missing.push('stand size (sqm)');
    if (!budget) missing.push('budget range');
    // brand guidelines optional

    if (missing.length > 0) {
      const contactEmail = leadRow.data[4];
      if (contactEmail) {
        // Draft info request email
        const emailDraft = await generateText(
          `Draft a short email to ${leadRow.data[3] || 'the client'} at ${companyName} ` +
          `asking for: ${missing.join(', ')}. Show: ${showName || 'unknown'}. ` +
          `Rules: NO "I hope this email finds you well", NO dashes, max 6 lines, ` +
          `direct hook, one CTA. Subject: short + specific.`,
          'You write concise business emails. No fluff.',
          400
        );

        await sendToMo(formatType1(
          `Info Request for ${companyName}`,
          `Missing: ${missing.join(', ')}`,
          `Draft email to ${contactEmail}:\n\n${emailDraft}`,
          `brief_email_${leadRow.data[0]}`
        ));

        if (trelloCardId) {
          await addComment(trelloCardId, `INFO REQUESTED — ${new Date().toISOString().split('T')[0]}. Waiting for: ${missing.join(', ')}`);
        }

        return {
          success: true,
          message: `Info request drafted for ${companyName}. Awaiting Mo approval.`,
          confidence: 'MEDIUM',
        };
      } else {
        await this.respond(ctx.chatId, `Missing data for brief: ${missing.join(', ')}. No contact email to request info.`);
        return { success: false, message: 'Missing data, no email', confidence: 'LOW' };
      }
    }

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

    // Enrich with Knowledge Base — show context, company history, past briefs
    const kbContext = await buildKnowledgeContext(`${showName} ${companyName} ${industry} brief design stand`);
    if (kbContext) {
      lessonsContext = `${lessonsContext}\n\nKNOWLEDGE BASE CONTEXT:\n${kbContext}`.trim();
    }

    // Generate brief
    await this.respond(ctx.chatId, `Generating concept brief for ${companyName}...`);

    const briefContent = await generateBrief({
      clientName: companyName,
      showName,
      showCity,
      standSize,
      budget,
      industry,
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
    appendRow(SHEETS.DRIVE_INDEX, objectToRow(SHEETS.DRIVE_INDEX, {
      fileName: `Concept Brief — ${companyName} — ${showName}`,
      fileId: doc.id,
      fileUrl: doc.url,
      folderPath: `/${briefFolder.name}`,
      parentFolder: briefFolder.id,
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

    await this.respond(ctx.chatId, `✅ Brief generated for ${companyName}.\nDoc: ${doc.url}`);

    return {
      success: true,
      message: `Brief created for ${companyName}`,
      confidence: 'HIGH',
      data: { docUrl: doc.url },
    };
  }
}
