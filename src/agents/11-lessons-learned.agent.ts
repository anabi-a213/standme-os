import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { appendRow, objectToRow, sheetUrl } from '../services/google/sheets';
import { getCard } from '../services/trello/client';
import { createGoogleDoc } from '../services/google/drive';
import { getFolderIdForCategory } from '../config/drive-folders';
import { generateText } from '../services/ai/client';
import { sendToMo, formatType1 } from '../services/telegram/bot';
import { saveKnowledge, buildKnowledgeContext } from '../services/knowledge';

export class LessonsLearnedAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Lessons Learned Recorder',
    id: 'agent-11',
    description: 'Capture institutional knowledge from every project',
    commands: ['/lesson', '/addlesson'],
    requiredRole: UserRole.OPS_LEAD,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    if (ctx.command === '/addlesson') {
      return this.addManualLesson(ctx);
    }

    const cardIdOrName = ctx.args.trim();
    if (!cardIdOrName) {
      await this.respond(ctx.chatId, 'Usage: /lesson [trello card ID or project name]\n/addlesson [note about a project]');
      return { success: false, message: 'No card specified', confidence: 'LOW' };
    }

    // Try to get Trello card data
    let cardData = '';
    try {
      const card = await getCard(cardIdOrName);
      cardData = `Project: ${card.name}\nDescription: ${card.desc}\nStage: ${card.listName || 'Unknown'}`;
    } catch {
      cardData = `Project reference: ${cardIdOrName}`;
    }

    await this.respond(ctx.chatId, `Generating lessons learned report...`);

    // Pull KB context for this project to enrich the report
    const kbContext = await buildKnowledgeContext(cardIdOrName);

    // Generate 8-section report
    const report = await generateText(
      `Write a Lessons Learned report for this exhibition stand project.\n\n` +
      `PROJECT DATA:\n${cardData}\n\n` +
      `${kbContext ? `ADDITIONAL CONTEXT FROM KNOWLEDGE BASE:\n${kbContext}\n\n` : ''}` +
      `This document will be read by the StandMe team before the next similar project. It should be honest, specific, and immediately useful. Write it like a debrief from someone who was actually on the floor.\n\n` +
      `Structure:\n\n` +
      `# Lessons Learned: [Project Name]\n\n` +
      `## 1. Project Snapshot\n` +
      `What was this project? Show, client, stand size, key objectives. 3-4 sentences.\n\n` +
      `## 2. What Worked Well\n` +
      `Be specific. Not "good communication" but what exactly went right and why. What would you replicate next time without thinking twice?\n\n` +
      `## 3. What Did Not Work\n` +
      `Honest. Not defensive. What created problems, delays, or cost overruns? What decision in hindsight was wrong?\n\n` +
      `## 4. Cost vs Budget Reality\n` +
      `Where did the money actually go? Any surprises? What did we underestimate?\n\n` +
      `## 5. Client Experience\n` +
      `How did the client feel at different stages? At handover? On show day? What do they say when they refer us?\n\n` +
      `## 6. Competitor Intelligence\n` +
      `What other stands were on the floor? What were they doing? What did we learn about how our competitors approach this show?\n\n` +
      `## 7. Timeline Performance\n` +
      `Were we on time? Where did delays come from? What would a tighter timeline need to look like?\n\n` +
      `## 8. What to Do Differently\n` +
      `Three specific changes for next time. Actionable, not vague.\n\n` +
      `If information is unavailable, write: [To be filled in by team] and note what question needs answering.\n\n` +
      `Write with honesty and precision. No filler. No corporate language. No em dashes.`,
      'You are a senior project director at an exhibition stand company. You have built stands across MENA and Europe. Your post-project reviews are blunt, specific, and genuinely useful to the next team who reads them.',
      2500
    );

    // Route to correct Lessons Learned subfolder based on project outcome
    // Won deals → /06_Lessons_Learned/Won_Deals
    // Lost/cancelled → /06_Lessons_Learned/Lost_Deals
    // Delivery problems → /06_Lessons_Learned/Delivery_Issues
    const stageLower = (cardData || '').toLowerCase();
    let lessonCategory: 'lessons-won' | 'lessons-lost' | 'lessons-delivery' = 'lessons-won';
    if (stageLower.includes('lost') || stageLower.includes('cancel') || stageLower.includes('delayed')) {
      lessonCategory = 'lessons-lost';
    } else if (stageLower.includes('delivery') || stageLower.includes('issue') || stageLower.includes('problem')) {
      lessonCategory = 'lessons-delivery';
    }
    const lessonsFolderId = getFolderIdForCategory(lessonCategory);

    const doc = await createGoogleDoc(
      `Lessons Learned — ${cardIdOrName}`,
      report,
      lessonsFolderId
    );

    const folderLabel = lessonCategory === 'lessons-won' ? 'Won_Deals' : lessonCategory === 'lessons-lost' ? 'Lost_Deals' : 'Delivery_Issues';

    // Log to Drive Index so the team can find it
    await appendRow(SHEETS.DRIVE_INDEX, objectToRow(SHEETS.DRIVE_INDEX, {
      fileName: `Lessons Learned — ${cardIdOrName}`,
      fileId: doc.id,
      fileUrl: doc.url,
      folderPath: `/06_Lessons_Learned/${folderLabel}`,
      parentFolder: lessonsFolderId,
      fileType: 'Google Doc',
      lastModified: new Date().toISOString(),
      linkedProject: cardIdOrName,
      category: 'Lessons Learned',
    })).catch(() => {});

    // Add summary to sheet
    await appendRow(SHEETS.LESSONS_LEARNED, objectToRow(SHEETS.LESSONS_LEARNED, {
      id: `LL-${Date.now()}`,
      projectName: cardIdOrName,
      showName: '',
      client: '',
      outcome: '',
      standSize: '',
      budget: '',
      whatWentWell: 'See doc',
      whatWentWrong: 'See doc',
      costVsBudget: '',
      clientFeedback: '',
      competitorIntel: '',
      docUrl: doc.url,
      date: new Date().toISOString().split('T')[0],
    }));

    // Save key lessons to Knowledge Base — every agent benefits from project history
    await saveKnowledge({
      source: doc.url,
      sourceType: 'drive',
      topic: cardIdOrName,
      tags: `lessons-learned,project,post-mortem,institutional-knowledge`,
      content: `Lessons from "${cardIdOrName}": ${report.slice(0, 450)}`,
    });

    await sendToMo(formatType1(
      `Lessons Learned: ${cardIdOrName}`,
      'Report generated',
      `Doc: ${doc.url}\n\nReview and add notes:\n/approve\\_ll or /addlesson [your notes]`,
      `ll_${Date.now()}`
    ));

    await this.respond(ctx.chatId, `✅ Lessons learned report created.\nDoc: ${doc.url}`);

    return { success: true, message: 'Lessons learned report created', confidence: 'MEDIUM', data: { docUrl: doc.url } };
  }

  private async addManualLesson(ctx: AgentContext): Promise<AgentResponse> {
    if (!ctx.args) {
      await this.respond(ctx.chatId, 'Usage: /addlesson [your lesson/note]');
      return { success: false, message: 'No lesson provided', confidence: 'LOW' };
    }

    // Save to Knowledge Base immediately so all agents see it
    await saveKnowledge({
      source: 'manual-lesson',
      sourceType: 'manual',
      topic: 'lessons-learned',
      tags: `lesson,manual,institutional-knowledge`,
      content: ctx.args.slice(0, 500),
    });

    await appendRow(SHEETS.LESSONS_LEARNED, objectToRow(SHEETS.LESSONS_LEARNED, {
      id: `LL-${Date.now()}`,
      projectName: 'Manual Entry',
      showName: '',
      client: '',
      outcome: '',
      standSize: '',
      budget: '',
      whatWentWell: '',
      whatWentWrong: '',
      costVsBudget: '',
      clientFeedback: '',
      competitorIntel: '',
      docUrl: '',
      date: new Date().toISOString().split('T')[0],
    }));

    const lessonsSheetLink = sheetUrl(SHEETS.LESSONS_LEARNED);
    await this.respond(ctx.chatId, `✅ Lesson noted and logged.${lessonsSheetLink ? `\n📊 [View Lessons Learned](${lessonsSheetLink})` : ''}`);
    return { success: true, message: 'Manual lesson added', confidence: 'HIGH' };
  }
}
