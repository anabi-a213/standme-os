Design a premium SaaS web application called "StandMe OS" — an AI-powered agent 
operating system for StandMe, a premium exhibition stand design company 
(MENA and Europe markets).

═══════════════════════════════════════
BRAND IDENTITY — STRICTLY FOLLOW THIS
═══════════════════════════════════════
Company personality: Premium industrial. Think high-end architecture firm meets 
modern tech. NOT luxury salon. NOT flashy. Confident, clean, precise.

COLOR SYSTEM:
- Background (primary): #0d0d0d — near black, the base of everything
- Surface (cards, panels): #1a1a1a
- Surface raised (modals, hover): #242424
- Border: #2e2e2e
- Text primary: #FFFFFF
- Text muted: #9a9a9a
- Accent GOLD: #C9A84C — warm, rich, not bright yellow
- Accent gold dim: rgba(201, 168, 76, 0.15) — for subtle gold glow/fill

GOLD USAGE RULES (critical):
✓ Use gold FOR: active state borders, CTA buttons, running agent pulse, 
  divider lines, icon accents, command chip borders, key numbers/stats
✗ NEVER use gold FOR: large fills, backgrounds, text blocks, anything 
  that covers more than ~10% of a component's surface area
  Too much gold = cheap. StandMe should feel like a Bloomberg terminal 
  crossed with a luxury architecture studio.

Supporting colors (used sparingly):
- Success green: #22d3a5 (agent done, system healthy)
- Error red: #f05c5c (agent error, warning)
- Info blue: #60a5fa (Telegram activity events)
- Amber: #f5c842 (approval pending states)

TYPOGRAPHY:
- Font: Inter (all weights) or Geist
- Headers: 600 weight, uppercase tracking for section labels
- Body: 400, 14px
- Agent names: 500, 16px
- Command tags: 500, 12px monospace (Cascadia Code or Fira Code)
- Numbers/stats: 600, tabular nums

═══════════════════════════════════════
LAYOUT
═══════════════════════════════════════
Three-panel layout, full viewport height (100vh), no outer scroll.
Desktop baseline: 1440px wide.

[ LEFT SIDEBAR 220px | MAIN AGENT GRID flex | RIGHT PANEL 380px ]

─────────────────────────────────────────
LEFT SIDEBAR
─────────────────────────────────────────
Background: #0d0d0d with 1px right border in #2e2e2e

Top section:
- Logo area: "SM" monogram in gold on black square + "STANDME OS" wordmark 
  in white uppercase
- Status pill: gold dot + "ONLINE" text (or red dot + "OFFLINE")
- Thin gold horizontal divider line below logo

Navigation groups (section label in muted uppercase 10px tracking):
  LEAD MANAGEMENT
    /newlead    Add lead
    /enrich     Enrich leads  
    /brief      Concept brief
    /outreach   Run outreach
    /outreachstatus  Stats

  PROJECT OPS
    /status       Pipeline
    /deadlines    Deadlines
    /techdeadlines  Tech deadlines
    /reminders    Follow-ups
    /crossboard   Board health

  TEAM & RESOURCES
    /contractors    List
    /addcontractor  Add
    /findfile       Search Drive
    /lesson         Lessons
    /dealanalysis   Analysis

  INTELLIGENCE
    /ask   Brain
    /brief   Brief

  MARKETING
    /post  /caption  /contentplan

Each nav item: command in gold monospace tag + description in muted white.
Active/hover: left gold border (2px), background lifts to #1a1a1a.

Bottom of sidebar:
- Mini stats bar: runs today | errors | uptime
- Values in gold, labels in muted

─────────────────────────────────────────
MAIN CONTENT — AGENT MONITORING GRID
─────────────────────────────────────────
Background: #0d0d0d

Top bar:
- "AGENTS" in white uppercase + thin gold underline accent
- Filter chips: ALL (active=gold border) / RUNNING / ERROR
- Search input: dark surface, gold focus ring

Agent cards grid (2 columns, gap 16px, padding 20px):
Each card background: #1a1a1a, border: 1px solid #2e2e2e, radius 10px

Card anatomy:
  ┌─────────────────────────────────┐
  │ AGENT-01            [IDLE]      │ ← agent number muted + status pill
  │                                 │
  │ Lead Intake & Qualification     │ ← name, white 500 16px
  │ Score and qualify incoming leads│ ← description muted 13px
  │                                 │
  │ Last: never  ·  Dur: —  ·  0   │ ← stats row, muted 11px
  │                                 │
  │ [/newlead]                      │ ← command chips, gold outlined
  └─────────────────────────────────┘

