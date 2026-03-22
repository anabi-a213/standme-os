import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import express from 'express';
import { createServer } from 'http';
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
import { handleApproval, logApprovalStoreStatus } from './services/approvals';
import { initSheets } from './services/google/sheets-init';
import { validateSheetHeaders } from './services/google/sheets';
import { SHEETS } from './config/sheets';
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
import { OutreachAgent, reconstructBulkApproval } from './agents/13-outreach.agent';
import { getReplies as getInstantlyReplies, isInstantlyConfigured } from './services/instantly/client';
import { DriveIndexerAgent } from './agents/14-drive-indexer.agent';
import { MarketingContentAgent } from './agents/15-marketing-content.agent';
import { CardManagerAgent } from './agents/08-card-manager.agent';
import { CrossBoardAgent } from './agents/16-cross-board.agent';
import { CampaignBuilderAgent } from './agents/17-campaign-builder.agent';
import { GmailLeadMonitorAgent } from './agents/18-gmail-lead-monitor.agent';
import { initWorkflowEngine } from './services/workflow-engine';


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

  // Validate critical sheet column headers at startup — catches manual reorders
  // before they silently corrupt writes. Runs non-blocking (async, no await).
  Promise.all([
    validateSheetHeaders(SHEETS.LEAD_MASTER),
    validateSheetHeaders(SHEETS.OUTREACH_LOG),
    validateSheetHeaders(SHEETS.SYSTEM_LOG),
  ]).then(([leads, outreach, syslog]) => {
    if (!leads || !outreach || !syslog) {
      logger.warn('[Startup] One or more critical sheet headers do not match config — check logs above');
    }
  }).catch(() => { /* non-blocking — sheets may not exist yet */ });

  // Log approval store state at startup (will always be 0 on cold start — confirms clean state)
  logApprovalStoreStatus();

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
    new GmailLeadMonitorAgent(),
  ];

  for (const agent of agents) {
    registerAgent(agent);
    dashboardBus.registerAgent(agent.config.id, agent.config.name);
    logger.info(`  Registered: ${agent.config.name} (${agent.config.commands.join(', ')})`);
  }

  // Initialize Workflow Engine AFTER all agents are registered
  // (engine calls getAgent() lazily at runtime — registry must be populated first)
  initWorkflowEngine();

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
        `/bulkoutreach [show] — Bulk push all leads for a show (creates campaign automatically)\n` +
        `/outreachstatus — Live Instantly campaign stats\n` +
        `/replies [show] — View and score recent replies\n` +
        `/campaigns — List all Instantly campaigns\n` +
        `/instantlyverify — Verify Instantly connection\n` +
        `/newcampaign [show] — Build full show campaign\n` +
        `/salesreplies — Handle campaign replies (sales loop)\n` +
        `/campaignstatus [show] — Campaign pipeline status\n` +
        `/indexinstantly — Index Instantly performance data to Knowledge Base\n` +
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
        `/systemstatus — Pending approvals, sessions, scheduler state\n` +
        `/checkemails — Scan inbox for new stand request emails\n` +
        `/emailstatus — Gmail lead monitor status\n` +
        `/help — Show this menu`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (text === '/help') {
      await bot.sendMessage(msg.chat.id,
        `*StandMe OS Help*\n\n` +
        `18 agents running. All actions require Mo's approval.\n` +
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

      let result = await handleApproval(approvalId, isApprove);

      // In-memory callback missing (most common cause: Railway redeploy between
      // the approval request and Mo's approval). For bulk outreach approvals,
      // we persisted the params to Knowledge Base — try to reconstruct and re-run.
      if (result === null && isApprove && approvalId.startsWith('bulkoutreach_')) {
        await bot.sendMessage(msg.chat.id, '⏳ Approval callback expired (server restarted). Reconstructing bulk push from saved params...', { parse_mode: 'Markdown' });
        result = await reconstructBulkApproval(approvalId).catch(() => null);
      }

      if (result === null) {
        // Still null — truly expired or unknown approval
        const hint = approvalId.startsWith('bulkoutreach_')
          ? ' Run `/bulkoutreach [show]` again to get a fresh approval request.'
          : '';
        await bot.sendMessage(msg.chat.id, `⚠️ Approval not found — it may have expired (24h limit) or the ID is incorrect.${hint}`, { parse_mode: 'Markdown' });
      } else {
        await bot.sendMessage(msg.chat.id, result, { parse_mode: 'Markdown' });
      }
      await writeSystemLog({
        agent: 'Brain',
        actionType: isApprove ? 'APPROVE' : 'REJECT',
        detail: approvalId,
        result: result === null ? 'FAIL' : 'SUCCESS',
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

  // Simple in-memory rate limiter for the Instantly webhook.
  // Prevents spam/abuse — max 60 requests per minute per IP.
  const webhookHits = new Map<string, number[]>();
  const WEBHOOK_RATE_MAX = 60;
  const WEBHOOK_RATE_WINDOW_MS = 60_000;

  // POST /webhook/instantly — receives reply/open/bounce events from Instantly.ai
  // Configure in Instantly: Settings → Integrations → Webhooks → point to this URL
  app.post('/webhook/instantly', async (req, res) => {
    // Rate limiting: reject if IP exceeds WEBHOOK_RATE_MAX requests in the window
    const ip  = (req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const now = Date.now();
    const hits = (webhookHits.get(ip) || []).filter(t => now - t < WEBHOOK_RATE_WINDOW_MS);
    hits.push(now);
    webhookHits.set(ip, hits);
    if (hits.length > WEBHOOK_RATE_MAX) {
      logger.warn(`[Webhook] Rate limit exceeded for ${ip} (${hits.length} req/min)`);
      res.sendStatus(429);
      return;
    }

    res.sendStatus(200);

    const secret = process.env.INSTANTLY_WEBHOOK_SECRET;
    if (secret && req.headers['x-instantly-secret'] !== secret) {
      logger.warn('[Webhook] Instantly: invalid secret, ignoring');
      return;
    }

    const body = req.body || {};
    // Instantly webhook payload shape: { event_type, campaign_id, lead_email, ... }
    const eventType   = (body.event_type || body.status || '').toUpperCase();
    const leadEmail   = (body.lead_email || body.email || '').toLowerCase();
    const campaignId  = body.campaign_id || '';

    logger.info(`[Webhook] Instantly: ${eventType} — ${leadEmail} (campaign: ${campaignId})`);
    dashboardBus.logEvent('agent-17', 'Campaign Builder', `Instantly webhook: ${eventType} — ${leadEmail}`);

    const campaignAgent = getAgent('/salesreplies');
    if (!campaignAgent) return;

    if (eventType === 'REPLY' || eventType === 'REPLIED') {
      const ctx = {
        userId:   'webhook',
        username: 'webhook',
        chatId:   parseInt(process.env.MO_TELEGRAM_ID || '0'),
        command:  'scheduled',
        args:     '',
        role:     UserRole.ADMIN,
        language: 'en' as const,
      };
      campaignAgent.run(ctx).catch((err: any) =>
        logger.warn(`[Webhook] Reply processing error: ${err.message}`)
      );
    } else if (['OPEN', 'OPENED', 'CLICK', 'CLICKED', 'BOUNCE', 'BOUNCED', 'UNSUBSCRIBE', 'UNSUBSCRIBED'].includes(eventType)) {
      (campaignAgent as any).handleWebhookEvent(eventType, leadEmail, campaignId)
        .catch((err: any) => logger.warn(`[Webhook] Event error: ${err.message}`));
    }
  });

  // Keep backward compat — old Woodpecker webhook URL redirects to Instantly handler
  app.post('/webhook/woodpecker', (req, res) => {
    logger.warn('[Webhook] Woodpecker endpoint hit — redirecting to Instantly handler');
    res.sendStatus(200);
  });

  // Health check endpoint for Railway
  app.get('/health', (_req, res) => res.json({ status: 'ok', agents: getAllAgents().length }));

  // Redirect root to dashboard
  app.get('/', (_req, res) => res.redirect('/dashboard'));

  const PORT = parseInt(process.env.PORT || '3000');
  const httpServer = createServer(app);
  initDashboardSocket(httpServer);
  httpServer.listen(PORT, () => {
    logger.info(`  Server on port ${PORT} — Dashboard: /dashboard | Webhook: /webhook/instantly`);
  });

  // Start scheduler
  startScheduler();

  // ── Railway keep-alive ─────────────────────────────────────────────────────
  // Ping our own /health endpoint every 4 minutes so Railway never marks the
  // service as idle and cuts WebSocket connections due to inactivity.
  const keepAliveUrl = `http://localhost:${PORT}/health`;
  setInterval(() => {
    fetch(keepAliveUrl).catch(() => { /* ignore — server is shutting down */ });
  }, 4 * 60 * 1000);

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
