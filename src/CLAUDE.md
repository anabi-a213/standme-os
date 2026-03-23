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
- **Email outreach**: Woodpecker (cold campaign sequences), Instantly.ai (campaign reply webhooks)
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
5. **Pipeline commands handled before agent routing**: `/status`, `/resume [company]`, `/retry [company]`, `/briefing` are intercepted in index.ts and interact with `pipelineRunner` directly — they are not agents
6. Starts Express server on PORT (default 3000) serving:
   - `/dashboard` — React SPA + API routes
   - `/webhook/instantly` — Instantly.ai reply/open/bounce events → Agent-17
   - `/webhook/woodpecker` — Woodpecker reply events → Agent-20 saves to KB (read-only)
   - `/health` — Railway health check
7. Calls `startScheduler()` — runs agents with a `config.schedule` cron expression
8. **Startup restore sequence** (after `initWorkflowEngine()`):
   - `pipelineRunner.loadFromKB()` — restores non-DONE pipelines from Knowledge Base
   - `loadThreadsFromKB()` — restores user sessions under 4 hours old
   - `scanPendingApprovalsFromKB()` — finds pre-restart pending approvals, sends Mo a Telegram list

**Critical env var**: `DASHBOARD_ONLY=true` disables Telegram polling (send-only mode). Must be `false` in production.

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
| agent-08 | `08-card-manager.agent.ts` | Trello card CRUD; emits `deal.won` when card → "06 Won" | — |
| agent-09 | `09-technical-deadline.agent.ts` | Technical submission deadlines | — |
| agent-10 | `10-contractor-coord.agent.ts` | Contractor database | — |
| agent-11 | `11-lessons-learned.agent.ts` | Post-project lessons | — |
| agent-12 | `12-deal-analyser.agent.ts` | Deal win/loss analysis | — |
| agent-13 | `13-outreach.agent.ts` | Manual bulk outreach via Woodpecker | — |
| agent-14 | `14-drive-indexer.agent.ts` | Index Google Drive files to Knowledge Base | — |
| agent-15 | `15-marketing-content.agent.ts` | Generate marketing content | — |
| agent-16 | `16-cross-board.agent.ts` | Cross-board Trello sync — **no schedule, manual only** | — |
| agent-17 | `17-campaign-builder.agent.ts` | Campaign creation + Instantly.ai reply handling | — |
| agent-18 | `18-gmail-lead-monitor.agent.ts` | Monitor info@standme.de inbox; create leads; manage EMAIL_FUNNEL | every 15min |
| agent-19 | `19-email-funnel.agent.ts` | Two-way email conversations with inbound leads via Gmail | — |
| agent-20 | `20-woodpecker-sync.agent.ts` | Read-only Woodpecker data harvest → Knowledge Base | daily 3am |

### Two Lead Creation Paths
There are two distinct ways leads enter the system — they must NOT be merged:

1. **Manual** (Agent-01): `/newlead Company | Contact | Email | Show | Size | Budget` or natural language. Creates LEAD_MASTER row + Trello card immediately. Fires `lead.created` → W1 → Agent-02.
2. **Email inbound** (Agent-18): Scans `info@standme.de` every 15 min. Creates LEAD_MASTER row + sends welcome email + creates EMAIL_FUNNEL record. Has `conflictGuard` deduplication. W1 skips these (`source=email`).

Both paths call `pipelineRunner.start(leadId, company)` after creating the lead row.

Agent-02 (`/enrich`) accepts an optional company name — when called by W1, it only enriches that company, not all pending leads.

### Two Email Outbound Paths
These serve different purposes and must stay separate:

1. **Cold outreach** (Agent-13/17 + Woodpecker): Mass campaigns to prospects. Data → `CampaignSales` and `OUTREACH_LOG`.
2. **Email funnel** (Agent-18/19 + Gmail): Two-way conversations with leads who emailed `info@standme.de`. Uses `In-Reply-To` header for thread continuation. Data → `EMAIL_FUNNEL` sheet.

