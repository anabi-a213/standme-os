import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { getBoardCardsWithListNames } from '../services/trello/client';
import { sendToTeam, formatType2 } from '../services/telegram/bot';
import { readSheet } from '../services/google/sheets';
import { SHEETS } from '../config/sheets';
import { SHOW_PROFILES } from '../config/standme-knowledge';

// Map show name keywords → SHOW_PROFILES key for calendar estimation
const SHOW_PROFILE_MAP: Record<string, string> = {
  'arab health':    'arabHealth',
  'gulfood':        'gulfood',
  'hannover messe': 'hannoverMesse',
  'hannover':       'hannoverMesse',
  'interpack':      'interpack',
  'intersolar':     'intersolar',
  'medica':         'medica',
  'sial':           'sialParis',
  'ise':            'ise',
};

function estimateDeadlinesFromShowCalendar(showName: string): string | null {
  const key = Object.keys(SHOW_PROFILE_MAP).find(k =>
    showName.toLowerCase().includes(k)
  );
  if (!key) return null;
  const profile = SHOW_PROFILES[SHOW_PROFILE_MAP[key]];
  if (!profile) return null;
  return (
    `No deadlines on file for *${showName}* — estimated from show calendar:\n` +
    `   • ${profile.deadlineNote}\n` +
    `   ⚠️ Confirm with organiser. Add confirmed dates with /techdeadlines.`
  );
}

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
          if (isNaN(dueDate.getTime())) continue; // skip cards with invalid due date format
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

    // Show calendar estimation — check TECHNICAL_DEADLINES for shows in pipeline
    try {
      const deadlines = await readSheet(SHEETS.TECHNICAL_DEADLINES);
      const leads = await readSheet(SHEETS.LEAD_MASTER);
      const showsWithDeadlines = new Set(deadlines.slice(1).map(r => (r[1] || '').toLowerCase()));
      const activeShows = new Set<string>();
      for (const row of leads.slice(1)) {
        const status = (row[15] || '').toUpperCase();
        const show = row[6] || '';
        if (show && (status === 'HOT' || status === 'WARM')) activeShows.add(show);
      }
      for (const show of activeShows) {
        const hasOnFile = [...showsWithDeadlines].some(s => s.includes(show.toLowerCase().substring(0, 5)));
        if (!hasOnFile) {
          const estimate = estimateDeadlinesFromShowCalendar(show);
          if (estimate) alerts.push(`📅 ${estimate}`);
        }
      }
    } catch { /* non-fatal — calendar estimation is best-effort */ }

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
