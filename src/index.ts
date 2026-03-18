import dotenv from 'dotenv';
dotenv.config();

import { initBot, getBot, buildContext, sendToMo, formatType2 } from './services/telegram/bot';
import { registerAgent, getAgent, getAllAgents } from './agents/registry';
import { startScheduler } from './scheduler';
import { logger } from './utils/logger';
import { writeSystemLog } from './utils/system-log';
import { canApprove, getUserRole, UserRole } from './config/access';
import { handleApproval } from './services/approvals';
import { initSheets } from './services/google/sheets-init';

// Import all agents
import { LeadIntakeAgent } from './agents/01-lead-intake.agent';
import { LeadEnrichmentAgent } from './agents/02-lead-enrichment.agent';
import { ConceptBriefAgent } from './agents/03-concept-brief.agent';
import { BrainAgent } from './agents/04-brain.agent';
import { DeadlineMonitorAgent } from './agents/05-deadline-monitor.agent';
import { ProjectStatusAgent } from './agents/06-project-status.agent';
import { ClientReminderAgent } from './agents/07-client-reminder.agent';
import { TechnicalDeadlineAgent } from './agents/09-technical-deadline.agent';
import { ContractorCoordAgent } from './agents/10-contractor-coord.agent';
import { LessonsLearnedAgent } from './agents/11-lessons-learned.agent';
import { DealAnalyserAgent } from './agents/12-deal-analyser.agent';
import { OutreachAgent } from './agents/13-outreach.agent';
import { DriveIndexerAgent } from './agents/14-drive-indexer.agent';
import { MarketingContentAgent } from './agents/15-marketing-content.agent';
import { CardManagerAgent } from './agents/08-card-manager.agent';
import { CrossBoardAgent } from './agents/16-cross-board.agent';
import { CampaignBuilderAgent } from './agents/17-campaign-builder.agent';


