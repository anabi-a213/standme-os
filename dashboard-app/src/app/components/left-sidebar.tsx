import { motion } from 'motion/react';
import { Play, Info } from 'lucide-react';
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
}

const LEAD_COMMANDS = ['/newlead', '/enrich', '/brief', '/outreach', '/outreachstatus', '/discover', '/campaigns'];
const PIPELINE_COMMANDS = ['/status', '/deadlines', '/reminders', '/movecard', '/cardmove', '/crossboard', '/techdeadlines'];
const CONTENT_COMMANDS = ['/post', '/caption', '/campaign', '/casestudy', '/portfolio', '/insight', '/contentplan'];
const TEAM_COMMANDS = ['/contractors', '/addcontractor', '/bookcontractor', '/lesson', '/addlesson', '/dealanalysis'];
const INTEL_COMMANDS = ['/ask', '/brain', '/findfile', '/indexdrive', '/readfile', '/knowledge', '/healthcheck', '/seedknowledge'];
const CAMPAIGN_COMMANDS = ['/newcampaign', '/salesreplies', '/campaignstatus', '/indexwoodpecker', '/newprojectfolder', '/newshowfolder', '/setupdrive', '/foldertree', '/shareallfiles'];

function buildCommandGroups(agentConfigs: AgentConfig[]): CommandGroup[] {
  const groups: Record<string, CommandGroup> = {
    'LEAD MANAGEMENT': { title: 'LEAD MANAGEMENT', commands: [] },
    'PIPELINE': { title: 'PIPELINE', commands: [] },
    'CONTENT & MARKETING': { title: 'CONTENT & MARKETING', commands: [] },
    'TEAM & OPERATIONS': { title: 'TEAM & OPERATIONS', commands: [] },
    'INTELLIGENCE': { title: 'INTELLIGENCE', commands: [] },
    'CAMPAIGNS & DRIVE': { title: 'CAMPAIGNS & DRIVE', commands: [] },
  };

  for (const config of agentConfigs) {
    for (const cmd of config.commands) {
      const entry = { id: cmd, label: config.name, description: config.description, schedule: config.schedule };
      if (LEAD_COMMANDS.includes(cmd)) {
        groups['LEAD MANAGEMENT'].commands.push(entry);
      } else if (PIPELINE_COMMANDS.includes(cmd)) {
        groups['PIPELINE'].commands.push(entry);
      } else if (CONTENT_COMMANDS.includes(cmd)) {
        groups['CONTENT & MARKETING'].commands.push(entry);
      } else if (TEAM_COMMANDS.includes(cmd)) {
        groups['TEAM & OPERATIONS'].commands.push(entry);
      } else if (INTEL_COMMANDS.includes(cmd)) {
        groups['INTELLIGENCE'].commands.push(entry);
      } else if (CAMPAIGN_COMMANDS.includes(cmd)) {
        groups['CAMPAIGNS & DRIVE'].commands.push(entry);
      } else {
        // Put unmatched into INTELLIGENCE as fallback
        groups['INTELLIGENCE'].commands.push(entry);
      }
    }
  }

  // Only return non-empty groups, fallback to static if no configs loaded
  const populated = Object.values(groups).filter(g => g.commands.length > 0);
  if (populated.length === 0) {
    return [
      {
        title: 'LEAD MANAGEMENT',
        commands: [
          { id: '/newlead', label: 'Add a new lead', description: 'Score, filter, and qualify every incoming lead' },
          { id: '/enrich', label: 'Find decision makers', description: 'Enrich leads with contact information' },
          { id: '/brief', label: 'Generate concept brief', description: 'Create detailed project briefs' },
          { id: '/outreach', label: 'Send outreach emails', description: 'Automated email campaigns' },
        ],
      },
      {
        title: 'PIPELINE',
        commands: [
          { id: '/status', label: 'Full pipeline view', description: 'Complete overview of all active projects' },
          { id: '/deadlines', label: 'Upcoming deadlines', description: 'Track critical dates and milestones' },
          { id: '/reminders', label: 'Client follow-ups', description: 'Automated reminder system' },
        ],
      },
      {
        title: 'INTELLIGENCE',
        commands: [
          { id: '/ask', label: 'Ask the AI Brain', description: 'Query the intelligent knowledge base' },
          { id: '/findfile', label: 'Search Drive', description: 'Find files across all storage' },
          { id: '/healthcheck', label: 'System check', description: 'Verify all systems are operational' },
        ],
      },
    ];
  }
  return populated;
}

