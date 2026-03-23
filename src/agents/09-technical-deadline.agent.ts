import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { readSheet, appendRow, updateCell, objectToRow } from '../services/google/sheets';
import { generateText } from '../services/ai/client';
import { sendToMo, formatType2 } from '../services/telegram/bot';
import { SHOW_PROFILES } from '../config/standme-knowledge';

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

    // Show calendar estimates for shows in pipeline with no deadline on file
    try {
      const leads = await readSheet(SHEETS.LEAD_MASTER);
      const showsWithDeadlines = new Set(existing.slice(1).map(r => (r[1] || '').toLowerCase()));
      for (const row of leads.slice(1)) {
        const status = (row[15] || '').toUpperCase();
        const show = row[6] || '';
        if (!show || (status !== 'HOT' && status !== 'WARM')) continue;
        const hasOnFile = [...showsWithDeadlines].some(s => s.includes(show.toLowerCase().substring(0, 6)));
        if (!hasOnFile) {
          const profileKey = Object.keys(SHOW_PROFILE_MAP).find(k => show.toLowerCase().includes(k));
          if (profileKey) {
            const profile = SHOW_PROFILES[SHOW_PROFILE_MAP[profileKey]];
            if (profile) {
              alerts.push(
                `📅 No deadlines on file for *${show}* — estimated from show calendar:\n` +
                `   • ${profile.deadlineNote}\n` +
                `   ⚠️ Confirm with organiser. Add confirmed dates with /techdeadlines.`
              );
            }
          }
        }
      }
    } catch { /* non-fatal */ }

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
