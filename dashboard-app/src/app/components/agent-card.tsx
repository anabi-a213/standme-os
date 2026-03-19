import { motion, AnimatePresence } from 'motion/react';
import { Play, Clock, AlertCircle, CheckCircle, Zap } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useDashboard } from '../../context/dashboard-context';

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
  onCommandClick: (command: string, args?: string) => void;
  index: number;
}

// Integrations used by each agent
const AGENT_INTEGRATIONS: Record<string, { label: string; color: string }[]> = {
  'agent-01': [{ label: 'Trello', color: '#0052CC' }, { label: 'Sheets', color: '#0F9D58' }, { label: 'AI', color: '#C9A84C' }, { label: 'Telegram', color: '#229ED9' }],
  'agent-02': [{ label: 'Sheets', color: '#0F9D58' }, { label: 'AI', color: '#C9A84C' }, { label: 'Telegram', color: '#229ED9' }],
  'agent-03': [{ label: 'Sheets', color: '#0F9D58' }, { label: 'Drive', color: '#F4B400' }, { label: 'AI', color: '#C9A84C' }, { label: 'Telegram', color: '#229ED9' }],
  'agent-04': [{ label: 'Sheets', color: '#0F9D58' }, { label: 'Trello', color: '#0052CC' }, { label: 'Drive', color: '#F4B400' }, { label: 'AI', color: '#C9A84C' }],
  'agent-05': [{ label: 'Trello', color: '#0052CC' }, { label: 'Sheets', color: '#0F9D58' }, { label: 'Telegram', color: '#229ED9' }],
  'agent-06': [{ label: 'Trello', color: '#0052CC' }, { label: 'Sheets', color: '#0F9D58' }, { label: 'AI', color: '#C9A84C' }, { label: 'Telegram', color: '#229ED9' }],
  'agent-07': [{ label: 'Trello', color: '#0052CC' }, { label: 'Sheets', color: '#0F9D58' }, { label: 'Telegram', color: '#229ED9' }],
  'agent-08': [{ label: 'Trello', color: '#0052CC' }, { label: 'Telegram', color: '#229ED9' }],
  'agent-09': [{ label: 'Trello', color: '#0052CC' }, { label: 'Sheets', color: '#0F9D58' }, { label: 'Telegram', color: '#229ED9' }],
  'agent-10': [{ label: 'Sheets', color: '#0F9D58' }, { label: 'Telegram', color: '#229ED9' }],
  'agent-11': [{ label: 'Sheets', color: '#0F9D58' }, { label: 'Drive', color: '#F4B400' }, { label: 'Telegram', color: '#229ED9' }],
  'agent-12': [{ label: 'Trello', color: '#0052CC' }, { label: 'Sheets', color: '#0F9D58' }, { label: 'AI', color: '#C9A84C' }, { label: 'Telegram', color: '#229ED9' }],
  'agent-13': [{ label: 'Woodpecker', color: '#E8A430' }, { label: 'Sheets', color: '#0F9D58' }, { label: 'Telegram', color: '#229ED9' }],
  'agent-14': [{ label: 'Drive', color: '#F4B400' }, { label: 'Sheets', color: '#0F9D58' }, { label: 'AI', color: '#C9A84C' }],
  'agent-15': [{ label: 'Sheets', color: '#0F9D58' }, { label: 'Drive', color: '#F4B400' }, { label: 'AI', color: '#C9A84C' }, { label: 'Telegram', color: '#229ED9' }],
  'agent-16': [{ label: 'Trello', color: '#0052CC' }, { label: 'Sheets', color: '#0F9D58' }, { label: 'Telegram', color: '#229ED9' }],
  'agent-17': [{ label: 'Woodpecker', color: '#E8A430' }, { label: 'Sheets', color: '#0F9D58' }, { label: 'AI', color: '#C9A84C' }, { label: 'Telegram', color: '#229ED9' }],
};

