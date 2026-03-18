import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { readSheet } from '../services/google/sheets';
import { getBoardCardsWithListNames } from '../services/trello/client';
import { generateText, generateChat, detectLanguage } from '../services/ai/client';
import { saveThreadEntry, setActiveFocus } from '../services/thread-context';
import { formatType3, sendToTeam } from '../services/telegram/bot';
import { buildKnowledgeContext } from '../services/knowledge';
import { getAgent } from './registry';
import { logger } from '../utils/logger';

// Conversation memory: last 15 messages per user
const conversations = new Map<string, { role: 'user' | 'assistant'; content: string }[]>();

const SYSTEM_PROMPT = `You are StandMe Brain — the central AI assistant for StandMe, an exhibition stand design & build company operating across MENA and Europe.

You talk to the team via Telegram and the web dashboard. Be conversational, direct, and practical. No filler.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LANGUAGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Always respond in the same language the user writes in:
- Arabic (عربي) → Arabic
- Franco/Arabizi (3arabi) → same Franco style
- English → English
Mix is fine — match the mix.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ABOUT STANDME
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Designs and builds custom exhibition stands for trade shows in MENA & Europe
- Key shows: Arab Health, Gulfood, Interpack, Hannover Messe, ISE, MEDICA, etc.
- Team: Mo (admin/owner), Hadeer (ops lead), Bassel (sub-admin)
- Pipeline: Leads → Qualifying → Concept Brief → Proposal → Negotiation → Won/Lost

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
UNDERSTANDING INTENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Before responding, identify:
1. WHAT the user wants (action vs question vs info)
2. WHO/WHAT they're talking about (which client, show, project?)
3. If anything is ambiguous — ask ONE focused clarifying question

Use THREAD CONTEXT (if provided) to resolve ambiguity:
- If the user says "do the brief" and the thread shows they were discussing "Pharma Corp" → trigger brief for Pharma Corp
- If the user says "move it to proposal" and the thread shows they were discussing a card → move that card
- Never ask for info you already know from thread context or live data

GOOD: "Got it — generating the brief for *Pharma Corp* at Arab Health. One sec."
BAD: "Could you please specify which client you'd like a brief for?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THREAD AWARENESS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You receive THREAD CONTEXT showing recent activity across all agents.
Use it to:
- Understand what the user has been working on
- Pick up where they left off without them re-explaining
- Catch if they're switching topics (acknowledge the switch)
- Avoid asking for info that was already given

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AGENT COMMANDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Trigger these by ending your response with [ACTION: /command args]:
- /newlead — add new lead (needs: company, show, city, size, budget, industry, contact)
- /enrich — enrich leads with decision maker info
- /brief [client] — generate concept brief
- /status — full pipeline dashboard
- /deadlines — upcoming deadlines
- /reminders — client follow-up reminders
- /techdeadlines — show organiser technical deadlines
- /outreach — email outreach for qualified leads
- /outreachstatus — outreach stats
- /contractors — list contractors
- /addcontractor — add contractor
- /bookcontractor — book contractor for a project
- /lesson — capture lessons learned
- /dealanalysis — analyse won/lost deals
- /findfile [name] — search Google Drive
- /indexdrive — re-index Google Drive
- /movecard [client] | [stage] — move pipeline card (e.g. [ACTION: /movecard Pharma Corp | 04 Proposal Sent])
- /crossboard — cross-board health check
- /post /caption /campaign /casestudy /portfolio /insight /contentplan — marketing content

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESPONSE RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Answer directly from live data or context when you can
- If user wants to DO something → acknowledge + trigger [ACTION: /command]
- If genuinely missing info → ask ONE clear question, not multiple
- Under 300 words unless full report needed
- *Bold* for key info, numbers, names
- Never say "I cannot" — either do it or guide them
- Proactively flag urgent items (overdue, hot lead, upcoming deadline)
- If a command was just run and you're the follow-up → tell the user what happened, don't repeat the action

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ENTITY TRACKING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When the user mentions a specific entity, include this at the END of your response (hidden from user):
[FOCUS: type=lead|project|show|contractor name=EntityName]

Examples:
- "let's work on Pharma Corp" → [FOCUS: type=lead name=Pharma Corp]
- "check Arab Health deadlines" → [FOCUS: type=show name=Arab Health]
- "book Ahmed for the Dubai project" → [FOCUS: type=contractor name=Ahmed]`;