Status pills:
- IDLE: #2e2e2e background, muted text
- RUNNING: gold border + gold text + subtle outer gold glow 
  + animated shimmer sweep across card + "●" pulse dot
- ERROR: red border + red text + subtle red glow

When RUNNING: card border turns gold (1px → 2px gold), 
background lifts slightly to #1f1e1a (warm dark tint)

─────────────────────────────────────────
RIGHT PANEL
─────────────────────────────────────────
Background: #111111, left border: 1px solid #2e2e2e

Split into two sections with a gold 1px divider line between them:

── LIVE ACTIVITY (top, ~35% height, collapsible) ──
Header: "LIVE ACTIVITY" uppercase muted label + gold live-dot indicator + 
  collapse/expand arrow button

Event list (compact, auto-scroll, newest at bottom):
Each row: [time] [colored left border] [agent name in gold] [message]

Left border colors by event type:
  agent:start  → gold (#C9A84C)  "▶ running (/command)"
  agent:end    → green (#22d3a5) "✓ done in 2.3s"
  agent:error  → red (#f05c5c)   "✗ error: message"
  approval     → amber (#f5c842) "⏳ approval pending"
  telegram     → blue (#60a5fa)  "📱 @Mo (Admin) → /status"

Empty state: "Waiting for activity..." in muted italic center

── AI CHAT (bottom, ~65% height) ──
Header: 
  - Left: Gold circle avatar with "AI" text + "STANDME AI" label
  - Right: "Clear" ghost button

Message thread (scrollable):
  User bubble: right-aligned, #2a2418 background (warm dark), 
    gold-tinted border, white text
  AI bubble: left-aligned, #1a1a1a background, no border, white text
  
  AI bubble renders markdown:
    **bold**, bullet points, code blocks (monospace, #111111 bg)
  
  Arabic messages: RTL direction, mirrored alignment
  
  Typing indicator: three animated gold dots in a bubble
  
  Agent running badge: small inline pill "Running /status..." 
    gold background, black text, pulse animation

Input area (sticky bottom):
  - Multi-line textarea: #1a1a1a bg, gold focus border, white text
  - Placeholder: "Ask anything in Arabic or English...  اسأل أي شيء"
    (shown in both languages)
  - Send button: solid gold (#C9A84C), black text, rounded 8px
  - Below input: muted hint "Shift+Enter for new line"

═══════════════════════════════════════
INTERACTIVE STATES
═══════════════════════════════════════
1. Default — all idle, empty feed, AI welcome message visible
2. Agent running — card glows gold, RUNNING pill pulses, feed updates
3. Chat streaming — text appears progressively in AI bubble
4. Error state — card red glow, red feed entry, toast top-right
5. Command chip click — opens small modal:
   Dark overlay, centered card, 
   "Run /status now?" with gold Confirm + ghost Cancel
   OR fills chat input with the command text
6. Collapsed activity — right panel shows only chat (full height)

Additional screens:
- Login gate: centered on black, "SM" gold logo, password input 
  with gold focus ring, gold Login button
- Mobile (768px): sidebar collapses to gold icon strip, 
  right panel becomes slide-up bottom drawer

═══════════════════════════════════════
COMPONENT NAMING (for dev handoff)
═══════════════════════════════════════
Name components exactly as follows so they connect to the live backend:

AgentCard          props: id, name, state, lastRun, duration, runCount, commands
ActivityFeedItem   props: type, agentName, message, timestamp  
ChatBubble         props: role, content, isStreaming, isRTL
AgentRunningBadge  props: command
CommandChip        props: command, onClick
SystemStatsBar     props: totalRuns, errors, activeAgents, uptime
StatusPill         props: state (idle|running|error)
LoginGate          props: onSubmit

Backend connects via:
  Socket.IO  /ws  — events: init, event, stats, agents,
                    chat:welcome, chat:chunk, chat:done, chat:typing,
                    chat:agent_start, chat:agent_done, chat:error
  REST GET   /dashboard/api/agents  /api/logs  /api/stats  /api/agent-configs
  REST POST  /dashboard/api/trigger  body: { command, args }

═══════════════════════════════════════
OUTPUT SPEC
═══════════════════════════════════════
- Dark mode only
- 1440px desktop primary, 768px mobile breakpoint
- All components with auto-layout and proper constraints
- Export-ready with design tokens matching the color system above
- No stock photos, no illustrations — pure UI components only
- Spacing system: 4px base unit (4/8/12/16/20/24/32/48)