export function LeftSidebar({ onCommandClick, runningCommands, agentConfigs }: LeftSidebarProps) {
  const [hoveredCommand, setHoveredCommand] = useState<string | null>(null);

  const isRunning = (commandId: string) => runningCommands.includes(commandId);

  const commandGroups = buildCommandGroups(agentConfigs);

  return (
    <div className="fixed left-0 top-[var(--topbar-height)] z-40 h-[calc(100vh-var(--topbar-height))] w-[var(--sidebar-width)] border-r border-[var(--border-subtle)] bg-[var(--surface)]/80 backdrop-blur-xl">
      <div className="flex h-full flex-col">
        {/* Logo section */}
        <div className="border-b border-[var(--border-subtle)] px-5 py-6">
          <motion.div
            className="mb-4 flex items-center gap-3"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--gold)] to-[var(--gold-bright)] shadow-[var(--shadow-gold)]">
              <span className="font-mono text-base font-bold text-black">SM</span>
            </div>
          </motion.div>

          {/* Divider */}
          <div className="mx-auto h-px w-[40%] bg-gradient-to-r from-transparent via-[var(--gold)] to-transparent opacity-50" />
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
                <div className="space-y-1">
                  {group.commands.map((command) => {
                    const running = isRunning(command.id);

                    return (
                      <div
                        key={command.id}
                        className="relative"
                        onMouseEnter={() => setHoveredCommand(command.id)}
                        onMouseLeave={() => setHoveredCommand(null)}
                      >
                        <motion.button
                          onClick={() => onCommandClick(command.id)}
                          className={`group relative w-full overflow-hidden rounded-lg px-3 py-2.5 text-left transition-all duration-200 ${
                            running
                              ? 'bg-[var(--gold-dim)] border-l-2 border-l-[var(--gold)]'
                              : 'hover:bg-[var(--surface-2)]'
                          }`}
                          whileHover={{ x: 2 }}
                          whileTap={{ scale: 0.98 }}
                        >
                          {/* Running shimmer effect */}
                          {running && (
                            <motion.div
                              className="absolute inset-0 bg-gradient-to-r from-transparent via-[var(--gold-glow)] to-transparent"
                              animate={{ x: ['-100%', '200%'] }}
                              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                            />
                          )}

                          <div className="relative flex items-center gap-2">
                            {/* Command tag */}
                            <span className={`font-mono text-xs font-medium transition-colors ${
                              running ? 'text-[var(--gold-bright)]' : 'text-[var(--gold)]'
                            }`}>
                              {command.id}
                            </span>

                            {/* Running indicator */}
                            {running && (
                              <motion.div
                                className="h-1.5 w-1.5 rounded-full bg-[var(--gold)]"
                                animate={{ scale: [1, 1.2, 1], opacity: [1, 0.5, 1] }}
                                transition={{ duration: 1, repeat: Infinity }}
                              />
                            )}

                            {/* Actions on hover */}
                            {hoveredCommand === command.id && !running && (
                              <motion.div
                                className="ml-auto flex items-center gap-1"
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                              >
                                <div
                                  className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--gold)] cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onCommandClick(command.id);
                                  }}
                                >
                                  <Play className="h-3 w-3" />
                                </div>
                                <div
                                  className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)] cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                  }}
                                >
                                  <Info className="h-3 w-3" />
                                </div>
                              </motion.div>
                            )}
                          </div>

                          {/* Description */}
                          <div className="mt-1 text-xs text-[var(--text-secondary)]">
                            {command.description}
                          </div>

                          {/* Schedule badge */}
                          {command.schedule && (
                            <div className="text-[10px] text-[var(--warning)] font-mono mt-0.5">⏰ {command.schedule}</div>
                          )}
                        </motion.button>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* System stats bar */}
        <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-2)]/50 px-4 py-4">
          {/* Live indicator */}
          <div className="flex items-center gap-2 rounded-md bg-[var(--surface-3)] px-2 py-1.5">
            <motion.div
              className="h-2 w-2 rounded-full bg-[var(--success)]"
              animate={{ scale: [1, 1.2, 1], opacity: [1, 0.6, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
            <span className="text-[10px] text-[var(--text-muted)]">System Online</span>
          </div>
        </div>
      </div>
    </div>
  );
}
