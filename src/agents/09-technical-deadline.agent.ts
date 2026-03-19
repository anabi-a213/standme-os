import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { readSheet, appendRow, updateCell, objectToRow } from '../services/google/sheets';
import { generateText } from '../services/ai/client';
import { sendToMo, formatType2 } from '../services/telegram/bot';

export class TechnicalDeadlineAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'Portal & Technical Deadline Tracker',
    id: 'agent-09',
    description: 'Extract and track all show organiser deadlines',
    commands: ['/techdeadlines'],
    schedule: '10 9 * * *', // 9:10am daily (staggered 10 min from deadline monitor)
    requiredRole: UserRole.OPS_LEAD,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    // Read current deadlines
    const existing = await readSheet(SHEETS.TECHNICAL_DEADLINES);
    const now = new Date();
    const alerts: string[] = [];

    // Check existing deadlines for overdue/imminent
    for (let i = 1; i < existing.length; i++) {
      const row = existing[i];
      const showName = row[1] || '';
      const client = row[2] || '';
      const deadlineTypes = [
        { name: 'Portal Submission', col: 3 },
        { name: 'Rigging', col: 4 },
        { name: 'Electrics', col: 5 },
        { name: 'Design Approval', col: 6 },
        { name: 'Build Start', col: 7 },
        { name: 'Show Open', col: 8 },
        { name: 'Breakdown', col: 9 },
      ];

      for (const dt of deadlineTypes) {
        const dateStr = row[dt.col];
        if (!dateStr) continue;

        const deadline = new Date(dateStr);
        const daysUntil = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        if (daysUntil < 0) {
          alerts.push(`🔴 OVERDUE: ${showName} — ${dt.name} (${client}) — ${Math.abs(daysUntil)} days overdue`);
        } else if (daysUntil <= 7) {
          alerts.push(`🟠 IMMINENT: ${showName} — ${dt.name} (${client}) — ${daysUntil} days`);
        }
      }

      // Check if re-verification needed (every 7 days, or never verified at all)
      const lastVerified = row[12];
      if (!lastVerified) {
        alerts.push(`🔄 UNVERIFIED: ${showName} (${client}) — deadlines have never been verified`);
      } else {
        const verifiedDate = new Date(lastVerified);
        const daysSinceVerify = Math.ceil((now.getTime() - verifiedDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceVerify >= 7) {
          alerts.push(`🔄 RE-VERIFY: ${showName} deadlines last verified ${daysSinceVerify} days ago`);
        }
      }
    }

    if (alerts.length > 0) {
      await sendToMo(formatType2(
        'Technical Deadline Alerts',
        alerts.join('\n\n')
      ));
    }

    await this.respond(ctx.chatId,
      alerts.length > 0
        ? `⚠️ ${alerts.length} technical deadline alerts.\n\n${alerts.join('\n')}`
        : '✅ No urgent technical deadlines.'
    );

    return {
      success: true,
      message: `${alerts.length} technical deadline alerts`,
      confidence: 'HIGH',
    };
  }
}