export class BrainAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'StandMe Brain',
    id: 'agent-04',
    description: 'Central intelligence — answers any question, connects all agents',
    commands: ['/brain', '/ask'],
    schedule: '0 8 * * *',
    requiredRole: UserRole.OPS_LEAD,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    if (ctx.command === 'scheduled') {
      return this.morningBriefing(ctx);
    }

    const message = ctx.args || ctx.command;
    const lang = await detectLanguage(message);
    const ack = lang === 'ar' ? '...' : lang === 'franco' ? 'ثانية...' : '...';
    await this.respond(ctx.chatId, ack);

    const stillWorkingTimeout = setTimeout(async () => {
      await this.respond(ctx.chatId, lang === 'ar' ? 'لحظة ⏳' : 'Still on it ⏳');
    }, 12000);

    try {
      // Build live data snapshot for context
      const dataContext = await this.buildDataContext();

      // Pull relevant knowledge base entries for this message
      let knowledgeContext = '';
      try {
        knowledgeContext = await buildKnowledgeContext(message);
      } catch { /* silent */ }

      // Thread context (cross-agent activity) — already injected by BaseAgent.run()
      const threadContext = ctx.threadContext || '';

      // Build the enriched user message (data context appended to last user turn only)
      const enrichedUserMessage = [
        message,
        `\n--- LIVE DATA ---\n${dataContext}`,
        knowledgeContext ? `\n--- KNOWLEDGE BASE ---\n${knowledgeContext}` : '',
        threadContext ? `\n${threadContext}` : '',
      ].join('');

      // Build proper multi-turn message array for Claude
      const history = this.getHistory(ctx.userId);
      const chatMessages: { role: 'user' | 'assistant'; content: string }[] = [
        ...history,
        { role: 'user', content: enrichedUserMessage },
      ];

      // Call Claude with proper conversation history (not flattened string)
      const rawResponse = await generateChat(chatMessages, SYSTEM_PROMPT, 800);

      clearTimeout(stillWorkingTimeout);

      // Extract agent action trigger
      const actionMatch = rawResponse.match(/\[ACTION:\s*(\/\S+)([^\]]*)\]/);

      // Extract entity focus update (hidden from user)
      const focusMatch = rawResponse.match(/\[FOCUS:\s*type=(\w+)\s+name=([^\]]+)\]/);

      // Clean response — strip all meta tags before sending to user
      let response = rawResponse
        .replace(/\[ACTION:[^\]]*\]/g, '')
        .replace(/\[FOCUS:[^\]]*\]/g, '')
        .trim();

      // Update active focus if Brain identified one
      if (focusMatch) {
        const focusType = focusMatch[1].trim();
        const focusName = focusMatch[2].trim();
        setActiveFocus(ctx.userId, focusType, focusName);
      }

      // Save to per-user Brain conversation history (clean message, no data context)
      this.saveHistory(ctx.userId, message, response);

      // Also save to cross-agent thread context with entity info
      saveThreadEntry(
        ctx.userId,
        this.config.id,
        ctx.command,
        message,
        response,
        focusMatch ? { type: focusMatch[1].trim(), name: focusMatch[2].trim() } : undefined
      );

      await this.respond(ctx.chatId, response);

      // Trigger agent action if requested
      if (actionMatch) {
        const command = actionMatch[1].toLowerCase();
        const args = actionMatch[2].trim();
        const agent = getAgent(command);

        if (agent) {
          const actionCtx: AgentContext = { ...ctx, command, args };
          await agent.run(actionCtx);
        }
      }

      return { success: true, message: 'Brain responded', confidence: 'HIGH' };

    } catch (err: any) {
      clearTimeout(stillWorkingTimeout);
      const errMsg = lang === 'ar'
        ? `معلش، في مشكلة: ${err.message}`
        : `Couldn't complete that. ${err.message}`;
      await this.respond(ctx.chatId, errMsg);
      return { success: false, message: err.message, confidence: 'LOW' };
    }
  }

  private async buildDataContext(): Promise<string> {
    const lines: string[] = [];

    try {
      // Pipeline snapshot
      const salesBoardId = process.env.TRELLO_BOARD_SALES_PIPELINE || '';
      if (salesBoardId) {
        const cards = await getBoardCardsWithListNames(salesBoardId);
        const byStage = new Map<string, number>();
        const now = new Date();
        const overdue: string[] = [];

        for (const card of cards) {
          const stage = card.listName || 'Unknown';
          byStage.set(stage, (byStage.get(stage) || 0) + 1);
          if (card.due && new Date(card.due) < now) {
            overdue.push(`${card.name} (${stage})`);
          }
        }

        lines.push(`SALES PIPELINE (${cards.length} cards):`);
        for (const [stage, count] of byStage) {
          lines.push(`  ${stage}: ${count}`);
        }
        if (overdue.length > 0) {
          lines.push(`  OVERDUE: ${overdue.join(', ')}`);
        }
      }
    } catch { /* silent */ }

    try {
      // Recent leads
      const leads = await readSheet(SHEETS.LEAD_MASTER);
      const dataRows = leads.slice(1).filter(r => r[2]);
      if (dataRows.length > 0) {
        lines.push(`\nRECENT LEADS (${dataRows.length} total):`);
        dataRows.slice(-5).forEach(r => {
          lines.push(`  ${r[2] || '?'} | ${r[6] || 'no show'} | Score:${r[12] || '?'} | ${r[15] || '?'}`);
        });
      }
    } catch { /* silent */ }

    try {
      // Upcoming deadlines
      const deadlines = await readSheet(SHEETS.TECHNICAL_DEADLINES);
      const now = new Date();
      const upcoming = deadlines.slice(1).filter(r => {
        const dates = [r[3], r[4], r[5], r[6], r[7], r[8], r[9]].filter(Boolean);
        return dates.some(d => {
          const diff = (new Date(d).getTime() - now.getTime()) / 86400000;
          return diff >= 0 && diff <= 21;
        });
      });
      if (upcoming.length > 0) {
        lines.push(`\nDEADLINES IN NEXT 21 DAYS: ${upcoming.map(r => r[1]).join(', ')}`);
      }
    } catch { /* silent */ }

    return lines.length > 0 ? lines.join('\n') : 'No live data available.';
  }

  private async morningBriefing(ctx: AgentContext): Promise<AgentResponse> {
    const sections: { label: string; content: string }[] = [];

    try {
      const boardId = process.env.TRELLO_BOARD_SALES_PIPELINE || '';
      if (boardId) {
        const cards = await getBoardCardsWithListNames(boardId);
        const byStage = new Map<string, number>();
        const now = new Date();
        const overdue: string[] = [];

        for (const card of cards) {
          byStage.set(card.listName || 'Unknown', (byStage.get(card.listName || 'Unknown') || 0) + 1);
          if (card.due && new Date(card.due) < now) overdue.push(card.name);
        }

        if (overdue.length > 0) {
          sections.push({ label: 'URGENT', content: overdue.map(n => `  ⚠️ ${n}`).join('\n') });
        }

        sections.push({
          label: 'PIPELINE',
          content: Array.from(byStage.entries()).map(([s, c]) => `  ${s}: ${c}`).join('\n') || 'No cards',
        });
      }

      const leads = await readSheet(SHEETS.LEAD_MASTER);
      const hotLeads = leads.slice(1).filter(r => r[15] === 'HOT');
      if (hotLeads.length > 0) {
        sections.push({
          label: 'HOT LEADS — NEED APPROVAL',
          content: hotLeads.map(r => `  ${r[2]} — ${r[6]} (Score: ${r[12]})`).join('\n'),
        });
      }

      // Upcoming technical deadlines in the next 14 days
      try {
        const deadlines = await readSheet(SHEETS.TECHNICAL_DEADLINES);
        const now = new Date();
        const upcoming: string[] = [];
        for (const r of deadlines.slice(1)) {
          const show = r[1] || r[2] || '?';
          const dates = [
            { label: 'Portal', val: r[3] },
            { label: 'Rigging', val: r[4] },
            { label: 'Electrics', val: r[5] },
            { label: 'Design approval', val: r[6] },
            { label: 'Build start', val: r[7] },
          ];
          for (const { label, val } of dates) {
            if (!val) continue;
            const diff = (new Date(val).getTime() - now.getTime()) / 86400000;
            if (diff >= 0 && diff <= 14) {
              upcoming.push(`  ⏰ ${show} — ${label}: ${val} (${Math.round(diff)}d)`);
            }
          }
        }
        if (upcoming.length > 0) {
          sections.push({ label: 'DEADLINES THIS FORTNIGHT', content: upcoming.join('\n') });
        }
      } catch { /* non-fatal */ }

      // Pending outreach in queue
      try {
        const queue = await readSheet(SHEETS.OUTREACH_QUEUE);
        const pending = queue.slice(1).filter(r => (r[7] || '').toUpperCase() === 'PENDING');
        if (pending.length > 0) {
          sections.push({
            label: 'OUTREACH PENDING',
            content: pending.slice(0, 5).map(r => `  ${r[2] || '?'} — ${r[5] || 'no show'}`).join('\n') +
              (pending.length > 5 ? `\n  ...and ${pending.length - 5} more` : ''),
          });
        }
      } catch { /* non-fatal */ }

    } catch (err: any) {
      sections.push({ label: 'ERROR', content: `  ${err.message}` });
    }

    const briefing = formatType3('☀️ MORNING BRIEFING', sections);
    const recipients = [process.env.MO_TELEGRAM_ID || '', process.env.HADEER_TELEGRAM_ID || ''].filter(Boolean);
    await sendToTeam(briefing, recipients);

    return { success: true, message: 'Morning briefing sent', confidence: 'HIGH' };
  }

  private getHistory(userId: string): { role: 'user' | 'assistant'; content: string }[] {
    return conversations.get(userId) || [];
  }

  private saveHistory(userId: string, message: string, response: string): void {
    const history = this.getHistory(userId);
    history.push({ role: 'user', content: message });
    history.push({ role: 'assistant', content: response.substring(0, 500) });
    // Keep last 20 exchanges (40 messages)
    while (history.length > 40) history.shift();
    conversations.set(userId, history);
  }
}
