import cron from 'node-cron';
import { getScheduledAgents } from '../agents/registry';
import { logger } from '../utils/logger';
import { writeSystemLog } from '../utils/system-log';
import { sendToMo, formatType2 } from '../services/telegram/bot';

export function startScheduler(): void {
  const scheduledAgents = getScheduledAgents();

  for (const agent of scheduledAgents) {
    if (!agent.config.schedule) continue;

    try {
      cron.schedule(agent.config.schedule, async () => {
        logger.info(`[Scheduler] Running: ${agent.config.name}`);

        try {
          await agent.runScheduled();
          logger.info(`[Scheduler] Completed: ${agent.config.name}`);
        } catch (err: any) {
          logger.error(`[Scheduler] Failed: ${agent.config.name} — ${err.message}`);

          await writeSystemLog({
            agent: 'Scheduler',
            actionType: 'scheduled_run',
            detail: `${agent.config.name} failed: ${err.message}`,
            result: 'FAIL',
            retry: false,
          });

          // TYPE 2 alert to Mo
          await sendToMo(formatType2(
            `Scheduled Agent Failed: ${agent.config.name}`,
            `Error: ${err.message}\nSchedule: ${agent.config.schedule}`
          ));
        }
      }, {
        timezone: 'Europe/Berlin',
      });

      logger.info(`[Scheduler] Registered: ${agent.config.name} — ${agent.config.schedule}`);
    } catch (err: any) {
      logger.error(`[Scheduler] Failed to register: ${agent.config.name} — ${err.message}`);
    }
  }

  logger.info(`[Scheduler] ${scheduledAgents.length} agents scheduled`);
}
