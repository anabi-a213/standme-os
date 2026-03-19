import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Filter, Trash2, ChevronDown, Info } from 'lucide-react';
import { useDashboard } from '../../context/dashboard-context';
import type { AgentEvent } from '../../lib/api';

function formatEventMessage(e: AgentEvent): string {
  if (e.type === 'agent:start') return `▶ running${e.data?.command ? ` (${e.data.command})` : ''}`;
  if (e.type === 'agent:end') return `✓ done in ${e.data?.duration ? ((e.data.duration as number) / 1000).toFixed(1) + 's' : '—'}`;
  if (e.type === 'agent:error') return `✗ error: ${String(e.data?.message || '').substring(0, 60)}`;
  if (e.type === 'approval') return `⏳ approval: ${e.data?.what || ''}`;
  return String(e.data?.message || '').substring(0, 100);
}

interface DisplayEvent {
  id: string;
  type: AgentEvent['type'] | 'system';
  agentName: string;
  message: string;
  timestamp: Date;
  expandedContent?: string;
}

export function ActivityFeed() {
  const { activityEvents } = useDashboard();
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [clearedAt, setClearedAt] = useState<Date | null>(null);

  const displayEvents: DisplayEvent[] = [...activityEvents]
    .filter(e => !clearedAt || new Date(e.timestamp) > clearedAt)
    .reverse()
    .slice(0, 100)
    .map(e => ({
      id: `${e.agentId}-${e.timestamp}`,
      type: e.type,
      agentName: e.agentName,
      message: formatEventMessage(e),
      timestamp: new Date(e.timestamp),
      expandedContent: e.data?.message as string | undefined,
    }));

  const getEventColor = (type: DisplayEvent['type']) => {
    switch (type) {
      case 'agent:start': return 'text-[var(--gold)] bg-[var(--gold)]';
      case 'agent:end': return 'text-[var(--success)] bg-[var(--success)]';
      case 'agent:error': return 'text-[var(--error)] bg-[var(--error)]';
      case 'approval': return 'text-[var(--warning)] bg-[var(--warning)]';
      default: return 'text-[var(--text-muted)] bg-[var(--text-muted)]';
    }
  };

  const formatTimestamp = (date: Date) => {
    const diff = Date.now() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
        <div className="flex items-center gap-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Live Activity
          </h3>
          <div className="h-2 w-2 rounded-full bg-[var(--gold)] animate-pulse-glow" />
        </div>

        <div className="flex items-center gap-1">
          <div className="relative">
            <button
              onClick={() => setFilterOpen(!filterOpen)}
              className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            >
              <Filter className="h-3.5 w-3.5" />
            </button>

            {/* Filter dropdown */}
            <AnimatePresence>
              {filterOpen && (
                <motion.div
                  className="absolute right-0 top-full z-10 mt-2 w-48 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-2 shadow-[var(--shadow-xl)]"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <div className="space-y-1">
                    {['Agent runs', 'Errors', 'Approvals', 'Telegram', 'System'].map((filter) => (
                      <label key={filter} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--surface-2)]">
                        <input type="checkbox" defaultChecked className="accent-[var(--gold)]" />
                        <span>{filter}</span>
                      </label>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            onClick={() => setClearedAt(new Date())}
            className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            title="Clear activity log"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Events list */}
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-1 p-3">
          <AnimatePresence mode="popLayout">
            {displayEvents.map((event, index) => (
              <motion.div
                key={event.id}
                className="group relative cursor-pointer rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-[var(--border)] hover:bg-[var(--surface-2)]"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ delay: index * 0.03 }}
                onClick={() => setExpandedEvent(expandedEvent === event.id ? null : event.id)}
              >
                <div className="flex items-start gap-2.5">
                  {/* Status dot */}
                  <div className="relative mt-1 flex-shrink-0">
                    <div className={`h-2 w-2 rounded-full ${getEventColor(event.type)}`} />
                    {event.type === 'agent:start' && (
                      <motion.div
                        className={`absolute inset-0 rounded-full ${getEventColor(event.type)}`}
                        animate={{ scale: [1, 2, 1], opacity: [0.5, 0, 0.5] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {formatTimestamp(event.timestamp)}
                      </span>
                      <span className="text-xs font-medium text-[var(--text-secondary)]">
                        {event.agentName}
                      </span>
                    </div>
                    <div className={`mt-0.5 text-xs ${
                      event.type === 'agent:start' ? 'text-[var(--gold)]' :
                      event.type === 'agent:end' ? 'text-[var(--success)]' :
                      event.type === 'agent:error' ? 'text-[var(--error)]' :
                      'text-[var(--text-muted)]'
                    }`}>
                      {event.message}
                    </div>

                    {/* Expanded content */}
                    <AnimatePresence>
                      {expandedEvent === event.id && event.expandedContent && (
                        <motion.div
                          className="mt-2 rounded bg-[var(--surface-3)] p-2 text-[11px] text-[var(--text-muted)]"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                        >
                          {event.expandedContent}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Expand indicator */}
                  {event.expandedContent && (
                    <motion.div
                      animate={{ rotate: expandedEvent === event.id ? 180 : 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <ChevronDown className="h-3 w-3 text-[var(--text-muted)]" />
                    </motion.div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Empty state */}
          {displayEvents.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-2)]">
                <Info className="h-6 w-6 text-[var(--text-muted)]" />
              </div>
              <p className="text-sm text-[var(--text-muted)]">No activity yet</p>
              <p className="mt-1 text-xs text-[var(--text-subtle)]">Run any command to see it here →</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
