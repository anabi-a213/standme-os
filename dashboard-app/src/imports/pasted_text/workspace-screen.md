This is the SECOND SCREEN of StandMe OS (continuation of the first design).
Same brand system applies: #0d0d0d bg, #C9A84C gold accent, Inter font, 
premium industrial tone. Build on the existing design system exactly.

Add a new top-level navigation tab called "WORKSPACE" to the global top bar
(next to the existing dashboard view). This screen gives full real-time 
visibility into Trello, Sheets, Drive, and outreach — all in one place.
No switching apps. No leaving the OS.

════════════════════════════════════════════
WORKSPACE SCREEN LAYOUT
════════════════════════════════════════════

Same global top bar and left sidebar as the main dashboard.
Main area splits into a flexible mosaic of monitoring panels.
Each panel is a resizable/collapsible widget card.

Default layout (1440px):

┌─────────────────────────┬─────────────────┬──────────────────┐
│  PIPELINE BOARD         │  LEAD STATS     │  OUTREACH STATUS │
│  (Trello view)          │  (from Sheets)  │  (Woodpecker)    │
│  ~50% width             │  ~25% width     │  ~25% width      │
│  ~60% height            │  ~60% height    │  ~60% height     │
├─────────────────────────┴─────────────────┴──────────────────┤
│  DEADLINES TIMELINE (full width, ~40% height)                 │
└───────────────────────────────────────────────────────────────┘

