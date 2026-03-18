import { Router, Request, Response } from 'express';
import path from 'path';
import { dashboardBus } from './event-bus';
import { getAllAgents, getAgent } from '../../agents/registry';
import { UserRole } from '../../config/access';
import { logger } from '../../utils/logger';

const router = Router();

// Dashboard password (set DASHBOARD_PASSWORD env var, defaults to none = open)
function checkAuth(req: Request, res: Response): boolean {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return true; // No password set = open access

  // Check session cookie
  if (req.cookies?.dash_auth === password) return true;

  // Check query param (for initial login)
  if (req.query.key === password) {
    res.cookie('dash_auth', password, { httpOnly: true, maxAge: 86400000 });
    return true;
  }

  return false;
}

// Serve dashboard HTML
router.get('/', (req: Request, res: Response) => {
  const password = process.env.DASHBOARD_PASSWORD;
  if (password && req.query.key !== password && !req.cookies?.dash_auth) {
    res.send(`<!DOCTYPE html><html><head><title>StandMe OS</title>
      <style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0f;color:#e0e0e0}
      form{text-align:center}input{padding:12px 20px;font-size:16px;border:1px solid #333;border-radius:8px;background:#1a1a2e;color:#fff;margin:10px}
      button{padding:12px 24px;font-size:16px;border:none;border-radius:8px;background:#6c5ce7;color:#fff;cursor:pointer}
      button:hover{background:#5a4bd1}h1{font-size:24px;margin-bottom:20px}</style></head>
      <body><form method="GET"><h1>StandMe OS Dashboard</h1><input name="key" type="password" placeholder="Enter password" autofocus><br><button type="submit">Login</button></form></body></html>`);
    return;
  }
  res.sendFile(path.join(__dirname, '../../../public/dashboard.html'));
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

// API: Trigger an agent command from the dashboard
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

  // Run async — don't block the response
  agent.run(ctx).catch((err: any) =>
    logger.error(`[Dashboard] Trigger error: ${err.message}`)
  );

  res.json({ ok: true, agent: agent.config.name, command });
});

export { router as dashboardRouter };
