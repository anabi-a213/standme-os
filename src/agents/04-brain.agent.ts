import { BaseAgent } from './base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';
import { SHEETS } from '../config/sheets';
import { readSheet } from '../services/google/sheets';
import { getBoardCardsWithListNames } from '../services/trello/client';
import { generateText, generateChat, detectLanguage } from '../services/ai/client';
import { saveThreadEntry, setActiveFocus } from '../services/thread-context';
import { formatType3, sendToTeam } from '../services/telegram/bot';
import { buildKnowledgeContext, getKnowledgeStats, saveKnowledge } from '../services/knowledge';
import { getAgent } from './registry';
import { logger } from '../utils/logger';
import { getStaticKnowledge } from '../config/standme-knowledge';

// Conversation memory: last 15 messages per user
const conversations = new Map<string, { role: 'user' | 'assistant'; content: string }[]>();

function buildSystemPrompt(): string {
  return `You are StandMe Brain — the living intelligence of StandMe, a full-service exhibition stand design & build company operating across MENA and Europe.

You are talking to Mo (owner), Hadeer (ops lead), or Bassel (sub-admin) via Telegram or the web dashboard.

You are NOT a command interface. You are the company's senior advisor and operational brain — aware of the full pipeline, all active campaigns, pending leads, upcoming shows, and what needs attention. You think ahead, connect dots, and guide the team to the next best action without being asked.

INTELLIGENCE LEVEL: Act like a business partner who has been inside StandMe for 3 years. You know the team's habits, the show calendar, the typical lead-to-close timeline, and the pitfalls. You don't just respond to queries — you anticipate what the person needs and give them that plus one step further.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LANGUAGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Respond in the exact same language and style the user writes in:
- Arabic (عربي) → respond in Arabic
- Franco/Arabizi (3arabi) → respond in same Franco style
- English → respond in English
- Mixed → match the mix exactly

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STANDME COMPANY KNOWLEDGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${getStaticKnowledge(true)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HOW TO THINK AND RESPOND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Before every response, think through:
1. WHAT does the person actually want? (action / question / advice / strategic thinking / update)
2. WHO or WHAT are they talking about? (which client, show, contractor, project?)
3. Do I already know this from thread context or live data?
4. What's the BEST next step for the business — not just what was asked?
5. Is there something urgent they haven't noticed that I should flag?

RESOLVE WITH CONTEXT FIRST:
- If they say "do the brief" → check thread context for the active lead → do it for that lead
- If they say "move it" → check what card was last discussed → move that one
- If they say "the pharma guy" → check recent leads for a pharma company
- If they say "the show next month" → check upcoming deadlines/shows in live data
- NEVER ask for info you already know from context

GOOD: "On it — generating the brief for *Pharma Corp* at Arab Health."
BAD: "Could you please specify which client you'd like a brief for?"

If genuinely missing info → ask ONE specific question, not a list:
GOOD: "What size stand are they looking at?"
BAD: "Please provide the company name, show, size, budget, industry, and contact person."

WORKFLOW GUIDANCE MODE:
When someone mentions new leads, files, or show data, guide them through the FULL workflow:
1. Import → \`/importleads [show]\`
2. Outreach → \`/bulkoutreach [show]\` (creates campaign + sequence + pushes — all automatic)
3. Monitor → \`/replies [show]\` every few days
4. Qualify → \`/salesreplies\` when high-intent replies come in
5. Pipeline → \`/newlead\` + \`/enrich\` + \`/brief\` for hot leads

Don't just answer what was asked — walk them to the finish line.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THREAD & CONVERSATION AWARENESS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You receive THREAD CONTEXT — recent activity across ALL agents and commands.
Use it to:
- Pick up exactly where they left off, no re-explaining needed
- Connect dots across different commands ("you just ran /enrich on them — want me to queue outreach?")
- Notice if they switch topics and acknowledge it naturally
- Remember what was decided, approved, or flagged earlier in the session

You also have CONVERSATION HISTORY — your direct exchange with this person.
Use it to:
- Never repeat yourself or ask the same question twice
- Build on what was said — if they said the budget is €40k, don't ask the budget again
- Maintain a natural conversation flow

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXHIBITION INDUSTRY EXPERTISE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You know this industry deeply. When relevant, apply this knowledge proactively:

STAND ADVICE:
- 9-18sqm → entry level, €10-25k range. Good pipeline volume, lower margin.
- 18-36sqm → StandMe sweet spot. €25-60k. Qualify hard.
- 36-72sqm → major account. €60-120k. Mo should be involved.
- 72sqm+ → top tier. €120k+. Mo takes the call directly.
- Shell scheme = below our level. Don't pitch custom rates to shell scheme clients.
- Double-decker = complex, €100k+, needs structural approval. Ask upfront if they want 2 floors.

TIMELINE AWARENESS:
- 5-6 months to show = ideal, full options
- 3-4 months = normal, manageable
- <8 weeks = rush premium (15-25% uplift)
- <6 weeks = crisis — flag to Mo, special approval needed
- Production needs 3-4 weeks minimum regardless of anything else

DECISION MAKER INTELLIGENCE:
- Pharma/Medical → Marketing Director or Exhibition Manager
- Food/Bev → Brand Manager or Head of Trade Marketing
- Industrial → Marketing Manager or Head of Events
- AV/Tech → Marketing Director or Product Marketing
- Small business → CEO decides everything, don't waste time with procurement
- Large corp → marketing approves design, procurement handles price → engage marketing first

SHOW EXPERTISE (key shows):
- Arab Health (Jan, Dubai): Healthcare/pharma. Portal opens Sep. Build ~22-24 Jan.
- Gulfood (Feb, Dubai): Food/bev. Hospitality/tasting areas critical. Build ~19-21 Feb.
- Hannover Messe (Apr): Industrial. Most complex stands. Start 5-6 months minimum.
- Interpack (May, triennial): Packaging/pharma. Book 12-18 months out.
- MEDICA (Nov, Düsseldorf): World's biggest medical show. European launch show for Asian brands.
- ISE (Feb, Barcelona): AV/tech. Stands must demo the product. Design-forward.
- Intersolar (Jun, Munich): Solar/energy. Clean, tech aesthetics.
- SIAL Paris (Oct, biennial): Biggest food show. French aesthetics, fire safety strict.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AGENT COMMANDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⛔ STRICT COMMAND RULE: You may ONLY suggest commands from the exact list below.
NEVER invent, guess, or hallucinate a command that is not in this list.
If someone types a command that is not in this list (e.g. /woodpecker, /indexwoodpecker, /testlead), tell them clearly: "That command doesn't exist. Here are the real commands available: ..." — then show the relevant section below.
If you are unsure whether a command exists — it does NOT exist. Do not suggest it.

When the user wants an action, end your response with [ACTION: /command args]:
- /newlead — add new lead. EXACT FORMAT (pipe-separated, this order): CompanyName | ContactName | ContactEmail | ShowName | StandSizeSqm | Budget | Industry  (e.g. /newlead Solar GmbH | Hans Müller | hans@solar.de | Intersolar Munich 2025 | 36 | €50k | Solar/Energy)
- /enrich — enrich leads with decision maker info
- /brief [client] — generate concept brief for a client
- /status — full pipeline dashboard
- /deadlines — upcoming show organiser deadlines
- /reminders — client follow-up reminders
- /techdeadlines — technical deadline tracker
- /outreach — run outreach for qualified leads in OUTREACH_QUEUE (scored 6+), max 5 per run with individual approval
- /bulkoutreach [show name] — bulk push ALL leads for a show to Instantly in one batch. Creates campaign + email sequence automatically if none exists. One approval covers all leads. Example: /bulkoutreach intersolar
- /importleads [show name] — import exhibitor leads from Google Drive files (Excel/CSV/Google Sheets) into Lead Master. Run /bulkoutreach after. Example: /importleads gulfood
- /generateemails [show name] — AI-generates a 4-step email sequence AND creates the Instantly campaign automatically. Example: /generateemails intersolar
- /outreachstatus — live Instantly campaign stats (open rate, reply rate, bounces)
- /replies [show name] — show and AI-score recent replies by intent. Flags high-intent leads to Mo immediately.
- /campaigns — list all Instantly campaigns with status
- /instantlyverify — verify Instantly API connection, inboxes, and daily send capacity
- /discover [show name] — scan exhibitor files from Drive, find contacts, build Instantly campaign
- /newcampaign [show name] — generate personalised emails for existing pipeline leads and launch Instantly campaign
- /salesreplies — process Instantly replies and advance deals through the sales loop
- /campaignstatus [show name] — full Instantly + pipeline view for a show
- /indexinstantly — sync Instantly campaign performance data to Knowledge Base (improves future email writing)
- /indexgmail [days] — scan all Instantly-connected inboxes + save email intelligence to Knowledge Base. Default: last 90 days.
- /contractors — list available contractors
- /addcontractor — add new contractor to database
- /bookcontractor — book a contractor for a project
- /lesson — capture post-project lessons learned
- /dealanalysis — won/lost deal patterns analysis
- /findfile [name] — search Google Drive
- /indexdrive — re-index Google Drive
- /movecard [client] | [stage] — move pipeline card (e.g. /movecard Pharma Corp | 04 Proposal Sent)
- /crossboard — cross-board health check across all Trello boards
- /post /caption /campaign /casestudy /portfolio /insight /contentplan — marketing content
- /healthcheck — test all connected services (Trello, Sheets, Claude, Telegram)
- /sheetssetup — check Google Sheets status + auto-create any missing tabs

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROACTIVE INTELLIGENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Don't just answer — anticipate the next step. Always give 1-2 concrete next actions:

- Lead score 6+ with no brief? → Suggest /brief
- Lead in Qualifying with show <90 days? → Flag urgency immediately
- Card stuck 14+ days? → Flag it, suggest action
- Show <30 days with no build start? → Escalate to Mo
- Portal deadline <2 weeks? → Remind and ask if submitted
- Multiple shows overlapping? → Flag contractor availability risk
- After /enrich succeeds → "Want me to queue them for outreach with /bulkoutreach?"
- After /brief runs → "Should I move them to 03 Concept Brief stage?"
- After a deal is Won → "Want to capture lessons learned now?"
- After /importleads → automatically suggest /bulkoutreach
- After /bulkoutreach → suggest checking /replies in 3-4 days
- After /replies shows high-intent → flag leads for immediate follow-up

OUTREACH SYSTEM (Instantly.ai):
- All outreach now runs via Instantly.ai — full API control, no manual UI work
- /bulkoutreach [show] → creates campaign, writes emails, pushes leads, activates — everything automatic
- /replies [show] → shows replies scored by AI intent. High-intent = alert Mo immediately
- /outreachstatus → live stats (open rate, reply rate, bounce health)
- Sender health: bounce rate <3% is healthy. Alert Mo if >3%.
- Daily capacity: depends on number of Instantly inboxes configured (50-100 per inbox/day)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESPONSE STYLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Direct and confident — you're a senior advisor, not a chatbot
- *Bold* for key numbers, names, and urgency items
- Under 300 words unless a full report is genuinely needed
- Never say "I cannot" — either do it, guide them to it, or tell them why it can't be done
- Proactively flag urgent items even if not asked
- When live data shows something concerning — say it
- If a command just ran — tell them the result, don't repeat the action

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ENTITY TRACKING (hidden tag)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When a specific entity is mentioned, add at the END of your response (not shown to user):
[FOCUS: type=lead|project|show|contractor name=EntityName]

Examples:
- "let's work on Pharma Corp" → [FOCUS: type=lead name=Pharma Corp]
- "Arab Health deadlines" → [FOCUS: type=show name=Arab Health]
- "book Ahmed" → [FOCUS: type=contractor name=Ahmed]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONVERSATION-TO-ACTION BRIDGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When the user describes something in natural language that maps to a system action, OFFER TO EXECUTE IT IMMEDIATELY — don't just explain what to do:

- "We got a new inquiry from [company]..." → Fill in what you know and say "I have everything needed — adding them as a lead now." then [ACTION: /newlead Company | Contact | email | Show | size | budget | industry]
- "They accepted the proposal / we won the deal" → [ACTION: /movecard CompanyName | 06 Won]
- "They went silent / lost it" → [ACTION: /movecard CompanyName | 07 Lost-Delayed]
- "Brief them" / "do the brief for them" → [ACTION: /brief CompanyName]
- "Follow up with them" → Write the exact follow-up message for Mo to copy-paste. Don't say "you should follow up." Write the actual email/message.
- "What's the status?" → Give a synthesized answer with €values and risk flags, not raw stage counts.

BRIDGE RULE: If you have 80%+ of the data needed to run a command — DO IT. Don't ask for confirmation unless you have less than that.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BUDGET & DEAL INTELLIGENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Track and apply financial intelligence across conversations:

BUDGET SIGNALS:
- If a budget is mentioned → note if it's realistic for the stand size (18sqm + €15k = red flag: too low)
- If budget dropped from previous mention → flag: "Last time you mentioned €50k — now €35k. Has something changed?"
- If no budget given for 36sqm+ → ask once: "What's their budget range? This affects whether we proceed."

PIPELINE VALUE AWARENESS:
- Qualifying: typically €25-60k leads. Worth pursuing if show >8 weeks away.
- Proposal Sent: committed budget. Flag if >7 days no response.
- Negotiation: close to Won. Mo should be personally engaged.
- Total pipeline = sum estimate. Surface this proactively.

DEAL VELOCITY:
- <7 days in stage = healthy
- 8-14 days in stage = needs a nudge
- 15-21 days in stage = at risk of going cold — flag it
- >21 days in stage = stalled — escalate to Mo

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FOLLOW-UP TIMING INTELLIGENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When follow-up is needed, give a SPECIFIC DATE and SPECIFIC MESSAGE — not generic advice:

TIMING RULES:
- After sending a proposal → follow up day 5-7 ("Just checking you had a chance to review...")
- After day 14 with no response → urgent follow-up ("We're finalizing our production schedule...")
- After a meeting/call → follow up within 48 hours ("Great speaking with you — attached the summary...")
- After a site visit → follow up same day ("Thanks for showing us the space — here's our initial thinking...")
- Cold lead (>21 days silent) → re-engage with new angle ("Intersolar is 6 weeks away — still looking for a stand partner?")

FORMAT: When suggesting follow-up, write the actual message text for Mo to use — not instructions.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PERSONALIZATION ENGINE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Use Knowledge Base entries and conversation history to personalize everything:

- If you know their budget → give advice calibrated to that exact budget
- If you know the DM's name → use it: "Send Hans a direct message, not email — he responds faster"
- If you know their show history → reference it: "They did 36sqm at MEDICA — pitch 40sqm for Arab Health"
- If you know a preference → apply it: "They prefer modular designs — lead with that"
- If a competitor was mentioned → flag it: "FairMax is likely pitching this too — differentiate on [reason]"
- If you see a pattern across multiple leads → surface it: "3 of your Gulfood leads are food-tech — same buyer persona, similar pitch"

MEMORY RULE: You remember everything said in this session AND everything saved to the Knowledge Base from past sessions. Use both.`;
}


