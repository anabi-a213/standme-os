import Anthropic from '@anthropic-ai/sdk';
import { getAllAgents, getAgent } from '../../agents/registry';
import { dashboardBus } from './event-bus';
import { UserRole } from '../../config/access';
import { logger } from '../../utils/logger';
import { searchKnowledge } from '../knowledge';

/** Fast env-var check — no API calls, no latency */
function getConnectionStatus(): string {
  const checks = [
    { name: 'Google Sheets', ok: !!(process.env.SPREADSHEET_ID || Object.keys(process.env).some(k => k.startsWith('SHEET_'))) },
    { name: 'Trello', ok: !!(process.env.TRELLO_API_KEY && process.env.TRELLO_TOKEN) },
    { name: 'Claude AI', ok: !!process.env.ANTHROPIC_API_KEY },
    { name: 'Telegram Bot', ok: !!process.env.TELEGRAM_BOT_TOKEN },
    { name: 'Google Auth', ok: !!(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS) },
    { name: 'Woodpecker', ok: !!process.env.WOODPECKER_API_KEY },
    { name: 'Google Drive', ok: !!(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || process.env.GOOGLE_SERVICE_ACCOUNT_KEY) },
  ];
  return checks.map(c => `  ${c.ok ? '✅' : '❌'} ${c.name}${c.ok ? '' : ' — NOT CONFIGURED'}`).join('\n');
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ChatSession {
  id: string;
  history: ChatMessage[];
  lastActivity: Date;
  language: 'ar' | 'en';
  userName: string;
}

const sessions = new Map<string, ChatSession>();
const MAX_HISTORY = 40;

export function getSession(sessionId: string): ChatSession {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      id: sessionId,
      history: [],
      lastActivity: new Date(),
      language: 'en',
      userName: 'Mo',
    });
  }
  const session = sessions.get(sessionId)!;
  session.lastActivity = new Date();
  return session;
}

function detectLanguage(text: string): 'ar' | 'en' {
  return /[\u0600-\u06FF]/.test(text) ? 'ar' : 'en';
}

