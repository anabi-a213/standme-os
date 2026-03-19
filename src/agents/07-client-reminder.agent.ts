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
    schedule: '5 9,17 * * *', // 9:05am + 5:05pm daily (staggered 5 min from deadline monitor)
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
      const stageContext: Record<string, string> = {
        'Proposal Sent': 'We sent them a proposal. They have not replied. The question is whether they have questions, want to negotiate, or went quiet.',
        'Design/Brief': 'We are waiting for their feedback on a concept brief or design direction. Every day of silence costs us revision time.',
      };

      const followUpDraft = await generateText(
        `Write a follow-up email for an exhibition stand client.\n\n` +
        `Client / Project: ${reminder.card.name}\n` +
        `Silence: ${reminder.daysSince} days\n` +
        `Stage: ${reminder.stage}\n` +
        `Context: ${stageContext[reminder.stage] || 'Active project, no response for several days.'}\n\n` +
        `The email should:\n` +
        `- Open with something useful or specific, not a check-in\n` +
        `- Show we are on top of it and ready to move\n` +
        `- Make it easy for them to reply (one clear question or CTA)\n` +
        `- Feel like it comes from a human who actually cares about their project\n` +
        `- Max 4 lines\n` +
        `- Sign off as: Mo / StandMe\n\n` +
        `NEVER write: "just checking in", "I hope this finds you well", "I wanted to follow up", "as per my last email", em dashes.`,
        'You write follow-up emails for an exhibition stand company. Your tone is warm, direct, and professional. You know the pressure clients are under before a show. You write emails that get read and replied to.',
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