export class BrainAgent extends BaseAgent {
  config: AgentConfig = {
    name: 'StandMe Brain',
    id: 'agent-04',
    description: 'Central intelligence — answers any question, connects all agents',
    commands: ['/brain', '/ask', '/seedknowledge', '/kbstats', '/healthcheck', '/sheetssetup'],
    schedule: '0 8 * * *',
    requiredRole: UserRole.OPS_LEAD,
  };

  async execute(ctx: AgentContext): Promise<AgentResponse> {
    if (ctx.command === 'scheduled') {
      return this.morningBriefing(ctx);
    }

    // Admin command: seed knowledge base from curated standme-knowledge.ts
    if (ctx.command === '/seedknowledge') {
      return this.seedKnowledgeBase(ctx);
    }

    // Health check: test all connected services and report status
    if (ctx.command === '/healthcheck') {
      return this.runHealthCheck(ctx);
    }

    // Sheets setup: show Google Sheets status + auto-create missing tabs
    if (ctx.command === '/sheetssetup') {
      return this.runSheetsSetup(ctx);
    }

    // Knowledge base stats: entry count, types, recent entries
    if (ctx.command === '/kbstats') {
      return this.showKbStats(ctx);
    }

    const message = ctx.args || ctx.command;

    // Approval/rejection commands are handled upstream:
    // - Telegram: caught by index.ts handler before Brain is called
    // - Dashboard: caught by chat-service.ts processChat() before Brain is called
    // If the Brain somehow still receives one, return a neutral fallback rather
    // than hallucinating a fake approval response.
    if (/^\/(approve|reject)_/i.test(message.trim())) {
      await this.respond(ctx.chatId,
        '⚠️ This is a system approval command — it should have been handled automatically. ' +
        'If you see this message, please try again. If the approval expired, run the original command ' +
        '(e.g. `/bulkoutreach intersolar`) to get a fresh approval request.'
      );
      return { success: false, message: 'Approval command reached Brain — should have been intercepted earlier', confidence: 'HIGH' };
    }

    const lang = await detectLanguage(message);
    const ack = lang === 'ar' ? '...' : lang === 'franco' ? 'ثانية...' : '...';
    await this.respond(ctx.chatId, ack);

    const stillWorkingTimeout = setTimeout(async () => {
      await this.respond(ctx.chatId, lang === 'ar' ? 'لحظة ⏳' : 'Still on it ⏳');
    }, 12000);

    try {
      // Build live data snapshot for context (max 8s — don't let slow APIs hang the bot)
      let dataTimedOut = false;
      const { data: dataContext, issues: dataIssues } = await Promise.race([
        this.buildDataContext(),
        new Promise<{ data: string; issues: string[] }>(resolve => setTimeout(() => {
          dataTimedOut = true;
          resolve({ data: 'No live data available.', issues: [] });
        }, 8000)),
      ]);

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
      const rawResponse = await generateChat(chatMessages, buildSystemPrompt(), 800);

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

      // Non-blocking: learn from this interaction and save business insights to KB
      this.detectAndSaveInsights(ctx.userId, message, response).catch(() => { /* silent */ });

      // Report any data source issues to Mo as a separate diagnostic message
      const allIssues: string[] = [...dataIssues];
      if (dataTimedOut) allIssues.push('Live data timed out (>8s) — Trello/Sheets may be slow');
      if (allIssues.length > 0) {
        const { sendToMo } = await import('../services/telegram/bot');
        await sendToMo(
          `⚠️ *Data source issues detected*\n\n${allIssues.map(i => `• ${i}`).join('\n')}\n\n_Your response was sent using cached/partial data._`,
          'Markdown'
        );
      }

      // Trigger agent action if requested
      // IMPORTANT: Heavy/long-running commands are blocked from auto-triggering.
      // The Brain AI may recommend these but must never execute them automatically —
      // they must only run when the user explicitly types the command.
      const BRAIN_BLOCKED_COMMANDS = new Set([
        '/indexdrive',
        '/reindexdrive',
        '/newcampaign',
        '/discover',
        '/outreach',
        '/bulkoutreach', // heavy bulk operation — must only run on explicit user command
        '/importleads',  // heavy Drive + Sheets import — must only run on explicit user command
      ]);

      if (actionMatch) {
        const command = actionMatch[1].toLowerCase();
        const args = actionMatch[2].trim();

        if (BRAIN_BLOCKED_COMMANDS.has(command)) {
          // Log the blocked auto-trigger but do NOT execute it
          logger.warn(`[Brain] Blocked auto-trigger of heavy command: ${command}`);
        } else {
          const agent = getAgent(command);
          if (agent) {
            const actionCtx: AgentContext = { ...ctx, command, args };
            await agent.run(actionCtx);
          }
        }
      }

      return { success: true, message: 'Brain responded', confidence: 'HIGH' };

    } catch (err: any) {
      clearTimeout(stillWorkingTimeout);

      // Tell the user what happened
      const errMsg = lang === 'ar'
        ? `معلش، في مشكلة: ${err.message}`
        : `Something went wrong and I couldn't complete that.\n\n*Error:* ${err.message}`;
      await this.respond(ctx.chatId, errMsg);

      // Also ping Mo directly if it wasn't already their own chat that got the error
      try {
        const { sendToMo } = await import('../services/telegram/bot');
        const moId = process.env.MO_TELEGRAM_ID || '6140480367';
        if (ctx.chatId.toString() !== moId) {
          await sendToMo(
            `🔴 *Brain agent crashed*\n\nUser: ${ctx.username || ctx.userId}\nMessage: _${message.slice(0, 200)}_\n\nError: \`${err.message}\``,
            'Markdown'
          );
        }
      } catch { /* don't recurse */ }

      return { success: false, message: err.message, confidence: 'LOW' };
    }
  }

