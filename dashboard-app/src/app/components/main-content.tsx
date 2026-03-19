import { motion } from 'motion/react';
import { Grid, List, Search } from 'lucide-react';
import { useState } from 'react';
import { AgentCard } from './agent-card';
import { useDashboard } from '../../context/dashboard-context';

interface MainContentProps {
  runningCommands: string[];
  runningAgentIds: string[];
}

export function MainContent({ runningCommands, runningAgentIds }: MainContentProps) {
  const { agents, agentConfigs, triggerAgent, isMobile } = useDashboard();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filter, setFilter] = useState<'all' | 'running' | 'error' | 'scheduled'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Map real agent data + configs
  const agentCards = agentConfigs.map(config => {
    const status = agents.find(a => a.id === config.id);
    return {
      id: config.id,
      displayId: `AGENT-${config.id.replace('agent-', '').padStart(2, '0')}`,
      name: config.name,
      description: config.description,
      state: (status?.state || 'idle') as 'idle' | 'running' | 'error' | 'scheduled',
      lastRun: status?.lastRun ? new Date(status.lastRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never',
      duration: status?.lastDuration ? `${(status.lastDuration / 1000).toFixed(1)}s` : '—',
      runs: status?.runCount || 0,
      errors: status?.errorCount || 0,
      commands: config.commands,
      lastResult: status?.lastResult === 'SUCCESS' ? '✓ Last run succeeded' : status?.lastResult === 'FAIL' ? '✗ Last run failed' : 'No runs yet',
      schedule: config.schedule,
    };
  });

  const filteredAgents = agentCards.filter(a => {
    if (filter === 'running') return runningAgentIds.includes(a.id);
    if (filter === 'error') return a.state === 'error';
    return true;
  }).filter(a =>
    !searchQuery ||
    a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.commands.some(c => c.includes(searchQuery))
  );

  return (
    <div className="ml-[var(--sidebar-width)] mr-[var(--right-panel-width)] mt-[var(--topbar-height)] flex-1 overflow-y-auto">
      <div className={isMobile ? 'p-3' : 'p-6'}>
        {/* Top bar */}
        <div className={`mb-4 ${isMobile ? 'flex flex-col gap-3' : 'flex items-center justify-between mb-6'}`}>
          {/* Title + filters row */}
          <div className="flex items-center gap-3">
            <h1 className={`font-semibold text-[var(--text)] ${isMobile ? 'text-lg' : 'text-xl'}`}>AGENTS</h1>
            <div className="flex h-6 items-center justify-center rounded-full bg-[var(--gold-dim)] px-2.5">
              <span className="text-xs font-mono font-semibold text-[var(--gold)]">{filteredAgents.length}</span>
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            {(['all', 'running', 'error'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all border ${
                  filter === f
                    ? f === 'error' ? 'bg-[var(--error-dim)] text-[var(--error)] border-[var(--error)]/30' : 'bg-[var(--gold-dim)] text-[var(--gold)] border-[var(--gold)]/30'
                    : 'bg-[var(--surface-2)] text-[var(--text-muted)] border-transparent'
                }`}
              >
                {f.toUpperCase()}
                {f === 'running' && runningCommands.length > 0 && (
                  <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--gold)] text-[10px] font-bold text-black">
                    {runningCommands.length}
                  </span>
                )}
              </button>
            ))}

            {/* Search */}
            <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 ml-auto">
              <Search className="h-4 w-4 text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`bg-transparent text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none ${isMobile ? 'w-20' : 'w-32'}`}
              />
            </div>

            {!isMobile && (
              <div className="flex items-center gap-1 rounded-lg bg-[var(--surface-2)] p-1">
                <button onClick={() => setViewMode('grid')} className={`rounded p-1.5 transition-colors ${viewMode === 'grid' ? 'bg-[var(--gold-dim)] text-[var(--gold)]' : 'text-[var(--text-muted)]'}`}>
                  <Grid className="h-4 w-4" />
                </button>
                <button onClick={() => setViewMode('list')} className={`rounded p-1.5 transition-colors ${viewMode === 'list' ? 'bg-[var(--gold-dim)] text-[var(--gold)]' : 'text-[var(--text-muted)]'}`}>
                  <List className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions Bar */}
        <div className={`mb-4 grid gap-3 ${isMobile ? 'grid-cols-3' : 'grid-cols-5 mb-6'}`}>
          {[
            { icon: '📋', label: 'Status', command: '/status' },
            { icon: '⏰', label: 'Deadlines', command: '/deadlines' },
            { icon: '👤', label: 'New Lead', command: '/newlead' },
            { icon: '✉️', label: 'Outreach', command: '/outreach' },
            { icon: '🧠', label: 'Ask AI', command: '/ask' },
          ].map((action) => (
            <button
              key={action.command}
              onClick={() => triggerAgent(action.command)}
              className={`rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-center transition-all active:bg-[var(--surface-3)] ${isMobile ? 'p-3' : 'p-4'}`}
            >
              <div className={isMobile ? 'text-xl mb-1' : 'text-2xl mb-2'}>{action.icon}</div>
              <div className="text-xs font-medium text-[var(--text)]">{action.label}</div>
            </button>
          ))}
        </div>

        {/* Agent Grid */}
        <div className={`grid gap-4 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {filteredAgents.map((agent, index) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              isRunning={runningAgentIds.includes(agent.id)}
              onCommandClick={(cmd, args) => triggerAgent(cmd, args)}
              index={index}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