### Workflow Engine (`src/services/workflow-engine.ts`)
Five event-driven workflows:
- **W1** (`lead.created`): Triggers Agent-02 enrichment for the specific company. **Skips `source=email` AND `source=website`** — Agent-18 handles email leads directly.
- **W2** (`lead.enriched`): Notifies Mo when enrichment completes.
- **W3** (`deal.won`): Triggers Agent-11 (lessons-learned) + Agent-16 (cross-board sync).
- **W4** (`email.lead.received`): Logs new email lead event.
- **W5** (cron, **7am daily**): Full morning briefing — reads `pipelineRunner.getBlocked()`, scans LEAD_MASTER for stale unenriched leads, sends Mo a structured Telegram summary with blocked pipelines + `/resume` commands + stale lead list. **Auto-triggers `/enrich`** if stale leads found. `/briefing` command = manual re-run.

### PipelineRunner (`src/services/pipeline-runner.ts`)
Sequential pipeline tracker per lead: `INTAKE → ENRICH → BRIEF → PROPOSAL → OUTREACH`.

States: `WAITING` (ready) | `RUNNING` (executing) | `BLOCKED` (needs attention) | `DONE` (complete).

Key methods:
- `start(leadId, company)` — called by Agent-01 and Agent-18 after lead creation
- `advance(leadId, stepData)` — called by Agent-02 (after enrich) and Agent-03 (after brief)
- `block(leadId, reason)` — called by Agent-03 when required fields are missing
- `resume(leadId)` — returns `{ command, args }` for the blocked step; used by `/resume` handler
- `getBlocked()` / `getActive()` — used by W5 and `/status` command
- `loadFromKB()` — called at startup; restores non-DONE pipelines from KB

Persists every state change to KB as `pipeline-state-{leadId}`. `stepData` is NOT persisted (too large).

### DataValidator (`src/utils/data-validator.ts`)
Checks required fields before pipeline steps. Returns `{ valid, missing[], warnings[] }`.
- `validateForBrief(row)` — requires company, show name, stand size, budget
- `validateForOutreach(row)` — requires company, contact email
- Agent-03 calls this; if `missing.length > 0` → `pipelineRunner.block()` + info-request email

### Conflict Guard (`src/utils/conflict-guard.ts` or inline)
In-memory mutex with 60s TTL. Used by Agent-18 to prevent duplicate lead rows when two 15min scan cycles overlap.

### AI Client (`src/services/ai/client.ts`)
- `generateText(prompt, systemPrompt?, maxTokens?)` — single-turn
- `generateChat(messages[], systemPrompt?, maxTokens?)` — multi-turn, last message must be `role: 'user'`
- Both wrap calls in `retry()` and have a 30s timeout

### Knowledge Base (`src/services/knowledge.ts`)
Persistent memory in the `KNOWLEDGE_BASE` Google Sheets tab. Key functions:
- `saveKnowledge(entry)` — appends a new entry
- `updateKnowledge(source, updates)` — idempotent upsert by source string
- `searchKnowledge(query, limit)` — scored keyword search, 5-min in-process cache
- `sourceExistsInKnowledge(source)` — deduplication check

Also serves as the persistence store for pipeline states (`pipeline-state-*`), thread contexts (`thread-context-*`), and approval metadata (`pending-approval-*`).

### Approval Flow (`src/services/approvals.ts`)
Agents call `this.sendAction()` (BaseAgent) which formats a TYPE 1 message with `/approve_<id>` / `/reject_<id>` buttons. `registerApproval()` stores the callback in an in-memory Map **and** saves metadata to KB (`pending-approval-{id}`). On startup, `scanPendingApprovalsFromKB()` finds pre-restart pending approvals and notifies Mo. **Callbacks cannot be serialized** — re-running the command gives a fresh token. Only Agent-13 has full KB-based recovery (`reconstructBulkApproval()`).

### Thread Context (`src/services/thread-context.ts`)
Per-user history of recent cross-agent interactions (up to 20 entries, 4-hour session timeout). Injected into every agent's AI prompt by `BaseAgent.run()`. Also tracks `activeFocus` (current lead/project/show).