// Animated workflow steps per agent
const AGENT_WORKFLOW: Record<string, string[]> = {
  'agent-01': ['Reading lead queue from Sheets...', 'Scoring & qualifying with AI...', 'Creating Trello card...', 'Notifying via Telegram...'],
  'agent-02': ['Loading pending leads...', 'Finding decision makers...', 'Enriching contact data with AI...', 'Updating Sheets...'],
  'agent-03': ['Loading client data from Sheets...', 'Reading brand & project context...', 'Generating concept brief with AI...', 'Saving to Drive & sending...'],
  'agent-04': ['Loading Knowledge Base from Drive...', 'Reading live Trello & Sheets data...', 'Processing with Claude AI...', 'Sending response via Telegram...'],
  'agent-05': ['Fetching cards from all Trello boards...', 'Checking due dates & thresholds...', 'Cross-referencing with Sheets...', 'Sending deadline alerts...'],
  'agent-06': ['Reading all 4 Trello boards...', 'Mapping cards to pipeline stages...', 'Generating AI summary...', 'Sending dashboard report...'],
  'agent-07': ['Reading active client projects...', 'Checking last contact dates...', 'Identifying follow-ups needed...', 'Sending reminders via Telegram...'],
  'agent-08': ['Finding target card in Trello...', 'Locating destination list...', 'Moving card to new stage...', 'Confirming move via Telegram...'],
  'agent-09': ['Reading portal submission deadlines...', 'Checking technical build cutoffs...', 'Cross-referencing Trello dates...', 'Sending technical alerts...'],
  'agent-10': ['Reading contractor database...', 'Checking skills & availability...', 'Processing booking request...', 'Updating Sheets & confirming...'],
  'agent-11': ['Reading lesson input...', 'Categorising with AI...', 'Saving to Knowledge Base in Drive...', 'Confirming saved to Sheets...'],
  'agent-12': ['Fetching recent won/lost deals...', 'Analysing patterns with AI...', 'Generating strategic insights...', 'Sending deal analysis report...'],
  'agent-13': ['Connecting to Woodpecker API...', 'Reading campaign performance data...', 'Processing outreach queue...', 'Sending status report...'],
  'agent-14': ['Scanning all Drive folders...', 'Reading file metadata & content...', 'Indexing into Knowledge Base...', 'Updating Drive index in Sheets...'],
  'agent-15': ['Loading StandMe brand guidelines...', 'Generating content with Claude AI...', 'Saving draft to Drive...', 'Sending via Telegram...'],
  'agent-16': ['Fetching all 4 Trello boards...', 'Cross-referencing project names...', 'Detecting conflicts & blockers...', 'Sending cross-board report...'],
  'agent-17': ['Reading campaign targets from Sheets...', 'Building sequences in Woodpecker...', 'Processing incoming replies...', 'Updating campaign Sheets...'],
};

