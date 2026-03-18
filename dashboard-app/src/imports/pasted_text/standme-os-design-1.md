Design a world-class AI operations web application called "StandMe OS."
This is the command center for StandMe — a premium exhibition stand design 
company — used daily by the CEO, Ops Lead, and Sub-Admin to run their 
entire business through 17 AI agents.

The goal is not just a beautiful dashboard. It must be:
→ Fast to learn on day one
→ Impossible to misuse or trigger the wrong thing by accident
→ Clear about what is happening at all times
→ Smart enough to guide the user toward the right action
→ Built for real professional daily use, not demos

════════════════════════════════════════════
1. BRAND IDENTITY
════════════════════════════════════════════
Personality: Premium industrial. Bloomberg terminal meets luxury architecture 
studio. Zero decoration for decoration's sake. Every element earns its place.

COLORS:
  --bg:          #0d0d0d   (base background — near black)
  --surface:     #1a1a1a   (cards, panels)
  --surface-2:   #222222   (raised elements, dropdowns)
  --surface-3:   #2a2a2a   (hover states)
  --border:      #2e2e2e   (default borders)
  --border-gold: #C9A84C   (active, focused, running)
  --gold:        #C9A84C   (primary accent — warm gold)
  --gold-dim:    rgba(201,168,76,0.12)  (subtle gold fill/glow)
  --gold-text:   #E8C97A   (gold on dark, slightly lighter for readability)
  --text:        #FFFFFF   (primary text)
  --text-2:      #c0c0c0   (secondary)
  --text-muted:  #707070   (timestamps, labels, hints)
  --green:       #22d3a5   (success, done)
  --red:         #f05c5c   (error, warning)
  --amber:       #f5c842   (pending approval)
  --blue:        #60a5fa   (Telegram events, info)

GOLD RULE: Gold covers max 10% of any component's visible area.
Use it for: borders when active/running, CTA buttons, key numbers, 
divider lines, icon strokes. Never for large fills or backgrounds.

TYPOGRAPHY:
  Primary: Inter
  Monospace (commands): "Cascadia Code" or "JetBrains Mono"
  Scale: 10 / 11 / 12 / 13 / 14 / 16 / 20 / 24px
  Weight: 400 body, 500 medium, 600 bold
  Section labels: 10px UPPERCASE TRACKED, color: --text-muted

SPACING BASE UNIT: 4px  (use 4/8/12/16/20/24/32/48)
BORDER RADIUS: 8px cards, 6px buttons/chips, 4px badges
SHADOWS: no colored shadows — only rgba(0,0,0,0.4) depth shadows


════════════════════════════════════════════
2. GLOBAL LAYOUT — 1440px desktop
════════════════════════════════════════════

┌──────────────┬───────────────────────────────┬────────────────┐
│  LEFT NAV    │      MAIN CONTENT              │  RIGHT PANEL   │
│   220px      │         flex                   │    400px       │
│              │                                │                │
│  Logo        │  [TOP BAR — system status]     │  Activity Feed │
│  Nav groups  │                                │  ─────────────│
│  Commands    │  [AGENT GRID — 2 cols]         │  AI Chat       │
│              │                                │                │
│  System bar  │                                │                │
└──────────────┴───────────────────────────────┴────────────────┘

GLOBAL TOP BAR (40px, spans full width above everything):
  Left:  "SM" gold monogram + "STANDME OS" wordmark
  Center: Global search bar (Cmd+K shortcut shown) — searches agents, 
          commands, and opens command palette
  Right: System health indicators in a row:
    [● Telegram Connected]  [● Sheets OK]  [● Drive OK]  [● API OK]
    Each dot: green=healthy, amber=degraded, red=error, gray=unchecked
    Click any indicator → shows tooltip with last check time + fix hint
    Then: [17 agents] [4 running] [0 errors] then user avatar + role badge


════════════════════════════════════════════
3. LEFT NAVIGATION
════════════════════════════════════════════
Background: #0d0d0d, right border: 1px solid #2e2e2e

TOP SECTION:
  Logo mark: gold square "SM" + "STANDME OS" text
  Below logo: slim gold horizontal rule (1px, 40% width)

COMMAND GROUPS — each group has:
  - Section header: 10px UPPERCASE MUTED (e.g. LEAD MANAGEMENT)
  - Command items below it