Each panel:
- Dark card (#1a1a1a), border 1px #2e2e2e, radius 8px
- Header: panel title uppercase muted + last-sync time + [↻ Refresh] icon
- Loading state: gold shimmer skeleton
- Error state: red border + "Failed to load — [Retry]"
- Collapse button top-right: arrow icon, animates closed
- Resize handle on panel edges (drag to resize)


════════════════════════════════════════════
PANEL 1: PIPELINE BOARD (Trello)
════════════════════════════════════════════
Full Kanban view of StandMe's deal pipeline inside the dashboard.
No need to open Trello — everything visible and actionable here.

Pipeline stages (horizontal columns, scrollable):
  Qualifying → Proposal → Approved → Design → Production → Build → Complete

COLUMN header:
  Stage name (white 13px) + card count badge (gold pill)
  Total value if known (muted "€ 140,000")

CARD in column:
┌──────────────────────────────────┐
│  [Industry icon]  Company Name   │
│  Show: Arab Health · Dubai       │
│  Size: 36sqm · Budget: €45K      │
│  DM: Contact Name  [📧] [🔗]     │
│  ─────────────────────────────── │
│  ⏰ Deadline: 12 days            │
│  [Move Stage →]                  │
└──────────────────────────────────┘

Card details:
- Company name: white 14px 500
- Show name + city: muted 12px
- Stand size + budget: 12px, budget in gold
- DM name with email icon + LinkedIn icon (clickable)
- Deadline chip: green if >30 days, amber if 10-30, red if <10
- [Move Stage →]: gold ghost button, opens stage selector dropdown

Stage selector dropdown on [Move Stage →]:
  Shows all stages as options, current highlighted in gold
  Confirmation: "Move [Company] to Design?" with [Confirm] [Cancel]
  On confirm: card animates to new column, activity feed logs the move

OVERDUE cards: red left border (2px), "OVERDUE" badge top-right

STALLED cards: amber left border if no activity in 7+ days
  Tooltip: "No update in 8 days — consider /reminders"

TOP of Kanban panel:
  Search: filter cards by company or show name
  Filter chips: [All] [My Stage] [Overdue] [Stalled] [High Value]
  [+ Add Lead] button (gold) → opens /newlead in AI chat


════════════════════════════════════════════
PANEL 2: LEAD STATS (Google Sheets)
════════════════════════════════════════════
Live numbers pulled from the Leads sheet.

Layout: 2x3 stat grid inside the panel

┌─────────────┬─────────────┐
│  Total       │  This Month │
│  Leads       │  New Leads  │
│  [47]        │  [8]        │
├─────────────┼─────────────┤
│  Enriched    │  Outreach   │
│  & Ready     │  Sent       │
│  [23]        │  [31]       │
├─────────────┼─────────────┤
│  High Score  │  Conversion │
│  Leads (≥7)  │  Rate       │
│  [12]        │  [14%]      │
└─────────────┴─────────────┘

Each stat cell:
  Large number: white 28px 600
  Label: 11px uppercase muted below
  Trend arrow: small ↑ green or ↓ red (vs last week)
  Click → opens full sheet view in a side drawer

Below stat grid:
  RECENT LEADS mini list (last 5 leads added):
  Each row: Company name · Show · Score badge (color-coded)
  [View all leads →] gold link at bottom


════════════════════════════════════════════
PANEL 3: OUTREACH STATUS (Woodpecker)
════════════════════════════════════════════
Campaign performance at a glance.

Top: active campaign name + status (ACTIVE / PAUSED / COMPLETE)

Metrics row:
  [Sent: 124] [Opened: 67 — 54%] [Replied: 11 — 8.9%] [Bounced: 3]
  Each metric: number bold + percentage muted below

Funnel visualization (simple horizontal bar):
  Sent ████████████████████ 124
  Opened ███████████ 67 (54%)
  Replied ██ 11 (8.9%)
  Interested █ 4 (3.2%)
  Gold bars, dark track, percentages right-aligned

Recent replies list (last 3):
  Company · Reply snippet (truncated) · [Classify →]
  [Classify →] triggers /salesreplies in AI chat for that contact

Bottom: [Run /outreachstatus →] gold button refreshes data
        [Run /salesreplies →] to process all pending replies


════════════════════════════════════════════
PANEL 4: DEADLINES TIMELINE (full width)
════════════════════════════════════════════
Visual timeline of all upcoming show deadlines.
Horizontal scrollable, today marked with a gold vertical line.

Timeline header: month labels, week markers
Timeline track: horizontal scrollable, each show = a horizontal bar

Each show bar:
  [Show Name] ━━━━━━━━━━━━━━━━━━ 
                │    │    │    │
              Portal Design Build Open

  Milestones as dots on the bar:
    ● Portal submission deadline
    ● Design approval deadline  
    ● Build start
    ★ Show open (star icon, larger)

  Bar color:
    Green: healthy, all deadlines >14 days away
    Amber: 1+ deadlines within 14 days
    Red: 1+ deadlines overdue or <3 days

  Hovering a milestone dot: tooltip with:
    Milestone name + exact date
    Days remaining (or "X days OVERDUE" in red)
    Client name
    [Remind client] button → triggers /reminders for that project

Today line: 2px gold vertical line spanning full height
  Label: "TODAY" in gold at top

LEFT of timeline: show names column (fixed, doesn't scroll)
RIGHT edge: [+ Add Deadline] button

BELOW TIMELINE: 3 quick stats in a row:
  [Shows this quarter: 4] [Overdue milestones: 1] [Due this week: 3]
  Amber/red coloring for non-zero warning values


════════════════════════════════════════════
SECONDARY PANELS (collapsed by default, 
user can expand from panel header)
════════════════════════════════════════════

DRIVE QUICK ACCESS:
  Search box: "Search files in Drive..."
  Recent files list (last 5): icon + filename + modified date
  Quick folder shortcuts: [Proposals] [Briefs] [Contracts] [Show Assets]
  Each folder: click → opens in Google Drive (new tab)
  [/findfile] button → asks AI to search Drive

LESSONS LEARNED SNAPSHOT:
  Last 3 lessons logged
  Each: project name · outcome (WON/LOST badge) · key lesson text
  [Log new lesson →] triggers /lesson in AI chat
  [View all →] opens full sheet

SYSTEM HEALTH PANEL (expanded version of the top bar dots):
  Service grid:
  ┌─────────────┬──────────────────────────────────────────┐
  │ Telegram Bot │ ● CONNECTED  Last msg: 4m ago  17 cmds  │
  │ Google Sheets│ ● OK         Last write: 2m ago         │
  │ Google Drive │ ● OK         Index: 247 files           │
  │ Anthropic API│ ● OK         Last call: 1m ago          │
  │ Trello       │ ● OK         4 boards · 28 cards        │
  │ Woodpecker   │ ● OK         1 active campaign          │
  │ Apollo       │ ● OK         Credits: 840 remaining     │
  └─────────────┴──────────────────────────────────────────┘
  Each row: service name · colored status dot · last activity · key metric
  Click any row → shows connection details + test button
  [Run /healthcheck →] gold button at bottom runs full system check


════════════════════════════════════════════
WORKSPACE CUSTOMIZATION
════════════════════════════════════════════
Top-right of workspace: [Customize Layout ⚙] button
Opens a panel configuration drawer:
  Checkboxes to show/hide each panel
  Drag handles to reorder panels
  [Reset to default] link
  Saved automatically per user (no backend needed — localStorage)


════════════════════════════════════════════
NAVIGATION TABS (global top bar update)
════════════════════════════════════════════
Add two tabs to the global top bar next to the logo:

  [AGENTS]    [WORKSPACE]    

Active tab: gold underline (2px), white text
Inactive: muted text, no underline
Transition between tabs: smooth 0.2s fade, no full page reload


════════════════════════════════════════════
COMPONENT NAMES FOR HANDOFF
════════════════════════════════════════════
KanbanBoard         stages[], cards[], onMoveCard(cardId, newStage)
KanbanCard          id, company, show, size, budget, dm, deadline, stage
StageSelector       stages[], currentStage, onSelect
LeadStatsGrid       stats: {total, thisMonth, enriched, outreachSent, highScore, convRate}
OutreachFunnel      sent, opened, replied, interested, bounced, campaignName
DeadlineTimeline    shows[]: {name, milestones[]: {type, date, status}}
MilestoneTooltip    name, date, daysUntil, client, onRemind
DrivePanel          recentFiles[], folders[], onSearch
LessonsPanel        lessons[], onAdd
SystemHealthGrid    services[]: {name, status, lastActivity, metric}
WorkspaceLayout     panels[], onCustomize

Data sources this panel connects to:
  GET /dashboard/api/agents         → SystemHealthGrid
  POST /dashboard/api/trigger       → all [Run →] buttons
  Trello data via Agent-16 (/crossboard) or direct REST
  Lead stats via Agent-06 (/status) result parsing
  Outreach stats via Agent-13 (/outreachstatus) result parsing
  Deadlines via Agent-05 (/deadlines) result parsing
  All data refreshes on Socket.IO "event" messages


════════════════════════════════════════════
DESIGN NOTES
════════════════════════════════════════════
- Workspace is READ + ACT, not just read-only
- Every data point has a clear action path (a button that does something)
- Gold highlights what needs attention: overdue items, stalled cards, warnings
- Muted gray for healthy/idle items — gold only earns its place
- Empty states for every panel: helpful, actionable, not just "No data"
- Panels never block each other — modals slide over, confirmations are inline
- All [Run →] buttons go through the same conflict-check system from Screen 1
