# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is
StandMe OS is an AI-driven operating system for StandMe, an exhibition stand design & build company.
It runs as a Telegram bot + web dashboard with 20 specialised agents covering the full business:
sales pipeline, design briefs, project management, outreach, marketing content, and operations.

## Company: StandMe
- **Business**: Exhibition stand design & build — full service (design + production + installation + strip)
- **Regions**: MENA (Dubai/Gulf) and Europe (Germany, Spain, France, UK)
- **Base**: Germany — domain standme.de
- **Emails**: info@standme.de (inbound leads + email funnel), mohammed.anabi@standme.de (Mo, owner)
- **Team**:
  - **Mo (Mohammed Anabi)**: Owner/Admin — all final decisions, sales approvals, key client relationships
  - **Hadeer**: Operations Lead — project execution, contractor coordination, timelines
  - **Bassel**: Sub-Admin — day-to-day support, data, reporting

## Technology Stack
- **Runtime**: Node.js / TypeScript
- **AI**: Anthropic Claude (`claude-sonnet-4-20250514`) via `@anthropic-ai/sdk`
- **Bot**: node-telegram-bot-api (polling mode)
- **Data**: Google Sheets (source of truth, 13 tabs), Google Drive (documents), Trello (pipeline boards)
- **Email outreach**: Woodpecker (cold campaign sequences), Instantly.ai (Growth plan — API polling every 3h; webhook available on Hypergrowth plan)
- **Email direct**: Gmail API via `info@standme.de` (two-way funnel conversations with inbound leads)
- **Server**: Express.js on port 3000

## Commands

```bash
# Development
npm run dev            # Run bot + web server via ts-node
npm run dev:watch      # Same with nodemon auto-reload
npm run web            # Web/dashboard server only
npm run web:watch      # Same with auto-reload

# Build (compiles TS + builds React dashboard)
npm run build

# Production
npm start              # Run compiled dist/index.js

# Tests
npm test               # Run all Jest tests (no coverage)
npx jest src/__tests__/agents.base-agent.test.ts   # Run single test file

# Setup
npm run setup:google   # OAuth setup for Google APIs
npm run setup:sheets   # Initialize Google Sheets tabs
ts-node src/scripts/seed-knowledge.ts   # Seed Knowledge Base in Google Sheets
```

## Code Architecture

### Entry Point & Request Flow
`src/index.ts` bootstraps everything:
1. Loads `.env` and calls `loadRuntimeConfig()` — pulls dynamic config (Drive folder IDs, etc.) from Google Sheets Knowledge Base into `process.env`
2. Warms Google OAuth, initialises Sheets tabs (`initSheets()`), validates critical sheet headers
3. Instantiates and registers all 20 agents into `registry.ts` (a `Map<string, BaseAgent>` keyed by command and agent ID)
4. Starts Telegram bot polling — messages are routed to agents by command prefix; unrecognised text falls through to Brain (`/ask`)
5. Starts Express server on PORT (default 3000) serving:
   - `/dashboard` — React SPA + API routes
   - `/webhook/instantly` — receives Instantly.ai reply/open/bounce events → routed to Agent-17 (`CampaignBuilderAgent`). **Polling mode guard**: if neither `INSTANTLY_WEBHOOK_SECRET` nor `INSTANTLY_WEBHOOK_ENABLED` is set, the handler returns 200 immediately (polling mode active; webhook ignored).
   - `/webhook/woodpecker` — receives Woodpecker reply events → Agent-20 saves reply body to Knowledge Base (read-only, no other side effects)
   - `/health` — Railway health check
6. Calls `startScheduler()` — runs agents with a `config.schedule` cron expression

**Critical env var**: `DASHBOARD_ONLY=true` disables Telegram polling (send-only mode). Must be `false` in production for Mo to be able to send commands.

