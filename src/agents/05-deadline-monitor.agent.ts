import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { getBoardCardsWithListNames } from '../services/trello/client';
import { sendToTeam, formatType2 } from '../services/telegram/bot';

export class DeadlineMonitorAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Project Deadline Monitor',
    id: 'agent-05',
    description: 'Flag overdue and imminent deadlines across all Trello boards',
    commands: ['/deadlines'],
    schedule: '0 9,17 * * *', // 9am + 5pm daily
    requiredRole: UserRole.OPS_LEAD,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    const boardKeys = [
      'TRELLO_BOARD_SALES_PIPELINE',
      'TRELLO_BOARD_DESIGN',
      'TRELLO_BOARD_OPERATION',
      'TRELLO_BOARD_PRODUCTION',
    ];

    const now = new Date();
    const alerts: string[] = [];

    for (const boardKey of boardKeys) {
      const boardId = process.env[boardKey];
      if (!boardId) continue;

      try {
        const cards = await getBoardCardsWithListNames(boardId);

        for (const card of cards) {
          if (!card.due) continue;

          const dueDate = new Date(card.due);
          const daysUntil = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

          let riskScore = 0;
          if (daysUntil < 0) riskScore = 90 + Math.min(10, Math.abs(daysUntil));
          else if (daysUntil <= 3) riskScore = 70 + (3 - daysUntil) * 6;
          else if (daysUntil <= 7) riskScore = 50 + (7 - daysUntil) * 5;
          else if (daysUntil <= 14) riskScore = 30 + (14 - daysUntil) * 3;

          if (riskScore >= 70) {
            const emoji = daysUntil < 0 ? '🔴' : '🟠';
            const status = daysUntil < 0 ? `OVERDUE by ${Math.abs(daysUntil)} days` : `Due in ${daysUntil} days`;
            alerts.push(`${emoji} ${card.name}\n   ${status} | Risk: ${riskScore} | Board: ${boardKey.replace('TRELLO_BOARD_', '')}`);
          }
        }
      } catch (err: any) {
        alerts.push(`⚠️ Could not read board ${boardKey}: ${err.message}`);
      }
    }

    if (alerts.length === 0) {
      await this.respond(ctx.chatId, '✅ No urgent deadlines. All clear.');
      return { success: true, message: 'No urgent deadlines', confidence: 'HIGH' };
    }

    const message = formatType2(
      'Deadline Alerts',
      alerts.join('\n\n')
    );

    const recipients = [
      process.env.MO_TELEGRAM_ID || '',
      process.env.HADEER_TELEGRAM_ID || '',
    ].filter(Boolean);
    await sendToTeam(message, recipients);

    if (ctx.chatId && ctx.command !== 'scheduled') {
      await this.respond(ctx.chatId, message);
    }

    return {
      success: true,
      message: `${alerts.length} deadline alerts sent`,
      confidence: 'HIGH',
    };
  }
}