  private async buildDataContext(): Promise<{ data: string; issues: string[] }> {
    const lines: string[] = [];
    const issues: string[] = [];

    try {
      // Pipeline snapshot
      const salesBoardId = process.env.TRELLO_BOARD_SALES_PIPELINE || '';
      if (salesBoardId) {
        const cards = await getBoardCardsWithListNames(salesBoardId);
        const byStage = new Map<string, number>();
        const now = new Date();
        const overdue: string[] = [];
        const stalledDeals: string[] = [];   // Proposal/Negotiation > 21 days inactive
        const coldQualifying: string[] = []; // Qualifying > 14 days inactive

        for (const card of cards) {
          const stage = card.listName || 'Unknown';
          byStage.set(stage, (byStage.get(stage) || 0) + 1);
          if (card.due && new Date(card.due) < now) {
            overdue.push(`${card.name} (${stage})`);
          }

          // Velocity tracking via dateLastActivity
          const lastActivity = (card as any).dateLastActivity
            ? new Date((card as any).dateLastActivity)
            : null;
          if (lastActivity) {
            const daysInactive = (now.getTime() - lastActivity.getTime()) / 86400000;
            if (daysInactive > 21 && (stage.toLowerCase().includes('proposal') || stage.toLowerCase().includes('negotiation'))) {
              stalledDeals.push(`${card.name} (${Math.round(daysInactive)}d stalled)`);
            } else if (daysInactive > 14 && stage.toLowerCase().includes('qualifying')) {
              coldQualifying.push(`${card.name} (${Math.round(daysInactive)}d)`);
            }
          }
        }

        lines.push(`SALES PIPELINE (${cards.length} cards):`);
        for (const [stage, count] of byStage) {
          lines.push(`  ${stage}: ${count}`);
        }
        if (overdue.length > 0) lines.push(`  OVERDUE: ${overdue.join(', ')}`);
        if (stalledDeals.length > 0) lines.push(`  ⚠️ STALLED (>21d): ${stalledDeals.join(', ')}`);
        if (coldQualifying.length > 0) lines.push(`  🥶 COLD QUALIFYING (>14d): ${coldQualifying.join(', ')}`);
      }
    } catch (err: any) {
      issues.push(`Trello: ${err.message}`);
    }

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
    } catch (err: any) {
      issues.push(`Leads sheet: ${err.message}`);
    }

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
    } catch (err: any) {
      issues.push(`Deadlines sheet: ${err.message}`);
    }

    return {
      data: lines.length > 0 ? lines.join('\n') : 'No live data available.',
      issues,
    };
  }

  private async runHealthCheck(ctx: AgentContext): Promise<AgentResponse> {
    await this.respond(ctx.chatId, '🔍 Checking all services...');

    const checks: { name: string; ok: boolean; detail: string }[] = [];

    // Trello
    try {
      const salesBoardId = process.env.TRELLO_BOARD_SALES_PIPELINE || '';
      if (salesBoardId) {
        const cards = await getBoardCardsWithListNames(salesBoardId);
        checks.push({ name: 'Trello Sales Board', ok: true, detail: `${cards.length} cards` });
      } else {
        checks.push({ name: 'Trello Sales Board', ok: false, detail: 'TRELLO_BOARD_SALES_PIPELINE not set' });
      }
    } catch (err: any) {
      checks.push({ name: 'Trello Sales Board', ok: false, detail: err.message });
    }

    // Google Sheets
    try {
      const leads = await readSheet(SHEETS.LEAD_MASTER);
      checks.push({ name: 'Google Sheets (Leads)', ok: true, detail: `${leads.length - 1} rows` });
    } catch (err: any) {
      checks.push({ name: 'Google Sheets (Leads)', ok: false, detail: err.message });
    }

    // Claude AI
    try {
      const ping = await generateText('Reply with exactly: OK', undefined, 10);
      checks.push({ name: 'Claude AI', ok: ping.includes('OK'), detail: ping.includes('OK') ? 'responding' : `unexpected: ${ping.slice(0, 50)}` });
    } catch (err: any) {
      checks.push({ name: 'Claude AI', ok: false, detail: err.message });
    }

    // Key env vars
    const requiredEnvs = [
      'TELEGRAM_BOT_TOKEN', 'ANTHROPIC_API_KEY',
      'TRELLO_API_KEY', 'TRELLO_TOKEN',
      'SPREADSHEET_ID',
    ];
    const missingEnvs = requiredEnvs.filter(k => !process.env[k]);
    checks.push({
      name: 'Env vars (core)',
      ok: missingEnvs.length === 0,
      detail: missingEnvs.length === 0 ? 'all set' : `MISSING: ${missingEnvs.join(', ')}`,
    });

    // Instantly API
    const hasInstantly = !!process.env.INSTANTLY_API_KEY;
    checks.push({
      name: 'Instantly.ai (outreach)',
      ok: hasInstantly,
      detail: hasInstantly ? 'INSTANTLY_API_KEY set ✓' : 'MISSING: INSTANTLY_API_KEY — add in Railway env to enable outreach',
    });

    // Google Auth — system uses OAuth2 (CLIENT_ID + CLIENT_SECRET + REFRESH_TOKEN)
    const hasOAuth = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
    checks.push({
      name: 'Google Auth (OAuth2)',
      ok: hasOAuth,
      detail: hasOAuth ? 'OAuth2 configured ✓' : 'MISSING: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN',
    });

    const allOk = checks.every(c => c.ok);
    const lines = checks.map(c => `${c.ok ? '✅' : '❌'} *${c.name}*: ${c.detail}`);
    const summary = allOk ? '✅ All systems operational' : `⚠️ ${checks.filter(c => !c.ok).length} issue(s) found`;

    await this.respond(ctx.chatId, `${summary}\n\n${lines.join('\n')}`);
    return { success: true, message: 'Health check complete', confidence: 'HIGH' };
  }

  private async runSheetsSetup(ctx: AgentContext): Promise<AgentResponse> {
    await this.respond(ctx.chatId, '📊 Checking Google Sheets setup...');
    try {
      const { initSheets, getSheetsStatus } = await import('../services/google/sheets-init');
      // Re-run init to create any missing tabs
      await initSheets();
      // Then return the status
      const status = await getSheetsStatus();
      await this.respond(ctx.chatId, status);
      return { success: true, message: 'Sheets setup complete', confidence: 'HIGH' };
    } catch (err: any) {
      const msg = `❌ Sheets setup failed: ${err.message}\n\nMake sure:\n1. SPREADSHEET_ID is set in Railway env vars\n2. GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN are all set\n3. The spreadsheet is accessible by your Google account`;
      await this.respond(ctx.chatId, msg);
      return { success: false, message: err.message, confidence: 'HIGH' };
    }
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
        const pending = queue.slice(1).filter(r => (r[7] || '').toUpperCase() === 'READY');
        if (pending.length > 0) {
          sections.push({
            label: 'OUTREACH PENDING',
            content: pending.slice(0, 5).map(r => `  ${r[2] || '?'} — ${r[5] || 'no show'}`).join('\n') +
              (pending.length > 5 ? `\n  ...and ${pending.length - 5} more` : ''),
          });
        }
      } catch { /* non-fatal */ }

      // Contractor availability: flag recently booked contractors (potential overlap risk)
      try {
        const contractors = await readSheet(SHEETS.CONTRACTOR_DB);
        const now = new Date();
        const recentlyBooked = contractors.slice(1).filter(r => {
          const lastBooked = r[8]; // col I = lastBooked
          if (!lastBooked) return false;
          const daysSince = (now.getTime() - new Date(lastBooked).getTime()) / 86400000;
          return daysSince >= 0 && daysSince <= 60; // booked within last 60 days
        });
        if (recentlyBooked.length >= 3) {
          sections.push({
            label: '⚠️ CONTRACTOR CAPACITY NOTE',
            content: `  ${recentlyBooked.length} contractors booked in the last 60 days.\n` +
              recentlyBooked.slice(0, 5).map(r => `  • ${r[1] || '?'} (${r[3] || 'unknown specialty'}) — last booked: ${r[8]}`).join('\n') +
              '\n  Check availability before committing to new project timelines.',
          });
        }
      } catch { /* non-fatal — CONTRACTOR_DB sheet may not be set up */ }

    } catch (err: any) {
      sections.push({ label: 'ERROR', content: `  ${err.message}` });
    }

    // AI-synthesized deal coaching — runs after all data is collected
    try {
      if (sections.length > 0) {
        const pipelineSnapshot = sections.map(s => `${s.label}:\n${s.content}`).join('\n\n');
        const coaching = await generateText(
          `You are Mo's deal coach for StandMe (exhibition stand design & build company, MENA + Europe).\n` +
          `Based on this morning pipeline snapshot, give 2-3 SPECIFIC and ACTIONABLE recommendations for today.\n` +
          `Be direct, specific — name actual companies/deals where possible, no generic advice.\n` +
          `Format as bullet points. Max 120 words.\n\n${pipelineSnapshot}`,
          undefined,
          200
        );
        if (coaching && coaching.trim()) {
          sections.push({ label: '🎯 DEAL COACHING', content: coaching.trim() });
        }
      }
    } catch { /* non-fatal */ }

    const briefing = formatType3('☀️ MORNING BRIEFING', sections);
    const recipients = [process.env.MO_TELEGRAM_ID || '', process.env.HADEER_TELEGRAM_ID || ''].filter(Boolean);
    await sendToTeam(briefing, recipients);

    return { success: true, message: 'Morning briefing sent', confidence: 'HIGH' };
  }

  private async showKbStats(ctx: AgentContext): Promise<AgentResponse> {
    try {
      const stats = await getKnowledgeStats();

      if (stats.total === 0) {
        await this.respond(ctx.chatId, '📭 Knowledge base is empty. Run /indexdrive to populate it.');
        return { success: true, message: 'KB empty', confidence: 'HIGH' };
      }

      // Type breakdown sorted by count
      const typeBreakdown = Object.entries(stats.byType)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `  ${type}: *${count}*`)
        .join('\n');

      // 5 most recent — show topic + snippet
      const recentLines = stats.recent.map(e => {
        const snippet = (e.content || '').slice(0, 70);
        return `  • [${e.sourceType}] *${e.topic}* — ${snippet}${e.content.length > 70 ? '...' : ''}`;
      }).join('\n');

      const msg =
        `*📊 Knowledge Base*\n\n` +
        `Total entries: *${stats.total}*\n\n` +
        `*By source:*\n${typeBreakdown}\n\n` +
        `*5 most recent:*\n${recentLines}\n\n` +
        `_Use /knowledge [term] to search • /indexdrive to add new files_`;

      await this.respond(ctx.chatId, msg);
      return { success: true, message: `KB stats: ${stats.total} entries`, confidence: 'HIGH' };
    } catch (err: any) {
      await this.respond(ctx.chatId, `Failed to read KB stats: ${err.message}`);
      return { success: false, message: err.message, confidence: 'LOW' };
    }
  }

  private async seedKnowledgeBase(ctx: AgentContext): Promise<AgentResponse> {
    if (ctx.role !== 'ADMIN' as any) {
      await this.respond(ctx.chatId, 'Admin only.');
      return { success: false, message: 'Unauthorised', confidence: 'HIGH' };
    }

    const { saveKnowledge, searchKnowledge } = await import('../services/knowledge');
    const { KNOWLEDGE_SEED } = await import('../config/standme-knowledge');

    await this.respond(ctx.chatId, `Seeding knowledge base with ${KNOWLEDGE_SEED.length} entries...`);

    let added = 0;
    let skipped = 0;

    for (const entry of KNOWLEDGE_SEED) {
      try {
        const existing = await searchKnowledge(entry.source, 1);
        if (existing.some((e: any) => e.source === entry.source)) {
          skipped++;
          continue;
        }
        await saveKnowledge(entry);
        added++;
        await new Promise(r => setTimeout(r, 200));
      } catch { skipped++; }
    }

    const msg = `Knowledge base seeded.\nAdded: *${added}* new entries\nSkipped: ${skipped} (already existed)\n\nAll agents now have deep StandMe + exhibition industry context.`;
    await this.respond(ctx.chatId, msg);
    return { success: true, message: `Seeded ${added} KB entries`, confidence: 'HIGH' };
  }

  private async detectAndSaveInsights(userId: string, userMessage: string, brainResponse: string): Promise<void> {
    try {
      const extraction = await generateText(
        `You are an information extractor for a CRM system. Read this conversation and extract concrete business facts worth saving to long-term memory.

USER SAID: "${userMessage.slice(0, 600)}"
BRAIN RESPONDED: "${brainResponse.slice(0, 600)}"

Extract ONLY facts that are NEW and concrete:
- A specific budget (e.g. "budget is €40k")
- A DM name or title (e.g. "contact is Hans Müller, Marketing Director")
- A stated preference (e.g. "they prefer modular designs")
- A competitor mentioned (e.g. "FairMax is pitching them too")
- A deal decision (e.g. "won", "lost", "going ahead")
- A confirmed show + size (e.g. "36sqm at Hannover Messe 2026")

If nothing concrete or new: reply NONE
If facts found, reply in this EXACT format (one per line):
INSIGHT: [company or person] | [type: budget|dm|preference|competitor|decision|show] | [the fact in one sentence]`,
        undefined,
        200
      );

      if (!extraction || extraction.trim() === 'NONE' || !extraction.includes('INSIGHT:')) return;

      const lines = extraction.split('\n').filter(l => l.trimStart().startsWith('INSIGHT:'));
      for (const line of lines) {
        const parts = line.replace(/^.*?INSIGHT:\s*/, '').split('|');
        if (parts.length < 3) continue;
        const [entity, factType, fact] = parts.map(p => p.trim());
        if (!entity || !factType || !fact || fact.length < 5) continue;

        await saveKnowledge({
          source: `brain-insight-${userId}-${entity.toLowerCase().replace(/\s+/g, '-')}-${factType}-${Date.now()}`,
          topic: `${entity} — ${factType}`,
          content: fact,
          sourceType: 'insight',
          tags: [factType, entity.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 30)].join(','),
        });
        logger.info(`[Brain] Saved insight: ${entity} | ${factType} | ${fact.slice(0, 60)}`);
      }
    } catch { /* non-fatal — never interrupt the main flow */ }
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