### Agent System
All agents extend `BaseAgent` (`src/agents/base-agent.ts`). The contract:
- `config: AgentConfig` — defines `id`, `name`, `commands[]`, optional `schedule`, and `requiredRole`
- `execute(ctx: AgentContext): Promise<AgentResponse>` — the agent's logic
- `run(ctx)` (from BaseAgent) — wraps `execute()` with: thread-context injection, error handling + Mo alert on crash, system log write, dashboard event emit, and thread-entry save after response

`AgentContext` carries: `userId`, `chatId`, `command`, `args`, `role`, `language`, plus `threadContext` (recent cross-agent activity string) and `activeFocus` (current entity focus) injected automatically by `BaseAgent.run()`.

Brain agent (`04-brain.agent.ts`) uses `generateChat()` with a stored per-user messages array for real multi-turn conversations. All other agents use `generateText()` for single-shot calls.

### Agent Registry (20 agents)
| ID | File | Purpose | Schedule |
|----|------|---------|----------|
| agent-01 | `01-lead-intake.agent.ts` | Create leads from pipe-separated args or natural language | — |
| agent-02 | `02-lead-enrichment.agent.ts` | Enrich lead data + find DMs; accepts optional `targetCompany` arg to limit scope | — |
| agent-03 | `03-concept-brief.agent.ts` | Generate design briefs; fuzzy-matches lead names (3-pass search) | — |
| agent-04 | `04-brain.agent.ts` | Multi-turn AI assistant with per-user chat history | — |
| agent-05 | `05-deadline-monitor.agent.ts` | Check upcoming show deadlines | daily 8am |
| agent-06 | `06-project-status.agent.ts` | Project status summaries | — |
| agent-07 | `07-client-reminder.agent.ts` | Client follow-up reminders | — |
| agent-08 | `08-card-manager.agent.ts` | Trello card CRUD | — |
| agent-09 | `09-technical-deadline.agent.ts` | Technical submission deadlines | — |
| agent-10 | `10-contractor-coord.agent.ts` | Contractor database | — |
| agent-11 | `11-lessons-learned.agent.ts` | Post-project lessons | — |
| agent-12 | `12-deal-analyser.agent.ts` | Deal win/loss analysis | — |
| agent-13 | `13-outreach.agent.ts` | Cold outreach pipeline via Instantly.ai: `/launch` (Drive→campaign), `/replies` (check replies), `/convert` (reply→lead). `/bulkoutreach`, `/importleads`, `/newcampaign` deprecated. | Mon 9am (notify-only briefing) |
| agent-14 | `14-drive-indexer.agent.ts` | Index Google Drive files to Knowledge Base | — |
| agent-15 | `15-marketing-content.agent.ts` | Generate marketing content | — |
| agent-16 | `16-cross-board.agent.ts` | Cross-board Trello sync (no schedule — manual only) | — |
| agent-17 | `17-campaign-builder.agent.ts` | `/salesreplies` — classification-only: fetches Instantly replies, classifies intent via AI, updates CAMPAIGN_SALES, saves KB entries, alerts Mo with `/convert` hints. No Gmail fetch, no reply generation, no approval flow. | — |
| agent-18 | `18-gmail-lead-monitor.agent.ts` | Monitor info@standme.de inbox; create leads from emails; manage EMAIL_FUNNEL records | every 15min |
| agent-19 | `19-email-funnel.agent.ts` | Two-way email conversations with inbound leads via Gmail | — |
| agent-20 | `20-woodpecker-sync.agent.ts` | Read-only Woodpecker data harvest → Knowledge Base | daily 3am |

### Two Lead Creation Paths
There are two distinct ways leads enter the system — they must NOT be merged:

1. **Manual** (Agent-01): `/newlead Company | Contact | Email | Show | Size | Budget` or natural language. Creates LEAD_MASTER row + Trello card immediately.
2. **Email inbound** (Agent-18): Scans `info@standme.de` every 15 min. Creates LEAD_MASTER row + sends welcome email + creates EMAIL_FUNNEL record. Has `conflictGuard` deduplication to prevent duplicate rows.

Agent-02 (`/enrich`) accepts an optional company name argument — when called by the Workflow Engine with a specific company, it only enriches that company, not all pending leads.

