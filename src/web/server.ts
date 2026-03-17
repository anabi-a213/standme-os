import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import { registerAgent, getAgent, getAllAgents } from '../agents/registry';
import { startScheduler } from '../scheduler';
import { logger } from '../utils/logger';
import { canApprove, getUserRole, UserRole } from '../config/access';
import { AgentContext } from '../types/agent';
import { detectLanguage } from '../services/ai/client';

// Import all agents
import { LeadIntakeAgent } from '../agents/01-lead-intake.agent';
import { LeadEnrichmentAgent } from '../agents/02-lead-enrichment.agent';
import { ConceptBriefAgent } from '../agents/03-concept-brief.agent';
import { BrainAgent } from '../agents/04-brain.agent';
import { DeadlineMonitorAgent } from '../agents/05-deadline-monitor.agent';
import { ProjectStatusAgent } from '../agents/06-project-status.agent';
import { ClientReminderAgent } from '../agents/07-client-reminder.agent';
import { TechnicalDeadlineAgent } from '../agents/09-technical-deadline.agent';
import { ContractorCoordAgent } from '../agents/10-contractor-coord.agent';
import { LessonsLearnedAgent } from '../agents/11-lessons-learned.agent';
import { DealAnalyserAgent } from '../agents/12-deal-analyser.agent';
import { OutreachAgent } from '../agents/13-outreach.agent';
import { DriveIndexerAgent } from '../agents/14-drive-indexer.agent';
import { MarketingContentAgent } from '../agents/15-marketing-content.agent';
import { CrossBoardAgent } from '../agents/16-cross-board.agent';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', '..', 'public')));

// Message log for the web UI (simulates Telegram messages)
const messageLog: { role: 'user' | 'bot' | 'system'; text: string; timestamp: string }[] = [];

// Override Telegram bot functions for web mode
// We intercept what would normally go to Telegram and send it to the web UI instead
const webMessages: { to: string; text: string; timestamp: string }[] = [];

// Patch the bot module for web mode
import * as botModule from '../services/telegram/bot';

// Store original functions
const originalSendToMo = botModule.sendToMo;
const originalSendToTeam = botModule.sendToTeam;

// Override to capture messages for web UI
(botModule as any).sendToMo = async (message: string) => {
  webMessages.push({ to: 'Mo', text: message, timestamp: new Date().toISOString() });
  logger.info(`[Web] Message to Mo: ${message.substring(0, 100)}...`);
};

(botModule as any).sendToTeam = async (message: string, _userIds: string[]) => {
  webMessages.push({ to: 'Team', text: message, timestamp: new Date().toISOString() });
  logger.info(`[Web] Message to Team: ${message.substring(0, 100)}...`);
};

// Register agents
function initAgents() {
  const agents = [
    new LeadIntakeAgent(),
    new LeadEnrichmentAgent(),
    new ConceptBriefAgent(),
    new BrainAgent(),
    new DeadlineMonitorAgent(),
    new ProjectStatusAgent(),
    new ClientReminderAgent(),
    new TechnicalDeadlineAgent(),
    new ContractorCoordAgent(),
    new LessonsLearnedAgent(),
    new DealAnalyserAgent(),
    new OutreachAgent(),
    new DriveIndexerAgent(),
    new MarketingContentAgent(),
    new CrossBoardAgent(),
  ];

  for (const agent of agents) {
    registerAgent(agent);
    logger.info(`  Registered: ${agent.config.name}`);
  }

  return agents;
}