export function AgentCard({ agent, isRunning, onCommandClick, index }: AgentCardProps) {
  const { activityEvents } = useDashboard();
  const [showConfirm, setShowConfirm] = useState<string | null>(null);
  const [args, setArgs] = useState('');
  const [workflowStep, setWorkflowStep] = useState(0);

  const effectiveRunning = isRunning || agent.state === 'running';
  const integrations = AGENT_INTEGRATIONS[agent.id] || [];
  const workflow = AGENT_WORKFLOW[agent.id] || ['Processing...', 'Calling integrations...', 'Sending result...'];

  // Animate workflow steps while running
  useEffect(() => {
    if (!effectiveRunning) { setWorkflowStep(0); return; }
    const interval = setInterval(() => {
      setWorkflowStep(s => Math.min(s + 1, workflow.length - 1));
    }, 2800);
    return () => clearInterval(interval);
  }, [effectiveRunning, workflow.length]);

  // Reset workflow on next run
  useEffect(() => {
    if (effectiveRunning) setWorkflowStep(0);
  }, [effectiveRunning]);

  // Get actual result message from live activity events
  const lastEvent = activityEvents
    .filter(e => e.agentId === agent.id && (e.type === 'agent:end' || e.type === 'agent:error'))
    .at(-1);
  const lastMessage = lastEvent ? String(lastEvent.data?.message || '').substring(0, 80) : null;
  const lastFailed = lastEvent?.type === 'agent:error';

  const visibleCommands = agent.commands.slice(0, 3);
  const extraCount = agent.commands.length - 3;

  return (
    <motion.div
      className="group relative"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.3) }}
    >
      <div className={`relative overflow-hidden rounded-xl border bg-[var(--surface-2)] transition-all duration-300 ${
        effectiveRunning
          ? 'border-[var(--gold)] shadow-[0_0_20px_rgba(201,168,76,0.15)]'
          : agent.state === 'error'
          ? 'border-[var(--error)]/40 bg-[var(--error-dim)]/5'
          : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]'
      }`}>

        {/* Scanning line when running */}
        {effectiveRunning && (
          <motion.div
            className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[var(--gold-bright)] to-transparent"
            animate={{ x: ['-100%', '200%'] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
          />
        )}

        <div className="relative p-4">
          {/* ── Header: ID + Status ── */}
          <div className="mb-2.5 flex items-center justify-between">
            <span className="font-mono text-[10px] font-semibold tracking-widest text-[var(--text-muted)]">
              {agent.displayId}
            </span>
            <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              effectiveRunning
                ? 'bg-[var(--gold-dim)] text-[var(--gold)]'
                : agent.state === 'error'
                ? 'bg-[var(--error-dim)] text-[var(--error)]'
                : 'bg-[var(--surface-3)] text-[var(--text-muted)]'
            }`}>
              {effectiveRunning && (
                <motion.div
                  className="h-1.5 w-1.5 rounded-full bg-[var(--gold)]"
                  animate={{ opacity: [1, 0.2, 1] }}
                  transition={{ duration: 0.9, repeat: Infinity }}
                />
              )}
              {agent.state === 'error' && !effectiveRunning && <AlertCircle className="h-3 w-3" />}
              <span>{effectiveRunning ? 'RUNNING' : agent.state.toUpperCase()}</span>
            </div>
          </div>

          {/* ── Name ── */}
          <h3 className="mb-1 text-sm font-semibold leading-snug text-[var(--text)]">
            {agent.name}
          </h3>

          {/* ── Description ── */}
          <p className="mb-3 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
            {agent.description}
          </p>

          {/* ── Integration tags ── */}
          {integrations.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1">
              {integrations.map(tag => (
                <span
                  key={tag.label}
                  className="rounded border px-1.5 py-px text-[9px] font-bold uppercase tracking-wide"
                  style={{
                    color: tag.color,
                    borderColor: `${tag.color}50`,
                    background: `${tag.color}18`,
                  }}
                >
                  {tag.label}
                </span>
              ))}
            </div>
          )}

          {/* ── Live Workflow (visible when running) ── */}
          <AnimatePresence>
            {effectiveRunning && (
              <motion.div
                key="workflow"
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: 'auto', marginBottom: 12 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                className="overflow-hidden rounded-lg border border-[var(--gold)]/25 bg-[var(--surface-3)]"
              >
                <div className="p-2.5">
                  <div className="mb-2 text-[9px] font-bold uppercase tracking-widest text-[var(--gold)]">
                    ⚡ Live Workflow
                  </div>
                  <div className="space-y-1.5">
                    {workflow.map((step, i) => (
                      <motion.div
                        key={i}
                        className={`flex items-center gap-2 text-[11px] transition-all duration-500 ${
                          i < workflowStep
                            ? 'text-[var(--success)] opacity-70'
                            : i === workflowStep
                            ? 'text-[var(--text)]'
                            : 'text-[var(--text-muted)] opacity-30'
                        }`}
                      >
                        {i < workflowStep ? (
                          <CheckCircle className="h-3 w-3 flex-shrink-0 text-[var(--success)]" />
                        ) : i === workflowStep ? (
                          <motion.div
                            className="h-3 w-3 flex-shrink-0 rounded-full border-2 border-[var(--gold)] border-t-transparent"
                            animate={{ rotate: 360 }}
                            transition={{ duration: 0.75, repeat: Infinity, ease: 'linear' }}
                          />
                        ) : (
                          <div className="h-3 w-3 flex-shrink-0 rounded-full border border-[var(--border)]" />
                        )}
                        <span>{step}</span>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Commands ── */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {visibleCommands.map(cmd => (
              <div key={cmd} className="relative">
                <motion.button
                  onClick={() => !effectiveRunning && setShowConfirm(showConfirm === cmd ? null : cmd)}
                  disabled={effectiveRunning}
                  className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium transition-all ${
                    effectiveRunning
                      ? 'border-[var(--border)] text-[var(--text-muted)]/40 cursor-not-allowed'
                      : showConfirm === cmd
                      ? 'border-[var(--gold)] bg-[var(--gold-dim)] text-[var(--gold)]'
                      : 'border-[var(--gold)]/40 text-[var(--gold)] hover:border-[var(--gold)] hover:bg-[var(--gold-dim)]'
                  }`}
                  whileHover={!effectiveRunning ? { scale: 1.04 } : {}}
                  whileTap={!effectiveRunning ? { scale: 0.96 } : {}}
                >
                  {cmd}
                </motion.button>

                {/* Confirm dialog */}
                <AnimatePresence>
                  {showConfirm === cmd && (
                    <motion.div
                      className="absolute left-0 top-full z-20 mt-1.5 w-56 rounded-lg border border-[var(--gold)]/30 bg-[var(--surface-elevated)] p-3 shadow-[var(--shadow-xl)]"
                      initial={{ opacity: 0, y: -6, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.96 }}
                    >
                      <div className="mb-2 text-xs font-semibold text-[var(--text)]">
                        Run <span className="font-mono text-[var(--gold)]">{cmd}</span>?
                      </div>
                      <input
                        type="text"
                        placeholder="Args (optional)..."
                        value={args}
                        onChange={e => setArgs(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { onCommandClick(cmd, args || undefined); setShowConfirm(null); setArgs(''); }
                          if (e.key === 'Escape') setShowConfirm(null);
                        }}
                        autoFocus
                        className="mb-2.5 w-full rounded bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--gold)]"
                      />
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => { onCommandClick(cmd, args || undefined); setShowConfirm(null); setArgs(''); }}
                          className="flex flex-1 items-center justify-center gap-1 rounded bg-[var(--gold)] py-1.5 text-xs font-bold text-black hover:bg-[var(--gold-bright)] transition-colors"
                        >
                          <Play className="h-3 w-3" /> Run
                        </button>
                        <button
                          onClick={() => { setShowConfirm(null); setArgs(''); }}
                          className="rounded bg-[var(--surface-3)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}

            {extraCount > 0 && (
              <span className="rounded-md border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
                +{extraCount}
              </span>
            )}
          </div>

          {/* ── Schedule badge ── */}
          {agent.schedule && (
            <div className="mb-3 flex items-center gap-1.5 text-[10px] text-[var(--warning)]">
              <Clock className="h-3 w-3" />
              <span className="font-mono">{agent.schedule}</span>
            </div>
          )}

          {/* ── Divider ── */}
          <div className="mb-3 h-px bg-gradient-to-r from-transparent via-[var(--border)] to-transparent" />

          {/* ── Stats + Last result ── */}
          <div className="flex items-end justify-between gap-2">
            {/* Stats */}
            <div className="flex items-center gap-3">
              <div>
                <div className={`font-mono text-sm font-bold ${agent.runs > 0 ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
                  {agent.runs}
                </div>
                <div className="text-[9px] uppercase tracking-wide text-[var(--text-muted)]">runs</div>
              </div>
              <div className="h-7 w-px bg-[var(--border)]" />
              <div>
                <div className={`font-mono text-sm font-bold ${agent.errors > 0 ? 'text-[var(--error)]' : 'text-[var(--text-muted)]'}`}>
                  {agent.errors}
                </div>
                <div className="text-[9px] uppercase tracking-wide text-[var(--text-muted)]">errors</div>
              </div>
              <div className="h-7 w-px bg-[var(--border)]" />
              <div>
                <div className="font-mono text-sm font-bold text-[var(--text-muted)]">{agent.duration}</div>
                <div className="text-[9px] uppercase tracking-wide text-[var(--text-muted)]">last&nbsp;run</div>
              </div>
            </div>

            {/* Last result */}
            <div className="min-w-0 text-right">
              {lastMessage ? (
                <div className={`flex items-center justify-end gap-1 text-[10px] ${
                  lastFailed ? 'text-[var(--error)]' : 'text-[var(--success)]'
                }`}>
                  {lastFailed
                    ? <AlertCircle className="h-3 w-3 flex-shrink-0" />
                    : <CheckCircle className="h-3 w-3 flex-shrink-0" />
                  }
                  <span className="max-w-[130px] truncate">{lastMessage}</span>
                </div>
              ) : (
                <div className="flex items-center justify-end gap-1 text-[10px] text-[var(--text-muted)]">
                  <Zap className="h-3 w-3" />
                  <span>Ready</span>
                </div>
              )}
              <div className="mt-0.5 text-[9px] text-[var(--text-muted)]">{agent.lastRun}</div>
            </div>
          </div>
        </div>

        {/* Bottom sweep bar when running */}
        {effectiveRunning && (
          <div className="h-0.5 w-full overflow-hidden bg-[var(--surface-3)]">
            <motion.div
              className="h-full bg-gradient-to-r from-[var(--gold)] via-[var(--gold-bright)] to-[var(--gold)]"
              animate={{ x: ['-100%', '100%'] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}