Each command item layout:
┌─────────────────────────────────────┐
│  [/cmd]  Label             [→]  [?] │
└─────────────────────────────────────┘
  [/cmd]  = monospace tag, gold color, 11px
  Label   = white 13px, what it does in 2-3 words
  [→]     = run button, appears on hover, gold arrow icon
  [?]     = info icon, appears on hover, opens tooltip

TOOLTIP on [?] hover — appears to the right of sidebar:
  Dark card (#222222), gold top border (2px)
  Title: command name
  What it does: 2 sentence description
  Inputs needed: "Requires: client name, show name" 
  Output: "Returns: Trello card + enriched contact"
  Typical time: "~15 seconds"
  Conflicts with: "Do not run while /enrich is active"
  [Run now →] gold button at bottom of tooltip

ACTIVE STATE: gold 2px left border, background #1a1a1a
RUNNING STATE: gold pulsing left border (animated), muted shimmer row
HOVER STATE: background lifts to #1f1f1f, show [→] and [?]

COMMAND GROUPS:
  ─ LEAD MANAGEMENT
    /newlead       Add a new lead
    /enrich        Find decision makers
    /brief         Generate concept brief
    /outreach      Send outreach emails
    /outreachstatus  View campaign stats

  ─ PIPELINE
    /status          Full pipeline view
    /deadlines       Upcoming deadlines
    /techdeadlines   Portal deadlines
    /reminders       Client follow-ups
    /movecard        Move pipeline stage

  ─ CONTENT & MARKETING
    /post            Social post
    /caption         Image caption
    /casestudy       Case study
    /contentplan     Weekly plan
    /campaign        Campaign copy

  ─ TEAM & OPERATIONS
    /contractors     View contractors
    /addcontractor   Add contractor
    /bookcontractor  Book contractor
    /lesson          Log lesson learned
    /crossboard      Cross-board sync check

  ─ INTELLIGENCE
    /ask             Ask the AI Brain
    /dealanalysis    Win/loss patterns
    /findfile        Search Drive
    /indexdrive      Re-index Drive
    /healthcheck     System check

BOTTOM OF SIDEBAR:
  System stats row: [47 runs today] [2 errors] [uptime: 3d 14h]
  Values in gold, labels in muted. Click opens System Log modal.


════════════════════════════════════════════
4. GLOBAL COMMAND PALETTE (Cmd+K)
════════════════════════════════════════════
This is the power-user feature. Pressing Cmd+K from anywhere opens a 
centered modal overlay (dark backdrop blur):

┌────────────────────────────────────────────────────┐
│  🔍  Search agents, commands, history...       [ESC]│
├────────────────────────────────────────────────────┤
│  SUGGESTED                                          │
│  ▶ /status     Pipeline Dashboard     agent run    │
│  ▶ /deadlines  Check Deadlines        agent run    │
│  ▶ Ask AI      Type a question        chat         │
├────────────────────────────────────────────────────┤
│  ALL COMMANDS                                       │
│  ▶ /newlead        Add new lead                    │
│  ▶ /enrich         Enrich pending leads            │
│  ... (scrollable list of all 17+ commands)         │
└────────────────────────────────────────────────────┘

Each row: icon (play for run, chat bubble for ask) + command + description 
+ category tag (right-aligned, muted)

Typing filters the list live. Enter = run the top result.
Arrow keys navigate. Tab autocompletes.
If a command is already RUNNING: row is dimmed + shows "Already running"


════════════════════════════════════════════
5. MAIN CONTENT — AGENT GRID
════════════════════════════════════════════
Background: #0d0d0d, padding 20px

TOP BAR:
  Left: "AGENTS" uppercase + agent count badge
  Center: Filter chips: [ALL] [RUNNING ●] [ERROR ●] [SCHEDULED]
  Right: View toggle: [Grid] [List] + Search input

AGENT CARD (grid view, 2 columns):
┌─────────────────────────────────────────────────────┐
│  AGENT-01                              ● IDLE        │
│                                                     │
│  Lead Intake & Qualification                        │
│  Score, filter, and qualify every incoming lead     │
│                                                     │
│  Last run: 2h ago  ·  2.1s  ·  47 runs  ·  0 errors│
│                                                     │
│  [/newlead]                                         │
│                                                     │
│  ─────────────────────────────────────────────────  │
│  Last result: ✓ 3 leads added, 1 flagged high-score │
└─────────────────────────────────────────────────────┘

Card details:
  - Agent number: 10px muted AGENT-01
  - Status pill top-right: see states below
  - Name: 16px 500 white
  - Description: 13px muted, single line
  - Stats row: timestamp | duration | run count | error count (all 11px muted)
  - Command chips: gold outlined monospace tags, clickable
  - Divider line (1px #2e2e2e)
  - Last result: 12px muted — shows last output summary (2 lines max)

STATUS PILL STATES:
  IDLE     — dark pill, muted text, gray dot
  RUNNING  — gold border + gold text + animated gold dot pulse
             card border: 2px gold
             card background: subtle warm tint #1c1a14
             animated shimmer sweep across top edge of card
             progress bar (indeterminate, gold) across card bottom
  ERROR    — red border + red text + red dot, card border red
  SCHEDULED— amber text "SCHEDULED" + next run time below

COMMAND CHIP click behavior:
  → Opens inline confirmation strip below the chip (NOT a new modal):
  ┌──────────────────────────────────────────────────┐
  │ Run /newlead now?   [Optional: add args...]  [✓ Run]  [✕] │
  └──────────────────────────────────────────────────┘
  Args input: pre-filled if command needs args, placeholder shows example.
  If another instance of this command is already RUNNING: 
  chip is disabled + tooltip "Already running — wait for it to finish"

LIST VIEW (toggle):
  Compact table: | Agent | Status | Last Run | Duration | Runs | Errors | Commands |
  Sortable columns, same color states

QUICK ACTIONS BAR (above grid, below top bar):
  5 most-used commands as large icon buttons in a row:
  [📋 Status] [⏰ Deadlines] [👤 New Lead] [✉ Outreach] [🧠 Ask AI]
  Each: gold icon + label, dark button, hover lifts with gold border


════════════════════════════════════════════
6. RIGHT PANEL — ACTIVITY FEED + AI CHAT
════════════════════════════════════════════
Background: #111111, left border: 1px solid #2e2e2e

── SECTION A: LIVE ACTIVITY FEED (top, ~38% height) ──

Header row:
  Left: "LIVE ACTIVITY" uppercase muted + animated gold live dot
  Right: [Filter ▾] [Clear] [↕ Collapse]

Filter dropdown (when clicked):
  Checkboxes: ☑ Agent runs  ☑ Errors  ☑ Approvals  ☑ Telegram  ☑ System
  Applied filter shows count badge on Filter button

Feed list (auto-scroll, newest bottom):
Each item row:
  [time] [●] [agent name] [message]   max 2 lines
  
  ● dot color by type:
    agent:start  → gold    "▶ Lead Intake running (/newlead args...)"
    agent:end    → green   "✓ Lead Intake done — 1.8s · 2 leads added"
    agent:error  → red     "✗ Outreach failed — API rate limit"
    approval     → amber   "⏳ Approval needed — /outreach waiting for Mo"
    telegram     → blue    "📱 @Mo (Admin) sent /status"
    system       → muted   "ℹ System started — 17 agents loaded"

  Clicking any event row expands it to show full output (max 300 chars)
  Expandable with smooth animate-height transition

  Telegram events show: who sent it, what command, what role — makes it 
  easy to see if someone is running something from phone vs dashboard

  Empty state: 
  ┌──────────────────┐
  │ No activity yet  │
  │ Run any command  │
  │ to see it here → │
  └──────────────────┘

Gold horizontal divider line between feed and chat sections

── SECTION B: AI CHAT (bottom, ~62% height) ──

Header:
  Left: Gold avatar circle "AI" + "STANDME AI" in white + 
        "Connected to 17 agents" in muted
  Right: [History ▾] [Clear] [Fullscreen ⤢]

Chat thread (scrollable):
  User message: right-aligned
    Container: #1f1d15 background, gold-tinted border (1px #3d3520)
    Text: white, RTL if Arabic
    
  AI message: left-aligned  
    Container: #1a1a1a, no border
    Avatar: gold circle "AI" left of bubble
    Text renders markdown:
      **bold**, bullet points, numbered lists
      Code/commands: monospace on #0d0d0d, gold text
      > blockquotes: gold left border
    
  Streaming state: text appears word by word, blinking gold cursor at end
  
  Agent trigger inline notification (appears inside AI bubble when it runs):
  ┌──────────────────────────────────────────┐
  │ ⚡ Running /status...                     │
  │ ████████░░░░░░░░  (animated gold bar)    │
  └──────────────────────────────────────────┘
  Replaced by result summary when done:
  ┌──────────────────────────────────────────┐
  │ ✓ Status Agent — done in 3.1s            │
  │ 12 active projects, 2 overdue...  [full] │
  └──────────────────────────────────────────┘
  
  Typing indicator: 3 pulsing gold dots in a bubble

  Smart suggestions strip (appears when chat is empty / just opened):
  Horizontally scrollable suggestion chips:
  [What's overdue?] [How are leads doing?] [Run a status check] 
  [Any approvals pending?] [Show deadlines this week]
  Gold outlined chips, clicking fills the input

CHAT INPUT:
  Container: #1a1a1a, gold border on focus (2px)
  Multi-line textarea: auto-expands up to 5 lines
  Placeholder: "Ask anything — Arabic or English   اسأل أي شيء"
  
  Below textarea in a single row:
    Left: [📎 Attach args] — for commands with parameters
    Center: muted "Shift+Enter for new line  ·  Cmd+K for commands"
    Right: [Send →] — solid gold button, black text

  Arabic auto-detection: when Arabic chars detected, input goes RTL 
  with right-aligned text and right-to-left placeholder


════════════════════════════════════════════
7. APPROVAL WORKFLOW UI
════════════════════════════════════════════
When an agent requests approval (waits for Mo), a banner appears:

TOP of right panel (pushes content down, gold background):
┌────────────────────────────────────────────────────────┐
│  ⏳  Outreach Agent is waiting for your approval       │
│  "Send 3 emails to pharma leads for Arab Health 2025"  │
│  [View full details]          [✕ Reject]  [✓ Approve] │
└────────────────────────────────────────────────────────┘
Gold background (#2a2100), amber border top. 
Approve button: green. Reject: red outline.
Clicking [View full details] expands to show full email drafts / action list.

Also: agent card in grid shows "WAITING" pill (amber) and pulsing amber border.


════════════════════════════════════════════
8. CONFLICT PREVENTION SYSTEM
════════════════════════════════════════════
Design these specific UI states to prevent user mistakes:

A. AGENT ALREADY RUNNING
   Command chip: 50% opacity, lock icon, cursor: not-allowed
   Tooltip on hover: "Already running since 2:14pm — started by @Mo via Telegram"
   
B. DEPENDENT AGENT BLOCKED
   Example: /brief requires /enrich to have run first
   Command chip: amber outline instead of gold
   Tooltip: "Run /enrich first — no enriched leads available for this brief"

C. DESTRUCTIVE COMMAND CONFIRMATION
   Commands like /indexdrive, /crossboard (large operations):
   Double confirmation: "This will re-index the entire Drive (200+ files). 
   It takes ~3 minutes. Sure?" with a checkbox: 
   "☐ I understand this will run for several minutes"
   Confirm button stays disabled until checkbox is ticked.

D. PARALLEL RUN WARNING
   If user tries to run 4+ agents at once:
   Toast: "3 agents already running. Running more may slow responses. Continue?"

E. COMMAND ARGS VALIDATION
   For commands needing specific input (/brief Arab Health):
   Input shows placeholder examples + format guide:
   "/brief [client name] [show name]  e.g. /brief Siemens Hannover Messe"
   Red border + hint text if format looks wrong before submit.


════════════════════════════════════════════
9. KEYBOARD SHORTCUTS
════════════════════════════════════════════
Show a keyboard shortcut overlay (press ? anywhere):

┌────────────────────────────────────────────────────┐
│  KEYBOARD SHORTCUTS                           [ESC] │
├────────────────┬───────────────────────────────────┤
│  Cmd+K         │  Command palette                  │
│  Cmd+Enter     │  Send chat message                │
│  Cmd+L         │  Clear chat                       │
│  Cmd+/         │  Focus chat input                 │
│  Esc           │  Close modals / cancel             │
│  1-9           │  Quick-jump to agent card 1-9     │
│  R             │  Refresh agent statuses            │
│  ?             │  This shortcut sheet               │
└────────────────┴───────────────────────────────────┘
Dark modal, gold accents on key labels, blur backdrop.


════════════════════════════════════════════
10. ADDITIONAL SCREENS & STATES
════════════════════════════════════════════

LOGIN PAGE:
  Full black screen
  Centered card (400px wide, #1a1a1a)
  "SM" gold monogram large at top
  "STANDME OS" white wordmark
  Subtitle: "Operations Intelligence Platform"
  Password input: dark, gold focus border
  [Login] gold button full-width
  No register, no forgot password — this is internal only

LOADING STATE (on first connect):
  Skeleton cards in agent grid — dark shimmer animation
  Right panel shows: "Connecting to StandMe OS..." with animated gold dot
  
DISCONNECTED STATE:
  Thin red banner at top: "● Connection lost — reconnecting..."
  Agent cards show dimmed state, no status updates

FULL AGENT DETAIL PANEL (click agent card → right slide-over):
  Slide in from right, 480px wide, dark overlay behind
  Shows:
    Agent name + full description
    Full run history (last 20 runs with time, duration, result)
    Last output (full text, scrollable)
    Schedule info (if scheduled: next run countdown)
    All available commands with full descriptions
    [Run now →] gold CTA at bottom
    [Close ✕] top right

SYSTEM LOG MODAL (click bottom stats bar):
  Full-screen overlay
  Table: timestamp | agent | action | detail | result
  Filter by: agent, result (success/fail), date range
  Export as CSV button (top right)

MOBILE (768px breakpoint):
  Sidebar collapses to 48px icon strip with gold tooltips on hover
  Main grid goes single column
  Right panel becomes bottom drawer (tap "Activity" or "Chat" tabs to switch)
  Quick actions bar scrolls horizontally


════════════════════════════════════════════
11. MICRO-INTERACTIONS & POLISH
════════════════════════════════════════════
These details make it feel genuinely premium:

- Agent card RUNNING: top edge has animated gold light sweep (keyframe, 1.5s loop)
- Chat send button: brief gold pulse on send, returns to normal
- Activity feed new item: subtle slide-in from right + fade-in
- Status pills: smooth color transition (0.2s ease) between states  
- Cmd+K palette: backdrop blur + scale-in animation (0.15s)
- Sidebar hover: 0.1s ease background transition
- Approval banner: slides down from top (not a popup)
- Gold dot indicators: slow pulse animation (2s cycle, opacity 0.4→1→0.4)
- Tooltips: 120ms delay before showing, 80ms fade in
- All card borders on hover: smooth 0.15s transition to #3a3a3a
- Number counters (runs, errors): animate when they change (brief gold flash)

Toast notifications (top-right, stacked):
  Success: green left border, dark bg, auto-dismiss 4s
  Error: red left border, NO auto-dismiss (must close manually)
  Info: gold left border, auto-dismiss 3s
  All: slide in from right, slide out on dismiss


════════════════════════════════════════════
12. COMPONENT NAMING FOR HANDOFF
════════════════════════════════════════════
Name components exactly as shown — maps directly to live backend:

  AgentCard           id, name, state, lastRun, duration, runCount, errorCount, commands, lastResult
  AgentStatusPill     state: 'idle'|'running'|'error'|'scheduled'|'waiting'
  CommandChip         command, isRunning, isBlocked, blockReason, onClick
  CommandTooltip      command, description, inputs, output, duration, conflictsWith
  ActivityFeedItem    type, agentId, agentName, message, timestamp, expandedContent
  ChatBubble          role, content, isStreaming, isRTL, agentTriggers[]
  AgentTriggerCard    command, state: 'running'|'done'|'error', result, duration
  ApprovalBanner      agentName, action, details, onApprove, onReject
  CommandPalette      isOpen, query, results[], onSelect
  SystemHealthDot     service, status: 'ok'|'degraded'|'error', lastCheck
  QuickActionsBar     actions[]
  SuggestionChips     suggestions[], onSelect
  AgentDetailPanel    isOpen, agent, runHistory[], onClose, onRun
  ShortcutOverlay     isOpen

Backend sockets (Socket.IO at /ws):
  RECEIVE: init, event, stats, agents, chat:welcome, chat:chunk, 
           chat:done, chat:typing, chat:agent_start, chat:agent_done, chat:error
  SEND:    chat:send, chat:history, chat:clear

Backend REST (/dashboard/api/):
  GET  /agents          → AgentCard data
  GET  /logs            → ActivityFeedItem data  
  GET  /stats           → SystemHealthDot + header stats
  GET  /agent-configs   → CommandTooltip data
  POST /trigger         → { command, args } → run any agent


════════════════════════════════════════════
OUTPUT SPEC
════════════════════════════════════════════
- Dark mode only, no light mode toggle needed
- 1440px desktop primary canvas
- 768px mobile breakpoint
- All components use auto-layout with proper resizing constraints
- Full design token library matching the color system above
- Every interactive state designed: default, hover, active, focus, 
  disabled, loading, error
- No stock photos, no illustrations, no gradients on backgrounds
- Spacing system: 4px base unit only
- Export frame names match component names above exactly