### Cold Outreach Pipeline (Agent-13 + Agent-17 + Instantly.ai)
Single clean flow — deprecated commands (`/bulkoutreach`, `/importleads`, `/newcampaign`) still route to `/launch` via Brain's `directRoutes`:

1. **`/launch [show]`** — 7-step flow: validate show → find Drive exhibitor file → parse prospects → find/create Instantly campaign → dedup vs OUTREACH_LOG + CAMPAIGN_SALES → build TYPE 1 approval → `onApprove` batch-writes OUTREACH_LOG + CAMPAIGN_SALES + LEAD_MASTER (new companies only)
2. **`/replies`** — calls `/salesreplies` (Agent-17): fetches Instantly replies, classifies HIGH/MEDIUM/LOW intent, updates CAMPAIGN_SALES status, saves `sales-reply-*` and `pending-conversion-*` KB entries, alerts Mo with `/convert [email]` hints
3. **`/convert [email|company]`** — finds CAMPAIGN_SALES record → dedup vs LEAD_MASTER → creates HOT lead row → creates EMAIL_FUNNEL row → starts `pipelineRunner` → sets CAMPAIGN_SALES col R (`leadMasterId`) → marks `pending-conversion-*` KB entry resolved
4. **`/brief [company]`** — hands off to Agent-03 for design brief generation

**`pending-conversion-*` KB entries**: Keyed as `pending-conversion-[email]`, tagged `pending-conversion`. Created by `/replies` for HIGH intent and by `/salesreplies` for INTERESTED/NEEDS_MORE_INFO. Marked resolved (`tags: 'pending-conversion,resolved'`) by `/convert`. W5 morning briefing surfaces any unresolved ones to Mo.

### Two Email Outbound Paths
These serve different purposes and must stay separate:

1. **Cold outreach** (Agent-13/17 + Instantly.ai): Mass campaigns to prospects who haven't contacted us yet. Data flows → `CampaignSales` sheet and `OUTREACH_LOG`. Replies polled every 3 hours.
2. **Email funnel** (Agent-18/19 + Gmail): Ongoing two-way conversations with leads who emailed `info@standme.de`. Uses Gmail API with proper thread continuation (`In-Reply-To` header). Data flows → `EMAIL_FUNNEL` sheet (13th tab).

### Workflow Engine (`src/services/workflow-engine.ts`)
Five event-driven workflows (W1–W5) plus **3 cron jobs**:
- **W1** (`lead.created`): Triggers Agent-02 enrichment for the specific company. **Skips email/website-sourced leads** — Agent-18 handles those directly.
- **W2** (`lead.enriched`): Notifies Mo when enrichment completes
- **W3** (`deal.won`): Triggers lessons-learned + cross-board sync
- **W4** (`email.lead.received`): Logs new email lead event
- **W5** (cron, 7am daily): Checks LEAD_MASTER for PENDING/QUALIFYING leads and notifies Mo. Also searches KB for unresolved `pending-conversion` entries and lists them with `/convert [email]` hints. Does NOT auto-enrich — Mo decides when to run `/enrich`.
- **Instantly poller** (cron, every 3 hours): Calls `pollInstantlyReplies()` → runs `/salesreplies` (Agent-17) in `scheduled` mode. Skips if `isInstantlyConfigured()` is false. This replaces webhook dependency on the Growth plan.

### Conflict Guard (`src/utils/conflict-guard.ts` or inline)
In-memory mutex with 60s TTL. Used by Agent-18 to prevent duplicate lead rows when the same email triggers multiple scan cycles simultaneously.

### AI Client (`src/services/ai/client.ts`)
- `generateText(prompt, systemPrompt?, maxTokens?)` — single-turn
- `generateChat(messages[], systemPrompt?, maxTokens?)` — multi-turn, last message must be `role: 'user'`
- Both wrap calls in `retry()` and have a 30s timeout

