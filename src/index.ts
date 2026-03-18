import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { createServer } from 'http';
import path from 'path';
import cookieParser from 'cookie-parser';
import { initBot, getBot, buildContext, sendToMo, formatType2 } from './services/telegram/bot';
import { registerAgent, getAgent, getAllAgents } from './agents/registry';
import { dashboardBus } from './services/dashboard/event-bus';
import { initDashboardSocket } from './services/dashboard/socket';
import { dashboardRouter } from './services/dashboard/routes';
import { startScheduler } from './scheduler';
import { logger } from './utils/logger';
import { writeSystemLog } from './utils/system-log';
import { canApprove, getUserRole, UserRole } from './config/access';
import { handleApproval } from './services/approvals';
import { initSheets } from './services/google/sheets-init';
import { loadRuntimeConfig } from './services/runtime-config';
import { warmGoogleAuth } from './services/google/auth';

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

  // Load dynamic config (Drive folder IDs, etc.) from Knowledge Base into process.env
  // This runs BEFORE agents start so all folder IDs are available immediately.
  // Drive folder IDs are saved here by /setupdrive — no Railway env vars needed for them.
  await loadRuntimeConfig();

  // Warn about optional but important sheet env vars
  const optionalSheets: Record<string, string> = {
    SHEET_CAMPAIGN_SALES: '/newcampaign, /discover, /salesreplies, /campaignstatus',
  };
  for (const [key, commands] of Object.entries(optionalSheets)) {
    if (!process.env[key]) {
      logger.warn(`[Startup] ${key} not set — ${commands} will run in degraded mode`);
    }
  }

  // Pre-warm Google OAuth token so first Sheets/Drive call isn't slow
  await warmGoogleAuth();

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
    dashboardBus.registerAgent(agent.config.id, agent.config.name);
    logger.info(`  Registered: ${agent.config.name} (${agent.config.commands.join(', ')})`);
  }

  // Initialize Telegram bot (skip polling in local dashboard-only mode)
  if (process.env.DASHBOARD_ONLY === 'true') {
    logger.info('[Bot] DASHBOARD_ONLY mode — Telegram polling disabled');
  }
  const bot = process.env.DASHBOARD_ONLY === 'true' ? getBot() : initBot();

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
        `/indexwoodpecker — Index all Woodpecker emails to Knowledge Base\n` +
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
        `/healthcheck — Check all system services\n` +
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

      dashboardBus.logEvent('telegram', 'Telegram Bot',
        `📱 @${ctx.username} (${ctx.role}) → ${command}${ctx.args ? ' ' + ctx.args.substring(0, 60) : ''}`
      );
      await agent.run(ctx);
    } else {
      // Route to Brain for natural language queries
      const brain = getAgent('/ask');
      if (brain) {
        dashboardBus.logEvent('telegram', 'Telegram Bot',
          `📱 @${ctx.username} (${ctx.role}) → /ask: ${text.substring(0, 80)}`
        );
        ctx.args = text;
        ctx.command = '/ask';
        await brain.run(ctx);
      } else {
        await bot.sendMessage(msg.chat.id, 'Unknown command. Type /help for available commands.');
      }
    }
  });

  // Start webhook + dashboard server
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(express.static(path.join(process.cwd(), 'public')));

  // Dashboard routes (served at /dashboard)
  app.use('/dashboard', dashboardRouter);

  // POST /webhook/woodpecker — receives reply/open/bounce events from Woodpecker
  app.post('/webhook/woodpecker', async (req, res) => {
    res.sendStatus(200);

    const secret = process.env.WOODPECKER_WEBHOOK_SECRET;
    if (secret && req.headers['x-woodpecker-secret'] !== secret) {
      logger.warn('[Webhook] Woodpecker: invalid secret, ignoring');
      return;
    }

    const { status, prospect } = req.body || {};
    const prospectEmail = (prospect?.email || '').toLowerCase();
    const eventType = (status || '').toUpperCase();

    logger.info(`[Webhook] Woodpecker: ${eventType} — ${prospectEmail}`);
    dashboardBus.logEvent('agent-17', 'Campaign Builder', `Webhook: ${eventType} — ${prospectEmail}`);

    const campaignAgent = getAgent('/salesreplies');
    if (!campaignAgent || !prospectEmail) return;

    if (eventType === 'REPLIED') {
      const ctx = {
        userId: 'webhook',
        username: 'webhook',
        chatId: parseInt(process.env.MO_TELEGRAM_ID || '0'),
        command: 'scheduled',
        args: '',
        role: UserRole.ADMIN,
        language: 'en' as const,
      };
      campaignAgent.run(ctx).catch((err: any) =>
        logger.warn(`[Webhook] Reply processing error: ${err.message}`)
      );
    } else if (['OPENED', 'BOUNCED', 'INVALID', 'INTERESTED', 'NOT_INTERESTED', 'UNSUBSCRIBED'].includes(eventType)) {
      (campaignAgent as any).handleWebhookEvent(eventType, prospectEmail)
        .catch((err: any) => logger.warn(`[Webhook] Event error: ${err.message}`));
    }
  });

  // Health check endpoint for Railway
  app.get('/health', (_req, res) => res.json({ status: 'ok', agents: getAllAgents().length }));

  // Redirect root to dashboard
  app.get('/', (_req, res) => res.redirect('/dashboard'));

  const PORT = parseInt(process.env.PORT || '3000');
  const httpServer = createServer(app);
  initDashboardSocket(httpServer);
  httpServer.listen(PORT, () => {
    logger.info(`  Server on port ${PORT} — Dashboard: /dashboard | Webhook: /webhook/woodpecker`);
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
