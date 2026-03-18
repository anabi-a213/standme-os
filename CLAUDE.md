# StandMe OS — Claude Code Context

## What This Project Is
StandMe OS is an AI-driven operating system for StandMe, an exhibition stand design & build company.
It runs as a Telegram bot + web dashboard with 17 specialised agents covering the full business:
sales pipeline, design briefs, project management, outreach, marketing content, and operations.

## Company: StandMe
- **Business**: Exhibition stand design & build — full service (design + production + installation + strip)
- **Regions**: MENA (Dubai/Gulf) and Europe (Germany, Spain, France, UK)
- **Base**: Germany — domain standme.de
- **Emails**: info@standme.de (main), mohammed.anabi@standme.de (Mo, owner)
- **Team**:
  - **Mo (Mohammed Anabi)**: Owner/Admin — all final decisions, sales approvals, key client relationships
  - **Hadeer**: Operations Lead — project execution, contractor coordination, timelines
  - **Bassel**: Sub-Admin — day-to-day support, data, reporting

## Technology Stack
- **Runtime**: Node.js / TypeScript
- **AI**: Anthropic Claude (claude-sonnet-4-20250514) via `@anthropic-ai/sdk`
- **Bot**: node-telegram-bot-api (polling mode)
- **Data**: Google Sheets (source of truth), Google Drive (documents), Trello (pipeline boards)
- **Email**: Woodpecker (outreach campaigns), Gmail (direct sends)
- **Server**: Express.js on port 3000

## Key File Locations
```
src/agents/          17 agent files (01-lead-intake to 17-campaign-builder)
src/agents/04-brain.agent.ts   Central Brain agent — main intelligence layer
src/agents/base-agent.ts       Base class all agents extend
src/agents/registry.ts         Agent lookup by command/id
src/services/ai/client.ts      Claude API wrapper (generateText, generateChat, etc.)
src/services/knowledge.ts      Google Sheets knowledge base service
src/services/thread-context.ts Per-user cross-agent conversation state
src/config/standme-knowledge.ts Deep company + industry static knowledge
src/config/sheets.ts           Google Sheets column mappings (12 sheets)
src/config/shows.ts            Verified shows database
src/config/access.ts           Role-based access (ADMIN, OPS_LEAD, TEAM_MEMBER)
src/types/agent.ts             AgentContext, AgentConfig, AgentResponse types
src/scripts/seed-knowledge.ts  Seeds Google Sheets KB with curated knowledge
```

## Agent Architecture
- All agents extend `BaseAgent` which auto-injects `threadContext` + `activeFocus` into `AgentContext`
- Brain agent (`/brain`, `/ask`) is the central NLP hub — handles free-text, triggers other agents
- Each agent has `execute(ctx: AgentContext)` for its logic and optional `schedule` for cron jobs
- `generateChat()` for multi-turn Brain conversations, `generateText()` for single-turn agent calls

## Pipeline Stages (Trello Sales Board)
01 New Inquiry → 02 Qualifying → 03 Concept Brief → 04 Proposal Sent → 05 Negotiation → 06 Won → 07 Lost-Delayed

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
- Pre-existing TypeScript errors exist due to missing `@types/node` + uninstalled packages — ignore these
- The project runs despite TS errors (transpile-only mode)
- `.env` file lives on the server, not in the repo
- Knowledge base entries are stored in Google Sheets (KNOWLEDGE_BASE tab)
- Run `ts-node src/scripts/seed-knowledge.ts` to seed the knowledge base

## What NOT to Break
- The `saveHistory()` / `getHistory()` methods in Brain agent (per-user conversation memory)
- The thread-context service (cross-agent memory, injected by BaseAgent.run())
- The approval flow in `src/services/approvals.ts` (Mo approves via Telegram buttons)
- The `generateChat()` function — Brain uses proper multi-turn messages array
