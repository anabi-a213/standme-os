import { motion } from 'motion/react';
import { Play, Clock, Activity, AlertCircle, TrendingUp } from 'lucide-react';
import { useState } from 'react';

interface Agent {
  id: string;
  displayId: string;
  name: string;
  description: string;
  state: 'idle' | 'running' | 'error' | 'scheduled';
  lastRun: string;
  duration: string;
  runs: number;
  errors: number;
  commands: string[];
  lastResult: string;
  schedule?: string | null;
}

interface AgentCardProps {
  agent: Agent;
  isRunning: boolean;
  onCommandClick: (command: string) => void;
  index: number;
}

export function AgentCard({ agent, isRunning, onCommandClick, index }: AgentCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [showConfirm, setShowConfirm] = useState<string | null>(null);

  const effectiveRunning = isRunning || agent.state === 'running';

  const getStatusColor = () => {
    if (effectiveRunning) return 'text-[var(--gold)] bg-[var(--gold-dim)]';
    if (agent.state === 'error') return 'text-[var(--error)] bg-[var(--error-dim)]';
    if (agent.state === 'scheduled') return 'text-[var(--warning)] bg-[var(--warning-dim)]';
    return 'text-[var(--text-muted)] bg-[var(--surface-3)]';
  };

  const getStatusIcon = () => {
    if (effectiveRunning) return <Activity className="h-3 w-3" />;
    if (agent.state === 'error') return <AlertCircle className="h-3 w-3" />;
    return <div className="h-2 w-2 rounded-full bg-[var(--text-muted)]" />;
  };

  const getStatusLabel = () => {
    if (effectiveRunning) return 'RUNNING';
    return agent.state.toUpperCase();
  };

  return (
    <motion.div
      className="group relative"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={`relative overflow-hidden rounded-xl border bg-[var(--surface-2)] transition-all duration-300 ${
          effectiveRunning
            ? 'border-[var(--gold)] bg-[var(--surface-warm)] shadow-[var(--shadow-gold)]'
            : 'border-[var(--border)] hover:border-[var(--border-strong)]'
        }`}
      >
        {/* Running shimmer effect */}
        {effectiveRunning && (
          <>
            <motion.div
              className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[var(--gold-bright)] to-transparent"
              animate={{ x: ['-100%', '200%'] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
            />
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-[var(--gold-glow)] to-transparent opacity-20"
              animate={{ x: ['-100%', '200%'] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            />
          </>
        )}

        <div className="relative p-5">
          {/* Header */}
          <div className="mb-3 flex items-start justify-between">
            {/* Agent ID */}
            <div className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              {agent.displayId}
            </div>

            {/* Status pill */}
            <motion.div
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${getStatusColor()}`}
              animate={effectiveRunning ? { scale: [1, 1.02, 1] } : {}}
              transition={{ duration: 2, repeat: Infinity }}
            >
              {getStatusIcon()}
              <span>{getStatusLabel()}</span>
            </motion.div>
          </div>

          {/* Name & Description */}
          <div className="mb-4">
            <h3 className="mb-1 text-base font-semibold text-[var(--text)]">
              {agent.name}
            </h3>
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              {agent.description}
            </p>
          </div>

          {/* Stats */}
          <div className="mb-4 flex items-center gap-4 text-[11px] text-[var(--text-muted)]">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>{agent.lastRun}</span>
            </div>
            <div>·</div>
            <div className="font-mono">{agent.duration}</div>
            <div>·</div>
            <div className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              <span className="font-mono">{agent.runs} runs</span>
            </div>
            <div>·</div>
            <div className={`font-mono ${agent.errors > 0 ? 'text-[var(--error)]' : ''}`}>
              {agent.errors} errors
            </div>
          </div>

          {/* Schedule badge */}
          {agent.schedule && (
            <div className="mb-3 text-[10px] text-[var(--warning)] font-mono">⏰ {agent.schedule}</div>
          )}

          {/* Commands */}
          <div className="mb-4 flex flex-wrap gap-2">
            {agent.commands.map((command) => (
              <div key={command} className="relative">
                <motion.button
                  onClick={() => {
                    if (!effectiveRunning) {
                      setShowConfirm(command);
                    }
                  }}
                  className={`group/cmd rounded-md border px-2.5 py-1 font-mono text-xs font-medium transition-all ${
                    effectiveRunning
                      ? 'border-[var(--gold)]/30 bg-[var(--gold-dim)] text-[var(--gold)] cursor-not-allowed opacity-50'
                      : 'border-[var(--gold)]/40 bg-transparent text-[var(--gold)] hover:border-[var(--gold)] hover:bg-[var(--gold-dim)]'
                  }`}
                  whileHover={!effectiveRunning ? { scale: 1.05 } : {}}
                  whileTap={!effectiveRunning ? { scale: 0.95 } : {}}
                  disabled={effectiveRunning}
                >
                  <span>{command}</span>
                  {!effectiveRunning && (
                    <motion.div
                      className="ml-1.5 inline-flex opacity-0 group-hover/cmd:opacity-100"
                      initial={{ width: 0 }}
                      whileHover={{ width: 'auto' }}
                    >
                      <Play className="h-3 w-3" />
                    </motion.div>
                  )}
                </motion.button>

                {/* Inline confirmation */}
                {showConfirm === command && (
                  <motion.div
                    className="absolute left-0 top-full z-10 mt-2 w-64 rounded-lg border border-[var(--gold)]/30 bg-[var(--surface-elevated)] p-3 shadow-[var(--shadow-xl)]"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                  >
                    <div className="mb-2 text-xs font-medium text-[var(--text)]">
                      Run {command} now?
                    </div>
                    <input
                      type="text"
                      placeholder="Optional: add args..."
                      className="mb-3 w-full rounded bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--gold)]"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          onCommandClick(command);
                          setShowConfirm(null);
                        }}
                        className="flex-1 rounded bg-[var(--gold)] px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-[var(--gold-bright)]"
                      >
                        ✓ Run
                      </button>
                      <button
                        onClick={() => setShowConfirm(null)}
                        className="rounded bg-[var(--surface-3)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-elevated)] hover:text-[var(--text)]"
                      >
                        ✕
                      </button>
                    </div>
                  </motion.div>
                )}
              </div>
            ))}
          </div>

          {/* Divider */}
          <div className="mb-4 h-px bg-gradient-to-r from-transparent via-[var(--border)] to-transparent" />

          {/* Last Result */}
          <div className="flex items-start gap-2">
            <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[var(--success-dim)]">
              <span className="text-xs">✓</span>
            </div>
            <div className="flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Last Result
              </div>
              <div className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                {agent.lastResult}
              </div>
            </div>
          </div>
        </div>

        {/* Running progress bar */}
        {effectiveRunning && (
          <div className="absolute bottom-0 left-0 right-0 h-1 overflow-hidden bg-[var(--surface-3)]">
            <motion.div
              className="h-full bg-gradient-to-r from-[var(--gold)] via-[var(--gold-bright)] to-[var(--gold)]"
              animate={{ x: ['-100%', '100%'] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
            />
          </div>
        )}

        {/* Hover glow effect */}
        {isHovered && !effectiveRunning && (
          <motion.div
            className="pointer-events-none absolute inset-0 rounded-xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              background: 'radial-gradient(circle at var(--mouse-x, 50%) var(--mouse-y, 50%), rgba(201, 168, 76, 0.1), transparent 50%)',
            }}
          />
        )}
      </div>
    </motion.div>
  );
}