async function main() {
  logger.info('========================================');
  logger.info('  StandMe OS — Starting...');
  logger.info('========================================');

  // Auto-check and create any missing Google Sheets tabs
  initSheets().catch(err => logger.warn(`[Sheets Init] Failed: ${err.message}`));

  // Register all agents
  const agents = [
    new LeadIntakeAgent(),
    new LeadEnrichmentAgent(),
    new ConceptBriefAgent(),
    new BrainAgent(),
    new DeadlineMonitorAgent(),
    new ProjectStatusAgent(),
    new ClientReminderAgent(),
    new CardManagerAgent(),
    new TechnicalDeadlineAgent(),
    new ContractorCoordAgent(),
    new LessonsLearnedAgent(),
    new DealAnalyserAgent(),
    new OutreachAgent(),
    new CampaignBuilderAgent(),
    new DriveIndexerAgent(),
    new MarketingContentAgent(),
    new CrossBoardAgent(),
  ];

  for (const agent of agents) {
    registerAgent(agent);
    logger.info(`  Registered: ${agent.config.name} (${agent.config.commands.join(', ')})`);
  }

  // Initialize Telegram bot
  const bot = initBot();

  // Handle all messages
  bot.on('message', async (msg) => {
    if (!msg.text || !msg.from) return;

    const ctx = await buildContext(msg);
    if (!ctx) return; // Unregistered user, already handled

    const text = msg.text.trim();

    // Handle /start
    if (text === '/start') {
      await bot.sendMessage(msg.chat.id,
        `*StandMe OS* 🏗️\n\n` +
        `Welcome. You're registered as ${ctx.role}.\n\n` +
        `*Commands:*\n` +
        `/newlead — Add a new lead\n` +
        `/enrich — Enrich pending leads\n` +
        `/brief [client] — Generate concept brief\n` +
        `/status — Pipeline dashboard\n` +
        `/deadlines — Check deadlines\n` +
        `/reminders — Client follow-ups\n` +
        `/movecard — Move a card to a pipeline stage\n` +
        `/techdeadlines — Technical deadlines\n` +
        `/outreach — Run outreach\n` +
        `/outreachstatus — Outreach stats\n` +
        `/newcampaign [show] — Build full show campaign\n` +
        `/salesreplies — Handle campaign replies (sales loop)\n` +
        `/campaignstatus [show] — Campaign pipeline status\n` +
        `/contractors — List contractors\n` +
        `/addcontractor — Add contractor\n` +
        `/bookcontractor — Book contractor\n` +
        `/lesson — Record lessons learned\n` +
        `/dealanalysis — Deal analysis\n` +
        `/findfile — Search Drive\n` +
        `/indexdrive — Re-index Drive\n` +
        `/crossboard — Cross-board check\n` +
        `/post /caption /campaign — Marketing\n` +
        `/casestudy /portfolio /insight — Content\n` +
        `/contentplan — Weekly content plan\n` +
        `/ask [question] — Ask the Brain\n` +
        `/help — Show this menu`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (text === '/help') {
      await bot.sendMessage(msg.chat.id,
        `*StandMe OS Help*\n\n` +
        `17 agents running. All actions require Mo's approval.\n` +
        `Type any command or ask a question with /ask.\n\n` +
        `Your role: ${ctx.role}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Handle /approve_[id] and /reject_[id]
    if (text.startsWith('/approve_') || text.startsWith('/reject_')) {
      const isApprove = text.startsWith('/approve_');
      const approvalId = text.replace(/^\/(approve|reject)_/, '');

      if (!canApprove(ctx.role)) {
        await bot.sendMessage(msg.chat.id, 'You do not have approval permissions.');
        return;
      }

      const result = await handleApproval(approvalId, isApprove);
      await bot.sendMessage(msg.chat.id, result || (isApprove ? '✅ Approved.' : '❌ Rejected.'), { parse_mode: 'Markdown' });
      await writeSystemLog({
        agent: 'Brain',
        actionType: isApprove ? 'APPROVE' : 'REJECT',
        detail: approvalId,
        result: 'SUCCESS',
      });
      return;
    }

    // Route to agent by command
    const command = text.split(/\s+/)[0].toLowerCase();
    const agent = getAgent(command);

    if (agent) {
      // Check permission
      const roleOrder: Record<string, number> = {
        [UserRole.ADMIN]: 3,
        [UserRole.SUB_ADMIN]: 2,
        [UserRole.OPS_LEAD]: 1,
        [UserRole.UNREGISTERED]: 0,
      };

      const requiredLevel = roleOrder[agent.config.requiredRole] || 0;
      const userLevel = roleOrder[ctx.role] || 0;

      if (userLevel < requiredLevel) {
        await bot.sendMessage(msg.chat.id, `Access denied. This command requires ${agent.config.requiredRole} role.`);
        return;
      }

      await agent.run(ctx);
    } else {
      // Route to Brain for natural language queries
      const brain = getAgent('/ask');
      if (brain) {
        ctx.args = text;
        ctx.command = '/ask';
        await brain.run(ctx);
      } else {
        await bot.sendMessage(msg.chat.id, 'Unknown command. Type /help for available commands.');
      }
    }
  });

  // Start scheduler
  startScheduler();

  // Log startup
  await writeSystemLog({
    agent: 'System',
    actionType: 'STARTUP',
    detail: `StandMe OS started. ${agents.length} agents registered.`,
    result: 'SUCCESS',
  });

  logger.info('========================================');
  logger.info('  StandMe OS — RUNNING');
  logger.info(`  ${agents.length} agents | Scheduler active`);
  logger.info('  Telegram bot polling...');
  logger.info('========================================');
}

// Global error handling
process.on('uncaughtException', async (err) => {
  logger.error(`Uncaught exception: ${err.message}`);
  try {
    await sendToMo(formatType2('SYSTEM ERROR', `Uncaught exception: ${err.message}`));
  } catch { /* last resort */ }
});

process.on('unhandledRejection', async (reason: any) => {
  logger.error(`Unhandled rejection: ${reason?.message || reason}`);
  try {
    await sendToMo(formatType2('SYSTEM ERROR', `Unhandled rejection: ${reason?.message || reason}`));
  } catch { /* last resort */ }
});

main().catch(err => {
  logger.error(`Fatal startup error: ${err.message}`);
  process.exit(1);
});
