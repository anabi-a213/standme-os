import { motion, AnimatePresence } from 'motion/react';
import { Play, Info, X } from 'lucide-react';
import { useState } from 'react';
import type { AgentConfig } from '../../lib/api';

interface CommandGroup {
  title: string;
  commands: {
    id: string;
    label: string;
    description: string;
    schedule?: string | null;
  }[];
}

interface LeftSidebarProps {
  onCommandClick: (command: string) => void;
  runningCommands: string[];
  agentConfigs: AgentConfig[];
  isMobile?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

const COMMAND_INFO: Record<string, { what: string; when: string; output: string }> = {
  '/newlead':        { what: 'Add a new prospect lead to the pipeline', when: 'When you get a new enquiry or referral', output: 'Creates Trello card + logs to Leads sheet' },
  '/enrich':         { what: 'Finds DMs, LinkedIn & contact info for pending leads', when: 'After /newlead — before outreach', output: 'Updates Leads sheet with enriched contact data' },
  '/brief':          { what: 'Generates a full AI concept brief for a client', when: 'After a lead is qualified and agreed in principle', output: 'Brief PDF + summary sent via Telegram' },
  '/outreach':       { what: 'Sends personalised outreach sequences via Woodpecker', when: 'When starting a cold email campaign', output: 'Campaigns launched in Woodpecker' },
  '/outreachstatus': { what: 'Shows open rates, replies, and bounce stats', when: 'To monitor active campaigns', output: 'Live stats report from Woodpecker API' },
  '/discover':       { what: 'Finds and scores new prospects for a target show', when: 'Before starting a new outreach campaign', output: 'Prospect list saved to Sheets' },
  '/campaigns':      { what: 'Lists all active outreach campaigns and their status', when: 'For a quick campaign overview', output: 'Campaign summary report' },
  '/status':         { what: 'Full pipeline view — all Trello projects by stage', when: 'Daily check-in on all active projects', output: 'Stage-by-stage project report' },
  '/deadlines':      { what: 'Flags overdue and imminent deadlines across all Trello boards', when: 'Morning briefing or before client calls', output: 'Colour-coded deadline list' },
  '/reminders':      { what: 'Sends automated follow-up reminders to clients', when: 'When clients go quiet or payments are due', output: 'Reminder messages sent via Telegram' },
  '/movecard':       { what: 'Moves a Trello card to a different pipeline stage', when: 'After a project milestone is reached', output: 'Card moved in Trello' },
  '/crossboard':     { what: 'Cross-checks all Trello boards for conflicts or blockers', when: 'Weekly review or before planning a new project', output: 'Conflict report across all boards' },
  '/techdeadlines':  { what: 'Tracks portal submissions, build deadlines, and venue cutoffs', when: 'For technical or production milestones', output: 'Technical deadline report' },
  '/post':           { what: 'Generates a social media post for a show or project', when: 'Before posting on Instagram/LinkedIn', output: 'Ready-to-publish post draft' },
  '/caption':        { what: 'Creates a photo caption for a specific image or project', when: 'When uploading project photos', output: 'Caption draft' },
  '/campaign':       { what: 'Builds a full marketing campaign plan for a show', when: 'At the start of a new project marketing push', output: 'Campaign brief + content calendar' },
  '/casestudy':      { what: 'Writes a case study from a completed project', when: 'After project completion', output: 'Case study document saved to Drive' },
  '/portfolio':      { what: 'Updates the portfolio with a new completed project', when: 'After project wrap-up', output: 'Portfolio entry created' },
  '/insight':        { what: 'Generates a thought-leadership insight post', when: 'For regular industry content', output: 'Insight post draft' },
  '/contentplan':    { what: 'Creates a weekly content calendar across all channels', when: 'At the start of each week', output: 'Content plan in Sheets' },
  '/contractors':    { what: 'Lists all contractors with skills and availability', when: 'When booking crew for a project', output: 'Contractor list from Sheets' },
  '/addcontractor':  { what: 'Adds a new contractor to the system', when: 'After meeting a new supplier or freelancer', output: 'Contractor added to Sheets' },
  '/bookcontractor': { what: 'Books a contractor for a specific project and date', when: 'When you need to confirm crew', output: 'Booking logged + confirmation sent' },
  '/lesson':         { what: 'Records a lesson learned from a project or incident', when: 'After any significant success or failure', output: 'Lesson saved to Knowledge Base' },
  '/dealanalysis':   { what: 'Analyses won/lost deals and surfaces patterns', when: 'Weekly or after closing/losing a deal', output: 'Deal analysis report' },
  '/ask':            { what: 'Ask the AI Brain any question about clients, projects, or the business', when: 'Anytime you need a quick answer', output: 'AI response from Knowledge Base' },
  '/brain':          { what: 'Daily morning briefing — pipeline, deadlines, priorities', when: 'Scheduled every morning at 8am', output: 'Briefing sent via Telegram' },
  '/findfile':       { what: 'Searches Drive for any file by name or description', when: 'When you need a document quickly', output: 'File link(s) returned' },
  '/indexdrive':     { what: 'Re-indexes all Drive files into the Knowledge Base', when: 'After major file reorganisation', output: 'Drive index updated' },
  '/healthcheck':    { what: 'Verifies all integrations: Sheets, Drive, Telegram, Woodpecker', when: 'When something seems wrong', output: 'Status report for all services' },
  '/newcampaign':    { what: 'Builds a full Woodpecker campaign for a target show', when: 'Starting a new targeted outreach', output: 'Campaign created in Woodpecker' },
  '/salesreplies':   { what: 'Processes campaign replies and runs the sales follow-up loop', when: 'When campaign replies come in', output: 'Replies handled and logged' },
  '/campaignstatus': { what: 'Shows the current status of a specific show campaign', when: 'Mid-campaign check', output: 'Campaign progress report' },
  '/newprojectfolder': { what: 'Creates a new project folder structure in Drive', when: 'When a new project is approved', output: 'Folder structure created in Drive' },
  '/setupdrive':     { what: 'Sets up the full Drive folder structure for StandMe OS', when: 'Initial setup only', output: 'All Drive folders created and linked' },
};

const LEAD_COMMANDS     = ['/newlead', '/enrich', '/brief', '/outreach', '/outreachstatus', '/discover', '/campaigns'];
const PIPELINE_COMMANDS = ['/status', '/deadlines', '/reminders', '/movecard', '/cardmove', '/crossboard', '/techdeadlines'];
const CONTENT_COMMANDS  = ['/post', '/caption', '/campaign', '/casestudy', '/portfolio', '/insight', '/contentplan'];
const TEAM_COMMANDS     = ['/contractors', '/addcontractor', '/bookcontractor', '/lesson', '/addlesson', '/dealanalysis'];
const INTEL_COMMANDS    = ['/ask', '/brain', '/findfile', '/indexdrive', '/readfile', '/knowledge', '/healthcheck', '/seedknowledge'];
const CAMPAIGN_COMMANDS = ['/newcampaign', '/salesreplies', '/campaignstatus', '/indexwoodpecker', '/newprojectfolder', '/newshowfolder', '/setupdrive', '/foldertree', '/shareallfiles'];

function buildCommandGroups(agentConfigs: AgentConfig[]): CommandGroup[] {
  const groups: Record<string, CommandGroup> = {
    'LEAD MANAGEMENT':   { title: 'LEAD MANAGEMENT',   commands: [] },
    'PIPELINE':          { title: 'PIPELINE',           commands: [] },
    'CONTENT & MARKETING': { title: 'CONTENT & MARKETING', commands: [] },
    'TEAM & OPERATIONS': { title: 'TEAM & OPERATIONS', commands: [] },
    'INTELLIGENCE':      { title: 'INTELLIGENCE',       commands: [] },
    'CAMPAIGNS & DRIVE': { title: 'CAMPAIGNS & DRIVE', commands: [] },
  };

  for (const config of agentConfigs) {
    for (const cmd of config.commands) {
      const entry = { id: cmd, label: config.name, description: config.description, schedule: config.schedule };
      if (LEAD_COMMANDS.includes(cmd))          groups['LEAD MANAGEMENT'].commands.push(entry);
      else if (PIPELINE_COMMANDS.includes(cmd)) groups['PIPELINE'].commands.push(entry);
      else if (CONTENT_COMMANDS.includes(cmd))  groups['CONTENT & MARKETING'].commands.push(entry);
      else if (TEAM_COMMANDS.includes(cmd))     groups['TEAM & OPERATIONS'].commands.push(entry);
      else if (INTEL_COMMANDS.includes(cmd))    groups['INTELLIGENCE'].commands.push(entry);
      else if (CAMPAIGN_COMMANDS.includes(cmd)) groups['CAMPAIGNS & DRIVE'].commands.push(entry);
      else                                      groups['INTELLIGENCE'].commands.push(entry);
    }
  }

  const populated = Object.values(groups).filter(g => g.commands.length > 0);
  if (populated.length === 0) {
    return [
      {
        title: 'LEAD MANAGEMENT',
        commands: [
          { id: '/newlead', label: 'Add a new lead',       description: 'Score, filter, and qualify every incoming lead' },
          { id: '/enrich',  label: 'Find decision makers', description: 'Enrich leads with contact information' },
          { id: '/brief',   label: 'Generate concept brief',description: 'Create detailed project briefs' },
          { id: '/outreach',label: 'Send outreach emails', description: 'Automated email campaigns' },
        ],
      },
      {
        title: 'PIPELINE',
        commands: [
          { id: '/status',    label: 'Full pipeline view',   description: 'Complete overview of all active projects' },
          { id: '/deadlines', label: 'Upcoming deadlines',   description: 'Track critical dates and milestones' },
          { id: '/reminders', label: 'Client follow-ups',    description: 'Automated reminder system' },
        ],
      },
      {
        title: 'INTELLIGENCE',
        commands: [
          { id: '/ask',         label: 'Ask the AI Brain', description: 'Query the intelligent knowledge base' },
          { id: '/findfile',    label: 'Search Drive',     description: 'Find files across all storage' },
          { id: '/healthcheck', label: 'System check',     description: 'Verify all systems are operational' },
        ],
      },
    ];
  }
  return populated;
}

export function LeftSidebar({ onCommandClick, runningCommands, agentConfigs, isMobile, isOpen, onClose }: LeftSidebarProps) {
  const [hoveredCommand, setHoveredCommand] = useState<string | null>(null);
  const [activeInfo, setActiveInfo] = useState<string | null>(null);

  const isRunning = (commandId: string) => runningCommands.includes(commandId);
  const commandGroups = buildCommandGroups(agentConfigs);

  const toggleInfo = (e: React.MouseEvent, commandId: string) => {
    e.stopPropagation();
    setActiveInfo(prev => prev === commandId ? null : commandId);
  };

  const handleCommandClick = (cmd: string) => {
    setActiveInfo(null);
    onCommandClick(cmd);
    if (isMobile && onClose) onClose();
  };

  // Mobile: slide-in overlay
  if (isMobile) {
    return (
      <>
        <div className={`mobile-backdrop ${isOpen ? 'open' : ''}`} onClick={onClose} />
        <div
          className="fixed left-0 top-0 z-50 h-full w-[280px] border-r border-[var(--border-subtle)] bg-[var(--surface)] transition-transform duration-300 ease-out overflow-hidden"
          style={{ transform: isOpen ? 'translateX(0)' : 'translateX(-100%)' }}
        >
          <div className="flex h-full flex-col pt-[var(--topbar-height)]">
            {/* Command groups — scrollable */}
            <div className="flex-1 overflow-y-auto px-3 py-4 overscroll-contain">
              <div className="space-y-5">
                {commandGroups.map((group) => (
                  <div key={group.title}>
                    <div className="mb-2 px-2">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{group.title}</h3>
                    </div>
                    <div className="space-y-1">
                      {group.commands.map((command) => {
                        const running = isRunning(command.id);
                        return (
                          <button
                            key={command.id}
                            onClick={() => handleCommandClick(command.id)}
                            className={`relative w-full rounded-lg px-3 py-3 text-left min-h-[44px] transition-colors ${
                              running ? 'bg-[var(--gold-dim)] border-l-2 border-l-[var(--gold)]' : 'active:bg-[var(--surface-2)]'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className={`font-mono text-sm font-medium ${running ? 'text-[var(--gold-bright)]' : 'text-[var(--gold)]'}`}>
                                {command.id}
                              </span>
                              {running && <span className="h-2 w-2 rounded-full bg-[var(--gold)] animate-pulse" />}
                            </div>
                            <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{command.description}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Status bar */}
            <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-2)]/50 px-4 py-3">
              <div className="flex items-center gap-2 rounded-md bg-[var(--surface-3)] px-2 py-1.5">
                <div className="h-2 w-2 rounded-full bg-[var(--success)] animate-pulse" />
                <span className="text-[11px] text-[var(--text-muted)]">System Online</span>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // Desktop: fixed sidebar
  return (
    <div className="fixed left-0 top-[var(--topbar-height)] z-40 h-[calc(100vh-var(--topbar-height))] w-[var(--sidebar-width)] border-r border-[var(--border-subtle)] bg-[var(--surface)]/80 backdrop-blur-xl">
      <div className="flex h-full flex-col">
        {/* Logo section */}
        <div className="border-b border-[var(--border-subtle)] px-4 pb-3 pt-4">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="mb-2 flex items-center justify-center"
          >
            <img
              src="/dashboard/standme-logo.png"
              alt="StandMe Group"
              className="h-10 w-auto object-contain"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                if (fallback) fallback.style.display = 'flex';
              }}
            />
            {/* Fallback */}
            <div className="hidden h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--gold)] to-[var(--gold-bright)]">
              <span className="font-mono text-base font-bold text-black">SM</span>
            </div>
          </motion.div>
          <div className="mx-auto h-px w-[60%] bg-gradient-to-r from-transparent via-[var(--gold)] to-transparent opacity-40" />
        </div>

        {/* Command groups */}
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <div className="space-y-6">
            {commandGroups.map((group, groupIndex) => (
              <motion.div
                key={group.title}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: groupIndex * 0.1 }}
              >
                {/* Group header */}
                <div className="mb-2 px-2">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    {group.title}
                  </h3>
                </div>

                {/* Commands */}
                <div className="space-y-0.5">
                  {group.commands.map((command) => {
                    const running = isRunning(command.id);
                    const infoOpen = activeInfo === command.id;
                    const info = COMMAND_INFO[command.id];

                    return (
                      <div
                        key={command.id}
                        className="relative"
                        onMouseEnter={() => setHoveredCommand(command.id)}
                        onMouseLeave={() => setHoveredCommand(null)}
                      >
                        <motion.button
                          onClick={() => {
                            setActiveInfo(null);
                            onCommandClick(command.id);
                          }}
                          className={`group relative w-full overflow-hidden rounded-lg px-3 py-2.5 text-left transition-all duration-200 ${
                            running
                              ? 'bg-[var(--gold-dim)] border-l-2 border-l-[var(--gold)]'
                              : infoOpen
                              ? 'bg-[var(--surface-2)] rounded-b-none'
                              : 'hover:bg-[var(--surface-2)]'
                          }`}
                          whileHover={{ x: 2 }}
                          whileTap={{ scale: 0.98 }}
                        >
                          {running && (
                            <motion.div
                              className="absolute inset-0 bg-gradient-to-r from-transparent via-[var(--gold-glow)] to-transparent"
                              animate={{ x: ['-100%', '200%'] }}
                              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                            />
                          )}

                          <div className="relative flex items-center gap-2">
                            <span className={`font-mono text-xs font-medium transition-colors ${
                              running ? 'text-[var(--gold-bright)]' : 'text-[var(--gold)]'
                            }`}>
                              {command.id}
                            </span>

                            {running && (
                              <motion.div
                                className="h-1.5 w-1.5 rounded-full bg-[var(--gold)]"
                                animate={{ scale: [1, 1.2, 1], opacity: [1, 0.5, 1] }}
                                transition={{ duration: 1, repeat: Infinity }}
                              />
                            )}

                            {/* Hover actions */}
                            {hoveredCommand === command.id && !running && (
                              <motion.div
                                className="ml-auto flex items-center gap-1"
                                initial={{ opacity: 0, x: -6 }}
                                animate={{ opacity: 1, x: 0 }}
                              >
                                {/* Run */}
                                <div
                                  title="Run this command"
                                  className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--gold)] cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveInfo(null);
                                    onCommandClick(command.id);
                                  }}
                                >
                                  <Play className="h-3 w-3" />
                                </div>
                                {/* Info toggle */}
                                <div
                                  title="What does this do?"
                                  className={`rounded p-1 transition-colors cursor-pointer ${
                                    infoOpen
                                      ? 'bg-[var(--gold-dim)] text-[var(--gold)]'
                                      : 'text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]'
                                  }`}
                                  onClick={(e) => toggleInfo(e, command.id)}
                                >
                                  <Info className="h-3 w-3" />
                                </div>
                              </motion.div>
                            )}

                            {/* If info is open and not hovered, show close icon */}
                            {infoOpen && hoveredCommand !== command.id && (
                              <div
                                className="ml-auto rounded p-1 text-[var(--gold)] cursor-pointer hover:bg-[var(--gold-dim)]"
                                onClick={(e) => { e.stopPropagation(); setActiveInfo(null); }}
                              >
                                <X className="h-3 w-3" />
                              </div>
                            )}
                          </div>

                          <div className="mt-1 text-xs text-[var(--text-secondary)]">
                            {command.description}
                          </div>

                          {command.schedule && (
                            <div className="mt-0.5 font-mono text-[10px] text-[var(--warning)]">
                              ⏰ {command.schedule}
                            </div>
                          )}
                        </motion.button>

                        {/* Info tooltip panel */}
                        <AnimatePresence>
                          {infoOpen && (
                            <motion.div
                              key={`info-${command.id}`}
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.15 }}
                              className="overflow-hidden rounded-b-lg border border-t-0 border-[var(--gold)]/20 bg-[var(--surface-3)]"
                            >
                              <div className="px-3 py-2.5 space-y-2">
                                {info ? (
                                  <>
                                    <div>
                                      <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--gold)]">What it does</div>
                                      <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">{info.what}</p>
                                    </div>
                                    <div>
                                      <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">When to use</div>
                                      <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">{info.when}</p>
                                    </div>
                                    <div>
                                      <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Output</div>
                                      <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">{info.output}</p>
                                    </div>
                                  </>
                                ) : (
                                  <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                                    {command.description}
                                  </p>
                                )}
                                {command.schedule && (
                                  <div className="flex items-center gap-1.5 rounded-md border border-[var(--warning)]/20 bg-[var(--surface-2)] px-2 py-1">
                                    <span className="text-[10px] text-[var(--warning)]">⏰ Auto-scheduled:</span>
                                    <span className="font-mono text-[10px] text-[var(--warning)]">{command.schedule}</span>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* System status bar */}
        <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-2)]/50 px-4 py-4">
          <div className="flex items-center gap-2 rounded-md bg-[var(--surface-3)] px-2 py-1.5">
            <div className="h-2 w-2 rounded-full bg-[var(--success)]" style={{ animation: 'pulse-glow 2s ease-in-out infinite' }} />
            <span className="text-[10px] text-[var(--text-muted)]">System Online</span>
          </div>
        </div>
      </div>
    </div>
  );
}
