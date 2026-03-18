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
  const { agents, agentConfigs, triggerAgent } = useDashboard();
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
      <div className="p-6">
        {/* Top bar */}
        <div className="mb-6 flex items-center justify-between">
          {/* Left: Title */}
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-[var(--text)]">AGENTS</h1>
            <div className="flex h-6 items-center justify-center rounded-full bg-[var(--gold-dim)] px-2.5">
              <span className="text-xs font-mono font-semibold text-[var(--gold)]">{filteredAgents.length}</span>
            </div>
          </div>

          {/* Center: Filters */}
          <div className="flex items-center gap-2">
            <motion.button
              onClick={() => setFilter('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                filter === 'all'
                  ? 'bg-[var(--gold-dim)] text-[var(--gold)] border border-[var(--gold)]/30'
                  : 'bg-[var(--surface-2)] text-[var(--text-muted)] hover:bg-[var(--surface-3)] border border-transparent'
              }`}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              ALL
            </motion.button>
            <motion.button
              onClick={() => setFilter('running')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                filter === 'running'
                  ? 'bg-[var(--gold-dim)] text-[var(--gold)] border border-[var(--gold)]/30'
                  : 'bg-[var(--surface-2)] text-[var(--text-muted)] hover:bg-[var(--surface-3)] border border-transparent'
              }`}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              RUNNING
              {runningCommands.length > 0 && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--gold)] text-[10px] font-bold text-black">
                  {runningCommands.length}
                </span>
              )}
            </motion.button>
            <motion.button
              onClick={() => setFilter('error')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                filter === 'error'
                  ? 'bg-[var(--error-dim)] text-[var(--error)] border border-[var(--error)]/30'
                  : 'bg-[var(--surface-2)] text-[var(--text-muted)] hover:bg-[var(--surface-3)] border border-transparent'
              }`}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              ERROR
            </motion.button>
          </div>

          {/* Right: View toggle & Search */}
          <div className="flex items-center gap-3">
            {/* View toggle */}
            <div className="flex items-center gap-1 rounded-lg bg-[var(--surface-2)] p-1">
              <button
                onClick={() => setViewMode('grid')}
                className={`rounded p-1.5 transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-[var(--gold-dim)] text-[var(--gold)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                <Grid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`rounded p-1.5 transition-colors ${
                  viewMode === 'list'
                    ? 'bg-[var(--gold-dim)] text-[var(--gold)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                <List className="h-4 w-4" />
              </button>
            </div>

            {/* Search */}
            <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
              <Search className="h-4 w-4 text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder="Search agents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-32 bg-transparent text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Quick Actions Bar */}
        <motion.div
          className="mb-6 grid grid-cols-5 gap-3"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {[
            { icon: '📋', label: 'Status', command: '/status' },
            { icon: '⏰', label: 'Deadlines', command: '/deadlines' },
            { icon: '👤', label: 'New Lead', command: '/newlead' },
            { icon: '✉️', label: 'Outreach', command: '/outreach' },
            { icon: '🧠', label: 'Ask AI', command: '/ask' },
          ].map((action, index) => (
            <motion.button
              key={action.command}
              onClick={() => triggerAgent(action.command)}
              className="group relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 text-center transition-all hover:border-[var(--gold)]/30 hover:bg-[var(--surface-3)]"
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <div className="text-2xl mb-2">{action.icon}</div>
              <div className="text-xs font-medium text-[var(--text)]">{action.label}</div>
            </motion.button>
          ))}
        </motion.div>

        {/* Agent Grid */}
        <div className="grid grid-cols-2 gap-4">
          {filteredAgents.map((agent, index) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              isRunning={runningAgentIds.includes(agent.id)}
              onCommandClick={(cmd) => triggerAgent(cmd)}
              index={index}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