**Now persisted to KB** (debounced 30s per user). `loadThreadsFromKB()` restores sessions under 4 hours old on startup — Brain has context about what Mo was doing even after a restart.

### Dashboard Chat (`src/services/dashboard/chat-service.ts`)
`buildLiveDataContext()` runs Trello + 2× Sheets API calls **in parallel** via `Promise.all`. Has a **60-second in-process cache**. Each API call has a 7s timeout; outer safety net is 9s.

### Dashboard
- `src/services/dashboard/event-bus.ts` — `dashboardBus` singleton emits events
- `src/services/dashboard/socket.ts` — Socket.IO bridges bus events to browser clients
- `src/services/dashboard/routes.ts` — Express router at `/dashboard`. Password-protected via `DASHBOARD_PASSWORD` env var (cookie-based). Serves React SPA from `public/dashboard-build/`
- React frontend in `dashboard-app/` (Vite + React + Tailwind + Radix UI + Recharts + Socket.IO client)

### Message Types (Telegram output formatting)
- **TYPE 1** (`formatType1`) — action request with `/approve_<id>` / `/reject_<id>` buttons
- **TYPE 2** (`formatType2`) — alert/error notification
- **TYPE 3** (`formatType3`) — structured summary with labelled sections

### Role-Based Access (`src/config/access.ts`)
Roles: `ADMIN > SUB_ADMIN > OPS_LEAD > UNREGISTERED`. `canApprove()` returns true for ADMIN and SUB_ADMIN. Checked in `index.ts` before routing to any agent.

### Scheduled Agents (`src/scheduler/index.ts`)
Any agent with `config.schedule` (cron string) is auto-registered. All crons run in `Europe/Berlin` timezone. Per-agent overlap guard prevents concurrent runs.

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
| OutreachLog | OUTREACH_LOG | Sent email log |
| Lessons | LESSONS_LEARNED | Post-project win/loss lessons |
| Deadlines | TECHNICAL_DEADLINES | Show portal/rigging/electrics deadlines |
| Contractors | CONTRACTOR_DB | Contractor contacts and ratings |
| Index | DRIVE_INDEX | Google Drive file index |
| Hub | CROSS_AGENT_HUB | Cross-agent status sync |
| SystemLog | SYSTEM_LOG | Agent action log |
| Knowledge | KNOWLEDGE_BASE | AI knowledge base + dynamic config + pipeline/thread/approval state |
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
- Tests live in `src/__tests__/` using Jest + ts-jest. Tests cover config, services, utils — not agents directly
- `DASHBOARD_ONLY=true` disables Telegram polling — useful for testing dashboard locally
- Agent-02 (`/enrich`) does **not** auto-add leads to OUTREACH_QUEUE. Mo queues manually.
- Agent-16 (`/crossboard`) has **no schedule** — manual only.
- The `/status` command in index.ts (pipeline dashboard) shadows Agent-06's `/status` — this is intentional.

## What NOT to Break
- `saveHistory()` / `getHistory()` in Brain agent — per-user multi-turn conversation memory
- `getThreadContext()` / `saveThreadEntry()` in thread-context service — injected by `BaseAgent.run()`
- `registerApproval()` / `handleApproval()` in approvals.ts — approval callback lifecycle
- `generateChat()` in ai/client.ts — Brain passes a proper messages array; must not be flattened to a single prompt
- `conflictGuard` in Agent-18 — prevents duplicate lead rows when two scan cycles overlap
- `liveDataCache` in dashboard `chat-service.ts` — 60s cache preventing API hammering
- `saveFunnelRecord()` in Agent-18 — must be called after welcome email; Agent-19 depends on this row
- `saveReplyToKB()` in Agent-20 — called directly by `/webhook/woodpecker` handler; must remain public
- `pipelineRunner` singleton in `pipeline-runner.ts` — shared state across agents and index.ts handlers
- Startup restore sequence in index.ts: `loadFromKB()` → `loadThreadsFromKB()` → `scanPendingApprovalsFromKB()` — must run after `initWorkflowEngine()`
- W1 source check: skips **both** `source=email` and `source=website` — removing either causes double-enrichment
