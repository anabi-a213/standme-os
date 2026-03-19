import { Search, Activity, Database, Cloud, Zap } from 'lucide-react';
import { motion } from 'motion/react';
import { Link, useLocation } from 'react-router';

interface SystemHealth {
  service: string;
  status: 'ok' | 'degraded' | 'error';
  icon: React.ReactNode;
}

interface TopBarProps {
  onOpenCommandPalette: () => void;
  onOpenShortcuts?: () => void;
  systemStats: { totalRuns: number; totalErrors: number; activeAgents: number; uptimeSince: string };
  agents: { id: string; state: string }[];
}

export function TopBar({ onOpenCommandPalette, onOpenShortcuts, systemStats, agents }: TopBarProps) {
  const location = useLocation();

  const apiStatus: 'ok' | 'degraded' = systemStats.totalErrors > 5 ? 'degraded' : 'ok';

  const healthIndicators: SystemHealth[] = [
    { service: 'Telegram', status: 'ok', icon: <Activity className="h-3 w-3" /> },
    { service: 'Sheets', status: 'ok', icon: <Database className="h-3 w-3" /> },
    { service: 'Drive', status: 'ok', icon: <Cloud className="h-3 w-3" /> },
    { service: 'API', status: apiStatus, icon: <Zap className="h-3 w-3" /> },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ok': return 'bg-[var(--success)]';
      case 'degraded': return 'bg-[var(--warning)]';
      case 'error': return 'bg-[var(--error)]';
      default: return 'bg-[var(--text-muted)]';
    }
  };

  const totalAgents = agents.length || 17;
  const runningCount = systemStats.activeAgents;
  const errorCount = systemStats.totalErrors;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-[var(--topbar-height)] border-b border-[var(--border-subtle)] bg-[var(--surface)]/80 backdrop-blur-xl">
      <div className="flex h-full items-center justify-between px-6">
        {/* Left: Logo */}
        <div className="flex items-center gap-4">
          <motion.div
            className="flex items-center gap-3"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
          >
            {/* Brand logo */}
            <div className="flex items-center gap-2.5">
              <img
                src="/dashboard/standme-logo.png"
                alt="StandMe"
                className="h-7 w-auto object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                  if (fallback) fallback.style.display = 'flex';
                }}
              />
              {/* Fallback if image not loaded */}
              <div className="hidden h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-[var(--gold)] to-[var(--gold-bright)] shadow-[var(--shadow-gold)]">
                <span className="font-mono text-sm font-bold text-black">SM</span>
              </div>

              {/* Wordmark */}
              <div className="flex flex-col">
                <span className="text-sm font-semibold tracking-tight text-[var(--text)]">
                  STANDME OS
                </span>
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  Intelligence Platform
                </span>
              </div>
            </div>
          </motion.div>

          {/* Navigation Tabs */}
          <div className="ml-6 flex items-center gap-1">
            <Link
              to="/"
              className={`relative px-4 py-2 text-sm font-medium transition-colors ${
                location.pathname === '/'
                  ? 'text-[var(--text)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              AGENTS
              {location.pathname === '/' && (
                <motion.div
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--gold)]"
                  layoutId="activeTab"
                  transition={{ duration: 0.2 }}
                />
              )}
            </Link>
            <Link
              to="/workspace"
              className={`relative px-4 py-2 text-sm font-medium transition-colors ${
                location.pathname === '/workspace'
                  ? 'text-[var(--text)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              WORKSPACE
              {location.pathname === '/workspace' && (
                <motion.div
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--gold)]"
                  layoutId="activeTab"
                  transition={{ duration: 0.2 }}
                />
              )}
            </Link>
          </div>
        </div>

        {/* Center: Global search */}
        <motion.button
          onClick={onOpenCommandPalette}
          className="group relative flex h-9 w-[400px] items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)]/50 px-4 transition-all duration-200 hover:border-[var(--gold)]/30 hover:bg-[var(--surface-2)]"
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
        >
          <Search className="h-4 w-4 text-[var(--text-muted)] transition-colors group-hover:text-[var(--gold)]" />
          <span className="flex-1 text-left text-sm text-[var(--text-muted)]">
            Search commands, agents...
          </span>
          <div className="flex items-center gap-1">
            <kbd className="rounded bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
              ⌘K
            </kbd>
          </div>
        </motion.button>

        {/* Right: System health & stats */}
        <div className="flex items-center gap-6">
          {/* Health indicators */}
          <div className="flex items-center gap-3">
            {healthIndicators.map((indicator, index) => (
              <motion.div
                key={indicator.service}
                className="group relative flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-[var(--surface-2)]"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <div className="relative">
                  <div className={`h-2 w-2 rounded-full ${getStatusColor(indicator.status)}`}>
                    {indicator.status === 'ok' && (
                      <motion.div
                        className={`absolute inset-0 rounded-full ${getStatusColor(indicator.status)}`}
                        animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      />
                    )}
                  </div>
                </div>
                <span className="text-xs text-[var(--text-muted)] transition-colors group-hover:text-[var(--text-secondary)]">
                  {indicator.service}
                </span>
              </motion.div>
            ))}
          </div>

          {/* Stats divider */}
          <div className="h-6 w-px bg-[var(--border)]" />

          {/* Agent stats */}
          <div className="flex items-center gap-4">
            <div className="text-xs">
              <span className="text-[var(--text-muted)]">Agents: </span>
              <span className="font-semibold text-[var(--text-gold)]">{totalAgents}</span>
            </div>
            <div className="text-xs">
              <span className="text-[var(--text-muted)]">Running: </span>
              <span className="font-semibold text-[var(--success)]">{runningCount}</span>
            </div>
            <div className="text-xs">
              <span className="text-[var(--text-muted)]">Errors: </span>
              <span className="font-semibold text-[var(--error)]">{errorCount}</span>
            </div>
          </div>

          {/* User avatar */}
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-[var(--gold)] to-[var(--gold-bright)]">
              <span className="text-xs font-semibold text-black">MO</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-medium text-[var(--text)]">Mo</span>
              <span className="text-[10px] text-[var(--text-muted)]">CEO</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