function buildSystemPrompt(): string {
  const agents = getAllAgents();
  const agentList = agents.map(a =>
    `  • ${a.config.name} → ${a.config.commands.join(', ')}: ${a.config.description}`
  ).join('\n');

  const statuses = dashboardBus.getStatuses();
  const runningAgents = statuses.filter(s => s.state === 'running').map(s => s.name);
  const stats = dashboardBus.getSystemStats();

  return `You are the StandMe OS AI — the central intelligence of StandMe's entire operation. You are deeply embedded in the company's systems: you can see all 17 agents, trigger any of them, access the knowledge base, and coordinate complex workflows autonomously.

## WHO YOU ARE
You think like a seasoned exhibition industry operator. Strategic, analytical, and proactive. You anticipate what's needed before it's asked. You notice problems before they surface. You synthesize data into decisions, not just summaries.

## LANGUAGE
You speak Arabic and English with equal fluency. Respond in the exact same language the user writes in. If they switch languages mid-conversation, switch with them. Understand Franco-Arabic (3arabizy), typos, informal phrasing — never correct the user's writing, just understand their intent. If someone writes "sho sar bl leads?" you understand it's "what happened with the leads?"

## PERSONALITY
- Confident and direct — never hedge or say "I'm not sure"
- Proactive — don't just answer, add context, flag risks, suggest the next move
- Analytical — when data comes in, find the story and the implication
- Warm — like a brilliant senior colleague, not a customer service bot
- Decisive — give recommendations, not options lists

## CURRENT SYSTEM STATE
- Active agents: ${runningAgents.length > 0 ? runningAgents.join(', ') : 'none running'}
- Total runs today: ${stats.totalRuns}
- Total errors: ${stats.totalErrors}
- System uptime: since ${stats.uptimeSince}

## LIVE CONNECTION STATUS (checked right now)
${getConnectionStatus()}

⚠️ If a connection shows ❌ NOT CONFIGURED, be HONEST — tell the user that specific integration isn't set up yet, explain what env var they need to set in Railway, and suggest running /healthcheck for details. Do NOT simulate or pretend — real data only.

## YOUR 17 AGENTS — TRIGGER ANY BY INCLUDING [TRIGGER: /command args]
${agentList}

## HOW TO TRIGGER AGENTS
Include [TRIGGER: /command args] ANYWHERE in your response. Multiple triggers allowed.
Examples:
  [TRIGGER: /status] — full pipeline overview
  [TRIGGER: /deadlines] — upcoming show deadlines
  [TRIGGER: /brief Arab Health 2025] — generate concept brief
  [TRIGGER: /enrich] — enrich pending leads
  [TRIGGER: /dealanalysis] — win/loss patterns
  [TRIGGER: /outreachstatus] — campaign performance
  [TRIGGER: /crossboard] — sync check across Trello boards

WHEN TO AUTO-TRIGGER (do it proactively, explain what you're doing):
  • User asks about pipeline/deals/leads → trigger /status
  • User asks what's coming up → trigger /deadlines
  • User asks about a specific show → trigger /status + /deadlines
  • User says "how are we doing" → trigger /status + /dealanalysis
  • User mentions enriching contacts → trigger /enrich
  • User asks about outreach → trigger /outreachstatus
  • Complex requests → coordinate multiple agents in sequence

## STANDME BUSINESS CONTEXT
StandMe designs and builds custom exhibition stands for the MENA and European markets.

KEY SHOWS: Arab Health (Dubai, Jan), Gulfood (Dubai, Feb), Hannover Messe (Germany, Apr), ISE (Barcelona, Feb), MEDICA (Düsseldorf, Nov), Interpack (Düsseldorf, May), Big 5 (Dubai, Nov), Automechanika (Frankfurt, Sep)

STAND TIERS:
  • 9-18 sqm: €15,000-25,000 — smaller exhibitors, shell scheme replacement
  • 18-36 sqm: €25,000-45,000 — mid-size custom build, meeting area included
  • 36-72 sqm: €45,000-80,000 — flagship stands, full branding, AV, hospitality

TEAM: Mo (CEO / ADMIN), Bassel (Sub-Admin), Hadeer (Ops Lead)

DECISION MAKER PSYCHOLOGY BY INDUSTRY:
  • Pharma → Marketing Director, cares about regulatory-safe design, clean lines
  • Food & Bev → Brand Manager, wants experiential, product demonstration zones
  • Tech → CMO, wants innovation signals, interactive elements, demo areas
  • Automotive → Brand team, spectacle and scale matter, comparison vs competitors
  • Medical devices → Sales Director, meeting rooms critical, clinical feel

PIPELINE STAGES: Qualifying → Proposal → Approved → Design → Production → Build → Complete

## ADVANCED CAPABILITIES
1. Multi-agent coordination: trigger agents in sequence, compile results
2. Proactive risk detection: flag stalled deals, missed deadlines, data gaps
3. Report synthesis: turn raw agent output into actionable insight
4. Context memory: remember everything from this session, build on it
5. Mood detection: if user is stressed/urgent, respond with clarity and speed
6. Workflow planning: break complex requests into coordinated agent steps
7. Arabic/English bilingual with full comprehension of informal phrasing
8. Knowledge base integration: agents query it when they run
9. Pattern recognition: spot trends across pipeline, outreach, and lessons learned
10. Proactive suggestions: always offer the next logical step

## FORMATTING YOUR RESPONSES
- Use **bold** for key numbers, names, actions
- Use bullet points for lists, not long paragraphs
- Use > for important alerts or flags
- Keep it scannable — this is a business dashboard, not a document
- For Arabic responses, use the same formatting
- After agent results arrive, ALWAYS interpret them — don't just paste data

## CRITICAL RULE
You have real capabilities via agents — use them. BUT be honest about what's connected:
- If a connection shows ✅ → trigger the agent and get real data
- If a connection shows ❌ NOT CONFIGURED → tell the user exactly which env var is missing (e.g. "SPREADSHEET_ID isn't set in Railway — run /healthcheck or go to Railway → Variables")
- NEVER simulate data or pretend something worked when it didn't
- NEVER say "I apologize, I was simulating" — that's a sign past responses were wrong. Instead, report the current state clearly
- If the issue is that Sheets isn't configured → say "Google Sheets isn't set up yet. Set SPREADSHEET_ID in your Railway env vars. Once set, all agents will work automatically."`;

}

export type OnChunk = (text: string) => void;
export type OnAgentStart = (command: string) => void;
export type OnAgentDone = (command: string, result: string, success: boolean) => void;