// API: Send a message
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }

  const timestamp = new Date().toISOString();
  messageLog.push({ role: 'user', text: message, timestamp });

  // Clear web messages buffer
  webMessages.length = 0;

  const text = message.trim();
  const parts = text.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');
  const language = await detectLanguage(text);

  // Build context (simulate Mo as admin)
  const ctx: AgentContext = {
    userId: process.env.MO_TELEGRAM_ID || '6140480367',
    username: 'Mo',
    chatId: 0, // web mode
    command,
    args,
    role: UserRole.ADMIN,
    language,
  };

  // Capture agent responses (override respond for web)
  const responses: string[] = [];

  try {
    // Handle /start and /help
    if (command === '/start' || command === '/help') {
      const helpText =
        `**StandMe OS** 🏗️\n\n` +
        `Welcome Mo. You're running in Web Test Mode.\n\n` +
        `**Commands:**\n` +
        `\`/newlead\` — Add a new lead\n` +
        `\`/enrich\` — Enrich pending leads\n` +
        `\`/brief [client]\` — Generate concept brief\n` +
        `\`/status\` — Pipeline dashboard\n` +
        `\`/deadlines\` — Check deadlines\n` +
        `\`/reminders\` — Client follow-ups\n` +
        `\`/techdeadlines\` — Technical deadlines\n` +
        `\`/outreach\` — Run outreach\n` +
        `\`/outreachstatus\` — Outreach stats\n` +
        `\`/contractors\` — List contractors\n` +
        `\`/addcontractor\` — Add contractor\n` +
        `\`/bookcontractor\` — Book contractor\n` +
        `\`/lesson\` — Record lessons learned\n` +
        `\`/dealanalysis\` — Deal analysis\n` +
        `\`/findfile\` — Search Drive\n` +
        `\`/indexdrive\` — Re-index Drive\n` +
        `\`/crossboard\` — Cross-board check\n` +
        `\`/post /caption /campaign\` — Marketing\n` +
        `\`/casestudy /portfolio /insight\` — Content\n` +
        `\`/contentplan\` — Weekly content plan\n` +
        `\`/ask [question]\` — Ask the Brain\n\n` +
        `Or just type a question naturally.`;

      messageLog.push({ role: 'bot', text: helpText, timestamp: new Date().toISOString() });
      return res.json({ response: helpText, notifications: [] });
    }

    // Handle approval commands
    if (command.startsWith('/approve_') || command.startsWith('/reject_')) {
      const isApprove = command.startsWith('/approve_');
      const responseText = isApprove ? '✅ Approved.' : '❌ Rejected.';
      messageLog.push({ role: 'bot', text: responseText, timestamp: new Date().toISOString() });
      return res.json({ response: responseText, notifications: [] });
    }

    // Find and run agent
    const agent = getAgent(command);

    if (agent) {
      // Patch the agent's respond method for web
      const originalRespond = agent.respond.bind(agent);
      agent.respond = async (_chatId: number, msg: string) => {
        responses.push(msg);
      };

      const result = await agent.run(ctx);

      // Restore
      agent.respond = originalRespond;

      const botResponse = responses.length > 0
        ? responses.join('\n\n')
        : result.message;

      messageLog.push({ role: 'bot', text: botResponse, timestamp: new Date().toISOString() });

      return res.json({
        response: botResponse,
        notifications: webMessages.map(m => ({ to: m.to, text: m.text })),
        agentResult: { success: result.success, confidence: result.confidence },
      });
    }

    // Route to Brain for natural language
    const brain = getAgent('/ask');
    if (brain) {
      ctx.args = text;
      ctx.command = '/ask';

      const originalRespond = brain.respond.bind(brain);
      brain.respond = async (_chatId: number, msg: string) => {
        responses.push(msg);
      };

      const result = await brain.run(ctx);
      brain.respond = originalRespond;

      const botResponse = responses.length > 0
        ? responses.join('\n\n')
        : result.message;

      messageLog.push({ role: 'bot', text: botResponse, timestamp: new Date().toISOString() });

      return res.json({
        response: botResponse,
        notifications: webMessages.map(m => ({ to: m.to, text: m.text })),
      });
    }

    const fallback = 'Unknown command. Type /help for available commands.';
    messageLog.push({ role: 'bot', text: fallback, timestamp: new Date().toISOString() });
    return res.json({ response: fallback, notifications: [] });

  } catch (err: any) {
    const errorMsg = `Error: ${err.message}`;
    messageLog.push({ role: 'bot', text: errorMsg, timestamp: new Date().toISOString() });
    return res.json({ response: errorMsg, notifications: webMessages.map(m => ({ to: m.to, text: m.text })) });
  }
});

// API: Get message history
app.get('/api/messages', (_req, res) => {
  res.json(messageLog.slice(-50));
});

// API: List available agents
app.get('/api/agents', (_req, res) => {
  const agents = getAllAgents().map(a => ({
    id: a.config.id,
    name: a.config.name,
    commands: a.config.commands,
    description: a.config.description,
    hasSchedule: !!a.config.schedule,
  }));
  res.json(agents);
});

// API: Get notifications (messages that would go to Telegram)
app.get('/api/notifications', (_req, res) => {
  res.json(webMessages);
});

// Start server
export function startWebServer() {
  initAgents();

  app.listen(PORT, () => {
    logger.info('========================================');
    logger.info('  StandMe OS — Web Test Mode');
    logger.info(`  http://localhost:${PORT}`);
    logger.info('  15 agents registered');
    logger.info('========================================');
  });
}

// Direct run
startWebServer();