### Knowledge Base (`src/services/knowledge.ts`)
Persistent memory in the `KNOWLEDGE_BASE` Google Sheets tab. Key functions:
- `saveKnowledge(entry)` — appends a new entry
- `updateKnowledge(source, updates)` — update by source string (idempotent upsert)
- `searchKnowledge(query, limit)` — scored keyword search, 5-min in-process cache
- `sourceExistsInKnowledge(source)` — deduplication check

Agent-20 writes Woodpecker campaign stats and replied-prospect summaries here. Brain and the dashboard chat use `searchKnowledge()` to pull relevant context into every AI prompt.

### Approval Flow (`src/services/approvals.ts`)
Agents that need Mo's sign-off call `this.sendAction()` (BaseAgent) which formats a TYPE 1 message with `/approve_<id>` and `/reject_<id>` buttons. `registerApproval(id, { onApprove, onReject })` stores the callback in an in-memory Map. **Approvals are lost on Railway redeploy.** Only the outreach launch flow has a Knowledge Base fallback (`reconstructBulkApproval()`) — both `/launch` and the deprecated `/bulkoutreach` persist their approval payload to KB under `bulk-approval-{approvalId}`; all other agents require re-running the original command.

### Dashboard Chat (`src/services/dashboard/chat-service.ts`)
The dashboard chat calls `buildLiveDataContext()` before every AI response. This function:
- Runs Trello + 2× Sheets API calls **in parallel** via `Promise.all` (not sequentially)
- Has a **60-second in-process cache** — repeated messages within a minute reuse cached data
- Each individual API call has a 7s per-call timeout; outer safety net is 9s

### Dashboard
- `src/services/dashboard/event-bus.ts` — `dashboardBus` singleton emits events (agent started/finished, approvals, logs, live chat)
- `src/services/dashboard/socket.ts` — Socket.IO bridges bus events to connected browser clients
- `src/services/dashboard/routes.ts` — Express router at `/dashboard`. Password-protected via `DASHBOARD_PASSWORD` env var (cookie-based). Serves the React SPA from `public/dashboard-build/` and exposes REST APIs (`/api/agents`, `/api/logs`, `/api/trello`, etc.)
- React frontend lives in `dashboard-app/` (Vite + React + Tailwind + Radix UI + Recharts + Socket.IO client). Built output goes to `public/dashboard-build/`

### Thread Context (`src/services/thread-context.ts`)
In-memory per-user history of recent cross-agent interactions. Stores up to 20 entries with 4-hour session timeout. Provides a formatted string injected into every agent's AI prompt so agents know what the user has been working on. Also tracks `activeFocus` (current lead/project/show).

### Message Types (Telegram output formatting)
- **TYPE 1** (`formatType1`) — action request with `/approve_<id>` / `/reject_<id>` buttons
- **TYPE 2** (`formatType2`) — alert/error notification
- **TYPE 3** (`formatType3`) — structured summary with labelled sections

### Role-Based Access (`src/config/access.ts`)
Roles in descending order: `ADMIN > SUB_ADMIN > OPS_LEAD > UNREGISTERED`. Team members identified by Telegram user ID (or username for Bassel). `canApprove()` returns true for ADMIN and SUB_ADMIN. Role checked in `index.ts` before routing to any agent.

### Scheduled Agents (`src/scheduler/index.ts`)
Any agent with `config.schedule` (cron string) is auto-registered by `startScheduler()`. All crons run in `Europe/Berlin` timezone. Per-agent overlap guard prevents concurrent runs.

## Key Config Files
```
src/config/standme-knowledge.ts   Deep static company + industry knowledge injected into AI prompts
src/config/sheets.ts              Google Sheets tab names and column mappings (13 sheets)
src/config/shows.ts               Verified shows database with dates, cities, industries
src/config/access.ts              Role definitions and team member Telegram IDs
```

