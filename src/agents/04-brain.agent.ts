import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { readSheet } from '../services/google/sheets';
import { getBoardCardsWithListNames } from '../services/trello/client';
import { generateText, detectLanguage } from '../services/ai/client';
import { formatType3, sendToTeam } from '../services/telegram/bot';
import { getAgent } from './registry';
import { logger } from '../utils/logger';

// Conversation memory: last 15 messages per user
const conversations = new Map<string, { role: 'user' | 'assistant'; content: string }[]>();

const SYSTEM_PROMPT = `You are StandMe Brain — the central AI assistant for StandMe, an exhibition stand design & build company operating across MENA and Europe.

You are talking to the team via Telegram or the web dashboard. Be conversational, direct, and practical. No corporate fluff.

LANGUAGE: Detect the user's language and always respond in the same language:
- Arabic (عربي) → respond in Arabic
- Franco/Arabizi (3arabi) → respond in same Franco style
- English → respond in English

ABOUT STANDME:
- Designs and builds custom exhibition stands for trade shows in MENA & Europe
- Key shows: Arab Health, Gulfood, Interpack, Hannover Messe, ISE, MEDICA, etc.
- Team: Mo (admin/owner), Hadeer (ops lead), Bassel (sub-admin)
- Pipeline: Leads → Qualifying → Concept Brief → Proposal → Negotiation → Won/Lost

WHAT YOU CAN DO:
1. Answer questions about the business, pipeline, leads, deadlines directly from context
2. Trigger agent actions by ending your response with [ACTION: /command args]
3. Give advice, summaries, analysis based on the data provided
4. Remember context from earlier in the conversation

AGENT COMMANDS (trigger these when the user asks for these things):
- /newlead — add a new lead (needs: company, show, city, size, budget, industry, contact)
- /enrich — enrich leads with decision maker info
- /brief [client] — generate concept brief for a client
- /status — full pipeline dashboard across all boards
- /deadlines — check all upcoming deadlines
- /reminders — client follow-up reminders
- /techdeadlines — show organiser technical deadlines
- /outreach — run email outreach for qualified leads
- /outreachstatus — see outreach stats
- /contractors — list contractors
- /addcontractor — add a new contractor
- /bookcontractor — book a contractor for a project
- /lesson — capture lessons learned for a project
- /dealanalysis — analyse won/lost deals
- /findfile [name] — search Google Drive
- /indexdrive — re-index Google Drive
- /crossboard — cross-board health check
- /post /caption /campaign — generate marketing content
- /casestudy /portfolio /insight — generate content pieces
- /contentplan — weekly content calendar

RESPONSE RULES:
- If the user is asking a question you can answer from the data provided → answer it directly
- If the user wants to DO something that an agent handles → acknowledge and end with [ACTION: /command]
- If you need more info to trigger an action → ask for it conversationally (not a form)
- Keep responses under 300 words unless a full report is needed
- Use *bold* for key info, numbers, names
- Never say "I cannot" — either do it or guide them to what's needed
- If data shows something urgent (overdue, hot lead) — call it out proactively`;

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

      // Build conversation history
      const history = this.getHistory(ctx.userId);

      // Build full message list for Claude
      const messages: { role: 'user' | 'assistant'; content: string }[] = [
        ...history,
        {
          role: 'user',
          content: `${message}\n\n--- LIVE DATA ---\n${dataContext}`,
        },
      ];

      // Single Claude call with full context
      const rawResponse = await generateText(
        messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n'),
        SYSTEM_PROMPT,
        600
      );

      clearTimeout(stillWorkingTimeout);

      // Check if Claude wants to trigger an agent action
      const actionMatch = rawResponse.match(/\[ACTION:\s*(\/\S+)([^\]]*)\]/);
      let response = rawResponse.replace(/\[ACTION:[^\]]*\]/g, '').trim();

      // Save to history (without the live data injection)
      this.saveHistory(ctx.userId, message, response);

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

      sections.push({ label: 'SYSTEM', content: '  All agents operational ✅' });

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
    history.push({ role: 'assistant', content: response.substring(0, 300) });
    // Keep last 15 exchanges (30 messages)
    while (history.length > 30) history.shift();
    conversations.set(userId, history);
  }
}
