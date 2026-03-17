import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { getBoardCardsWithListNames } from '../services/trello/client';
import { generateText, detectLanguage } from '../services/ai/client';
import { sendToMo, formatType1 } from '../services/telegram/bot';

export class ClientReminderAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Client Communication Reminder',
    id: 'agent-07',
    description: 'Ensure no client goes uncontacted too long',
    commands: ['/reminders'],
    schedule: '0 9,17 * * *', // 9am + 5pm daily
    requiredRole: UserRole.OPS_LEAD,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    const boardId = process.env.TRELLO_BOARD_SALES_PIPELINE || '';
    if (!boardId) {
      return { success: false, message: 'No sales pipeline board configured', confidence: 'LOW' };
    }

    const cards = await getBoardCardsWithListNames(boardId);
    const now = new Date();
    const reminders: { card: typeof cards[0]; daysSince: number; stage: string }[] = [];

    for (const card of cards) {
      const lastActivity = new Date(card.dateLastActivity);
      const daysSince = Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));
      const stage = card.listName || '';

      // Proposal sent + no reply after 3 days
      if (stage.includes('04') && daysSince >= 3) {
        reminders.push({ card, daysSince, stage: 'Proposal Sent' });
      }
      // Design approval + no reply after 2 days
      if ((stage.includes('03') || stage.includes('Brief')) && daysSince >= 2) {
        reminders.push({ card, daysSince, stage: 'Design/Brief' });
      }
      // Any stage + 5+ days of silence
      if (daysSince >= 5 && !stage.includes('06') && !stage.includes('07')) {
        if (!reminders.find(r => r.card.id === card.id)) {
          reminders.push({ card, daysSince, stage });
        }
      }
    }

    if (reminders.length === 0) {
      await this.respond(ctx.chatId, '✅ All clients have been contacted recently.');
      return { success: true, message: 'No follow-ups needed', confidence: 'HIGH' };
    }

    for (const reminder of reminders.slice(0, 5)) { // Cap at 5
      const followUpDraft = await generateText(
        `Draft a follow-up message for a client "${reminder.card.name}" who hasn't replied in ${reminder.daysSince} days. ` +
        `Stage: ${reminder.stage}. Exhibition stand context. ` +
        `Rules: NO "just checking in", NO "hope this finds you well", max 4 lines, direct and helpful.`,
        'Write concise follow-up emails. Professional, never desperate.',
        300
      );

      await sendToMo(formatType1(
        `Follow Up: ${reminder.card.name}`,
        `${reminder.daysSince} days no contact (${reminder.stage})`,
        `Draft:\n\n${followUpDraft}`,
        `followup_${reminder.card.id}`
      ));
    }

    await this.respond(ctx.chatId, `⚠️ ${reminders.length} client follow-ups needed. Drafts sent to Mo.`);

    return {
      success: true,
      message: `${reminders.length} follow-up reminders generated`,
      confidence: 'HIGH',
    };
  }
}