export async function processChat(
  sessionId: string,
  userMessage: string,
  onChunk: OnChunk,
  onAgentStart: OnAgentStart,
  onAgentDone: OnAgentDone,
): Promise<void> {
  const session = getSession(sessionId);
  const lang = detectLanguage(userMessage);
  session.language = lang;

  // Add user message
  session.history.push({
    role: 'user',
    content: userMessage,
    timestamp: new Date().toISOString(),
  });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Pull relevant knowledge base entries (non-blocking — skip if Sheets not set up)
  let kbContext = '';
  try {
    const kbEntries = await searchKnowledge(userMessage, 3);
    if (kbEntries.length > 0) {
      kbContext = kbEntries.map(e => `[${e.topic}] ${e.content}`).join('\n');
    }
  } catch { /* silent — KB is optional context */ }

  // Build message history for Claude (keep last MAX_HISTORY)
  // Append knowledge base context to the current user message if found
  const enrichedUserMessage = kbContext
    ? `${userMessage}\n\n--- KNOWLEDGE BASE ---\n${kbContext}`
    : userMessage;

  const rawHistory = session.history.slice(-MAX_HISTORY);
  const messages = rawHistory.map((m, i) => ({
    role: m.role as 'user' | 'assistant',
    // Replace last user message with enriched version
    content: (m.role === 'user' && i === rawHistory.length - 1) ? enrichedUserMessage : m.content,
  }));

  // Stream response from Claude
  let fullResponse = '';

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      system: buildSystemPrompt(),
      messages,
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        const chunk = event.delta.text;
        fullResponse += chunk;
        onChunk(chunk);
      }
    }
  } catch (err: any) {
    logger.error(`[DashboardChat] Claude error: ${err.message}`);
    const errMsg = lang === 'ar'
      ? 'عذراً، حدث خطأ. حاول مرة ثانية.'
      : 'Sorry, something went wrong. Please try again.';
    onChunk(errMsg);
    fullResponse = errMsg;
  }

  // Parse and execute agent triggers from the full response
  let processedResponse = fullResponse;

  // Collect all triggers first (regex exec is stateful)
  const triggers: { full: string; command: string; args: string }[] = [];
  const patternCopy = /\[TRIGGER:\s*([^\]]+)\]/g;
  let m;
  while ((m = patternCopy.exec(fullResponse)) !== null) {
    const parts = m[1].trim().split(/\s+/);
    triggers.push({ full: m[0], command: parts[0], args: parts.slice(1).join(' ') });
  }

  // Execute each trigger
  for (const trigger of triggers) {
    onAgentStart(trigger.command);

    const agent = getAgent(trigger.command);
    if (!agent) {
      const msg = `❌ No agent found for ${trigger.command}`;
      processedResponse = processedResponse.replace(trigger.full, `\n\n${msg}\n`);
      onAgentDone(trigger.command, msg, false);
      continue;
    }

    try {
      const ctx = {
        userId: 'dashboard-ai',
        username: 'dashboard',
        chatId: parseInt(process.env.MO_TELEGRAM_ID || '0'),
        command: trigger.command,
        args: trigger.args,
        role: UserRole.ADMIN,
        language: lang as 'ar' | 'en',
      };

      const result = await agent.run(ctx);
      const resultText = result.message.substring(0, 1500);
      processedResponse = processedResponse.replace(trigger.full, `\n\n---\n**${agent.config.name} result:**\n${resultText}\n---\n`);
      onAgentDone(trigger.command, resultText, result.success);
    } catch (err: any) {
      const errText = `❌ ${trigger.command} failed: ${err.message}`;
      processedResponse = processedResponse.replace(trigger.full, `\n\n${errText}\n`);
      onAgentDone(trigger.command, errText, false);
    }
  }

  // Save final response to history
  session.history.push({
    role: 'assistant',
    content: processedResponse,
    timestamp: new Date().toISOString(),
  });

  // Trim history
  if (session.history.length > MAX_HISTORY * 2) {
    session.history = session.history.slice(-MAX_HISTORY);
  }
}

export function getSessionHistory(sessionId: string): ChatMessage[] {
  return getSession(sessionId).history;
}

export function clearSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export async function getWelcomeMessage(): Promise<string> {
  const stats = dashboardBus.getSystemStats();
  const agentCount = getAllAgents().length;

  return `👋 **StandMe OS AI** — ready.\n\n` +
    `I'm connected to all **${agentCount} agents**, your pipeline, Google Drive, Knowledge Base, and Trello boards.\n\n` +
    `**${stats.totalRuns}** agent runs since startup${stats.totalErrors > 0 ? ` · ⚠️ ${stats.totalErrors} errors` : ' · 0 errors'}.\n\n` +
    `Ask me anything — in Arabic or English. I can:\n` +
    `• Check your pipeline, leads, and deadlines\n` +
    `• Trigger any agent by understanding your intent\n` +
    `• Generate briefs, outreach, content\n` +
    `• Analyse your deals and surface patterns\n` +
    `• Coordinate multiple agents for complex tasks\n\n` +
    `What do you need?`;
}
