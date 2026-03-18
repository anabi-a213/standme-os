import { AgentConfig, AgentContext, AgentResponse, MessageType } from '../types/agent';
import { ConfidenceLevel } from '../types/confidence';
import { writeSystemLog, LogResult } from '../utils/system-log';
import { logger } from '../utils/logger';
import { getBot, formatType1, formatType2, formatType3, sendToMo } from '../services/telegram/bot';
import { getThreadContext, getActiveFocus, saveThreadEntry } from '../services/thread-context';
import { dashboardBus } from '../services/dashboard/event-bus';

export abstract class BaseAgent {
  abstract config: AgentConfig;

  abstract execute(context: AgentContext): Promise<AgentResponse>;

  // Run with full error handling and logging
  async run(context: AgentContext): Promise<AgentResponse> {
    const startTime = Date.now();
    logger.info(`[${this.config.id}] Starting: ${this.config.name}`);
    dashboardBus.agentStarted(this.config.id, this.config.name, context.command);

    // Inject thread context so every agent knows what the user has been working on
    if (context.userId !== 'SYSTEM') {
      context.threadContext = getThreadContext(context.userId);
      context.activeFocus = getActiveFocus(context.userId);
    }

    try {
      const result = await this.execute(context);
      const duration = Date.now() - startTime;

      // Save this interaction to thread so future agents have context
      if (context.userId !== 'SYSTEM') {
        saveThreadEntry(
          context.userId,
          this.config.id,
          context.command,
          context.args,
          result.message
        );
      }

      await this.log({
        actionType: context.command,
        detail: result.message.substring(0, 200),
        result: result.success ? 'SUCCESS' : 'FAIL',
      });

      dashboardBus.agentFinished(this.config.id, this.config.name, result.success, duration, result.message);
      logger.info(`[${this.config.id}] Completed in ${duration}ms`);
      return result;
    } catch (error: any) {
      const errMsg = error.message || 'Unknown error';
      logger.error(`[${this.config.id}] Error: ${errMsg}`);

      await this.log({
        actionType: context.command,
        detail: `ERROR: ${errMsg}`,
        result: 'FAIL',
      });

      // Never fail silently — alert Mo
      await sendToMo(formatType2(
        `Agent ${this.config.name} Error`,
        `Command: ${context.command}\nError: ${errMsg}`
      ));

      const errorDuration = Date.now() - startTime;
      dashboardBus.agentFinished(this.config.id, this.config.name, false, errorDuration, errMsg);

      return {
        success: false,
        message: `Error in ${this.config.name}: ${errMsg}`,
        confidence: 'LOW',
      };
    }
  }

  // Run on schedule (no user context)
  async runScheduled(): Promise<AgentResponse> {
    const context: AgentContext = {
      userId: 'SYSTEM',
      chatId: parseInt(process.env.MO_TELEGRAM_ID || '0'),
      command: 'scheduled',
      args: '',
      role: 'ADMIN' as any,
      language: 'en',
    };
    return this.run(context);
  }

  // Send message to chat
  async respond(chatId: number, message: string): Promise<void> {
    try {
      await getBot().sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (err: any) {
      // Try without markdown if it fails
      try {
        await getBot().sendMessage(chatId, message);
      } catch (err2: any) {
        logger.error(`Failed to send message: ${err2.message}`);
      }
    }
  }

  // Send TYPE 1 action message
  async sendAction(chatId: number, what: string, why: string, detail: string, approveId: string): Promise<void> {
    dashboardBus.approvalEvent(this.config.id, this.config.name, what, approveId);
    await this.respond(chatId, formatType1(what, why, detail, approveId));
  }

  // Send TYPE 2 alert
  async sendAlert(chatId: number, topic: string, detail: string): Promise<void> {
    await this.respond(chatId, formatType2(topic, detail));
  }

  // Send TYPE 3 summary
  async sendSummary(chatId: number, title: string, sections: { label: string; content: string }[]): Promise<void> {
    await this.respond(chatId, formatType3(title, sections));
  }

  // Write to master system log
  async log(entry: { actionType: string; showName?: string; detail: string; result: LogResult; retry?: boolean; notes?: string }): Promise<void> {
    await writeSystemLog({
      agent: this.config.name,
      ...entry,
    });
  }
}
