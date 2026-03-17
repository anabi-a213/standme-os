import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { appendRow, objectToRow } from '../services/google/sheets';
import { getCard } from '../services/trello/client';
import { createGoogleDoc } from '../services/google/drive';
import { generateText } from '../services/ai/client';
import { sendToMo, formatType1 } from '../services/telegram/bot';

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

    // Generate 8-section report
    const report = await generateText(
      `Generate a Lessons Learned report for this exhibition stand project:\n\n${cardData}\n\n` +
      `Write 8 sections (be specific, no filler):\n` +
      `1. Project Overview\n2. What Went Well\n3. What Went Wrong\n` +
      `4. Cost vs Budget\n5. Client Feedback\n6. Competitor Intel\n` +
      `7. Timeline Performance\n8. What to Do Differently\n\n` +
      `If information is missing, note what should be filled in manually.`,
      'You are a project manager writing post-project reviews. Be honest and specific.',
      2000
    );

    // Create Google Doc
    const doc = await createGoogleDoc(
      `Lessons Learned — ${cardIdOrName}`,
      report
    );

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

    await this.respond(ctx.chatId, '✅ Lesson noted and logged.');
    return { success: true, message: 'Manual lesson added', confidence: 'HIGH' };
  }
}
