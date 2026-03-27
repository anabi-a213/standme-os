import { Router, Request, Response } from 'express';
import path from 'path';
import express from 'express';
import { dashboardBus } from './event-bus';
import { getAllAgents, getAgent } from '../../agents/registry';
import { UserRole } from '../../config/access';
import { logger } from '../../utils/logger';
import { handleApproval } from '../approvals';
import { getAllBoardsSnapshot } from '../trello/client';

const router = Router();

// Auth middleware — must be first
router.use((req: Request, res: Response, next) => {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return next();
  if (req.cookies?.dash_auth === password) return next();
  if (req.query.key === password) {
    res.cookie('dash_auth', password, { httpOnly: true, maxAge: 86400000 });
    return next();
  }
  if (req.path.startsWith('/api')) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }
  // Show login page for non-API routes
  res.send(`<!DOCTYPE html><html><head><title>StandMe OS</title>
    <style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#e0e0e0}
    form{text-align:center}input{padding:12px 20px;font-size:16px;border:1px solid #333;border-radius:8px;background:#1a1a1a;color:#fff;margin:10px}
    button{padding:12px 24px;font-size:16px;border:none;border-radius:8px;background:#C9A84C;color:#000;cursor:pointer;font-weight:600}
    h1{font-size:24px;margin-bottom:20px;color:#C9A84C}</style></head>
    <body><form method="GET"><h1>STANDME OS</h1><input name="key" type="password" placeholder="Enter password" autofocus><br><button type="submit">Login</button></form></body></html>`);
});

// Serve React dashboard — no-cache on index.html so new deploys take effect immediately
router.get('/', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(process.cwd(), 'public', 'dashboard-build', 'index.html'));
});

// API: Agent statuses
router.get('/api/agents', (_req: Request, res: Response) => {
  res.json(dashboardBus.getStatuses());
});

// API: Recent logs
router.get('/api/logs', (_req: Request, res: Response) => {
  res.json(dashboardBus.getRecentLogs());
});

// API: System stats
router.get('/api/stats', (_req: Request, res: Response) => {
  res.json(dashboardBus.getSystemStats());
});

// API: Agent configs (commands, descriptions, schedules)
router.get('/api/agent-configs', (_req: Request, res: Response) => {
  const agents = getAllAgents();
  res.json(agents.map(a => ({
    id: a.config.id,
    name: a.config.name,
    description: a.config.description,
    commands: a.config.commands,
    schedule: a.config.schedule || null,
    requiredRole: a.config.requiredRole,
  })));
});

// API: All 5 Trello boards snapshot (cards with list names)
router.get('/api/boards', async (_req: Request, res: Response) => {
  try {
    const snapshot = await getAllBoardsSnapshot();
    res.json(snapshot);
  } catch (err: any) {
    logger.error(`[Dashboard] Boards snapshot error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// API: Trigger an agent command from the dashboard (async — fire and forget)
router.post('/api/trigger', async (req: Request, res: Response) => {
  const { command, args } = req.body || {};
  if (!command) {
    res.status(400).json({ error: 'command is required' });
    return;
  }

  const agent = getAgent(command);
  if (!agent) {
    res.status(404).json({ error: `No agent found for command: ${command}` });
    return;
  }

  logger.info(`[Dashboard] Triggering ${command} ${args || ''}`);

  // Run as admin from dashboard
  const ctx = {
    userId: 'dashboard',
    username: 'dashboard',
    chatId: parseInt(process.env.MO_TELEGRAM_ID || '0'),
    command,
    args: args || '',
    role: UserRole.ADMIN,
    language: 'en' as const,
  };

  // Run async — fire-and-forget (client should poll /api/logs for progress)
  agent.run(ctx).catch((err: any) =>
    logger.error(`[Dashboard] Trigger error for ${command}: ${err.message}`)
  );

  // Return async:true so client knows this is not a synchronous result.
  // Use /api/run instead if you need to wait for the result.
  res.json({ ok: true, async: true, agent: agent.config.name, command });
});

// API: Run agent synchronously — returns result
router.post('/api/run', async (req: Request, res: Response) => {
  const { command, args } = req.body || {};
  if (!command) { res.status(400).json({ error: 'command is required' }); return; }
  const agent = getAgent(command);
  if (!agent) { res.status(404).json({ error: `No agent found for: ${command}` }); return; }
  const ctx = {
    userId: 'dashboard',
    username: 'dashboard',
    chatId: parseInt(process.env.MO_TELEGRAM_ID || '0'),
    command,
    args: args || '',
    role: UserRole.ADMIN,
    language: 'en' as const,
  };
  try {
    const result = await agent.run(ctx);
    res.json({ ok: true, agent: agent.config.name, result: result.message, success: result.success });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// API: Approve or reject a pending action
router.post('/api/approve', async (req: Request, res: Response) => {
  const { approvalId, approved } = req.body || {};
  if (!approvalId) { res.status(400).json({ error: 'approvalId required' }); return; }
  try {
    const result = await handleApproval(approvalId, approved === true);
    if (result === null) {
      res.status(404).json({ ok: false, error: 'Approval not found or expired (24h limit)' });
      return;
    }
    res.json({ ok: true, result });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Serve React build static assets
router.use(express.static(path.join(process.cwd(), 'public', 'dashboard-build')));

// SPA catch-all — must be last (use '/{*path}' for path-to-regexp v8+)
router.get('/{*path}', (req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), 'public', 'dashboard-build', 'index.html'));
});

export { router as dashboardRouter };