## Google Sheets — 13 Tabs
| Tab | Config Key | Purpose |
|-----|-----------|---------|
| Leads | LEAD_MASTER | All leads — source of truth for pipeline |
| Queue | OUTREACH_QUEUE | Leads queued for cold outreach |
| OutreachLog | OUTREACH_LOG | Sent email log (renamed from `Log` to avoid collision) |
| Lessons | LESSONS_LEARNED | Post-project win/loss lessons |
| Deadlines | TECHNICAL_DEADLINES | Show portal/rigging/electrics deadlines |
| Contractors | CONTRACTOR_DB | Contractor contacts and ratings |
| Index | DRIVE_INDEX | Google Drive file index |
| Hub | CROSS_AGENT_HUB | Cross-agent status sync |
| SystemLog | SYSTEM_LOG | Agent action log (renamed from `Log`) |
| Knowledge | KNOWLEDGE_BASE | AI knowledge base + dynamic config |
| CampaignSales | CAMPAIGN_SALES | Woodpecker/Instantly campaign reply tracking |
| WorkflowLog | WORKFLOW_LOG | Workflow engine execution log |
| EmailFunnel | EMAIL_FUNNEL | Two-way Gmail conversations with inbound leads |

## Pipeline Stages (Trello Sales Board)
`01 New Inquiry → 02 Qualifying → 03 Concept Brief → 04 Proposal Sent → 05 Negotiation → 06 Won → 07 Lost-Delayed`

## Email Funnel Stages
`NEW_INQUIRY → WELCOMED → QUALIFYING → BRIEFED → PROPOSAL → WON / LOST`

Managed by Agent-18 (detection + welcome) and Agent-19 (ongoing conversation).

## Key Shows StandMe Targets
| Show | Month | City | Industry |
|------|-------|------|----------|
| Arab Health | January | Dubai | Healthcare/Pharma |
| Gulfood | February | Dubai | Food & Beverage |
| ISE | February | Barcelona | AV/Technology |
| Hannover Messe | April | Hannover | Industrial |
| Interpack | May (triennial) | Düsseldorf | Packaging |
| Intersolar | June | Munich | Solar/Energy |
| SIAL Paris | October (biennial) | Paris | Food |
| MEDICA | November | Düsseldorf | Medical Devices |

## Development Notes
- Pre-existing TypeScript errors exist due to missing `@types/node` + uninstalled packages — ignore these; project runs in transpile-only mode
- `.env` file lives on the server (Railway), not in the repo
- Knowledge Base entries live in Google Sheets (`KNOWLEDGE_BASE` tab); dynamic config (Drive folder IDs, etc.) is loaded from there at startup via `loadRuntimeConfig()`
- Tests live in `src/__tests__/` and use Jest + ts-jest. Tests cover config, services, utils — not agents directly
- `DASHBOARD_ONLY=true` disables Telegram polling — useful for testing dashboard locally without bot token
- Agent-16 (`/crossboard`) has **no schedule** — manual only. It previously ran daily and spammed Trello with unsolicited comments.
- Agent-02 (`/enrich`) does **not** auto-add leads to OUTREACH_QUEUE. Mo decides when to queue leads manually.

## What NOT to Break
- `saveHistory()` / `getHistory()` in Brain agent — per-user multi-turn conversation memory
- `getThreadContext()` / `saveThreadEntry()` in thread-context service — injected by BaseAgent.run()
- `registerApproval()` / `handleApproval()` in approvals.ts — approval callback lifecycle
- `generateChat()` in ai/client.ts — Brain passes a proper messages array; must not be flattened to a single prompt
- `conflictGuard` in Agent-18 — prevents duplicate lead rows when two scan cycles overlap
- `liveDataCache` in dashboard `chat-service.ts` — 60s cache preventing API hammering; do not remove
- `saveFunnelRecord()` in Agent-18 — must be called after welcome email to create the EMAIL_FUNNEL row that Agent-19 depends on
- `saveReplyToKB()` in Agent-20 — called directly by the `/webhook/woodpecker` handler; must remain a public method
- `reconstructBulkApproval()` in Agent-13 — fallback for post-redeploy approval recovery; both `/launch` and deprecated `/bulkoutreach` save to KB under `bulk-approval-{approvalId}`
- `pollInstantlyReplies()` in workflow-engine.ts — 3-hour cron that drives reply processing on the Growth plan; do not remove the `isInstantlyConfigured()` guard
