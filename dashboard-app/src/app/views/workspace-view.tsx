import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Settings, X, Eye, EyeOff, LayoutGrid, LayoutList } from 'lucide-react';
import { KanbanBoard } from '../components/workspace/kanban-board';
import { LeadStatsPanel } from '../components/workspace/lead-stats-panel';
import { OutreachPanel } from '../components/workspace/outreach-panel';
import { DeadlinesTimeline } from '../components/workspace/deadlines-timeline';
import { useDashboard } from '../../context/dashboard-context';

type LayoutMode = 'default' | 'focused' | 'compact';
type PanelKey = 'pipeline' | 'stats' | 'outreach' | 'deadlines';

const PANEL_META: { key: PanelKey; label: string; description: string }[] = [
  { key: 'pipeline', label: 'Pipeline Board', description: 'Trello kanban stages across all active projects' },
  { key: 'stats', label: 'Lead Stats', description: 'System metrics and pipeline summary numbers' },
  { key: 'outreach', label: 'Outreach Status', description: 'Email campaign performance and reply tracking' },
  { key: 'deadlines', label: 'Deadlines Timeline', description: 'Overdue and upcoming project deadlines' },
];

export function WorkspaceView() {
  const { triggerAgent } = useDashboard();
  const [customizePanelOpen, setCustomizePanelOpen] = useState(false);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('default');
  const [visiblePanels, setVisiblePanels] = useState<Record<PanelKey, boolean>>({
    pipeline: true, stats: true, outreach: true, deadlines: true,
  });

  const handleCommandClick = (cmd: string) => triggerAgent(cmd);
  const togglePanel = (key: PanelKey) =>
    setVisiblePanels(prev => ({ ...prev, [key]: !prev[key] }));

  const topVisible = [visiblePanels.pipeline, visiblePanels.stats, visiblePanels.outreach].filter(Boolean).length;

  return (
    <div className="ml-[var(--sidebar-width)] mr-[var(--right-panel-width)] mt-[var(--topbar-height)] h-[calc(100vh-var(--topbar-height))] overflow-y-auto bg-[var(--bg-primary)]">
      <div className="p-6 pb-8">

        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--text)]">Workspace</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Real-time visibility into Trello, Sheets, Drive, and outreach
            </p>
          </div>

          <motion.button
            onClick={() => setCustomizePanelOpen(v => !v)}
            className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all ${
              customizePanelOpen
                ? 'border-[var(--gold)]/50 bg-[var(--gold-dim)] text-[var(--gold)]'
                : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)] hover:border-[var(--gold)]/30 hover:text-[var(--text)]'
            }`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Settings className="h-4 w-4" />
            Customize Layout
          </motion.button>
        </div>

        {/* ── Customize panel ── */}
        <AnimatePresence>
          {customizePanelOpen && (
            <motion.div
              key="customize-panel"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="mb-4 overflow-hidden rounded-xl border border-[var(--gold)]/20 bg-[var(--surface-2)]"
            >
              <div className="p-4">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    Layout Options
                  </span>
                  <button
                    onClick={() => setCustomizePanelOpen(false)}
                    className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* View mode */}
                <div className="mb-4">
                  <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">View Mode</div>
                  <div className="flex gap-2">
                    {([
                      { mode: 'default'  as const, label: 'Default',         icon: LayoutGrid },
                      { mode: 'focused'  as const, label: 'Pipeline Focus',  icon: LayoutList },
                      { mode: 'compact'  as const, label: 'Compact 2×2',     icon: LayoutGrid },
                    ]).map(({ mode, label, icon: Icon }) => (
                      <button
                        key={mode}
                        onClick={() => setLayoutMode(mode)}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                          layoutMode === mode
                            ? 'border-[var(--gold)]/50 bg-[var(--gold-dim)] text-[var(--gold)]'
                            : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border-subtle)]'
                        }`}
                      >
                        <Icon className="h-3 w-3" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Panel toggles */}
                <div>
                  <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Show / Hide Panels</div>
                  <div className="flex flex-wrap gap-2">
                    {PANEL_META.map(({ key, label, description }) => (
                      <button
                        key={key}
                        onClick={() => togglePanel(key)}
                        title={description}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                          visiblePanels[key]
                            ? 'border-[var(--gold)]/40 bg-[var(--gold-dim)] text-[var(--gold)]'
                            : 'border-[var(--border)] text-[var(--text-muted)] opacity-50 line-through hover:opacity-70'
                        }`}
                      >
                        {visiblePanels[key]
                          ? <Eye className="h-3 w-3" />
                          : <EyeOff className="h-3 w-3" />
                        }
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-[var(--text-muted)]">
                    Click a panel to toggle visibility. Layout preference is saved for this session.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Grid layouts ── */}

        {/* COMPACT — 2×2 grid */}
        {layoutMode === 'compact' && (
          <div className="grid grid-cols-2 gap-4">
            {visiblePanels.pipeline  && <div className="h-[300px]"><KanbanBoard onCommandClick={handleCommandClick} /></div>}
            {visiblePanels.stats     && <div className="h-[300px]"><LeadStatsPanel /></div>}
            {visiblePanels.outreach  && <div className="h-[300px]"><OutreachPanel onCommandClick={handleCommandClick} /></div>}
            {visiblePanels.deadlines && <div className="h-[300px]"><DeadlinesTimeline onCommandClick={handleCommandClick} /></div>}
          </div>
        )}

        {/* FOCUSED — full-width pipeline on top, then stats+outreach row, then deadlines */}
        {layoutMode === 'focused' && (
          <div className="flex flex-col gap-4">
            {visiblePanels.pipeline && (
              <div className="h-[380px]">
                <KanbanBoard onCommandClick={handleCommandClick} />
              </div>
            )}
            {(visiblePanels.stats || visiblePanels.outreach) && (
              <div className="grid grid-cols-2 gap-4">
                {visiblePanels.stats    && <div className="h-[260px]"><LeadStatsPanel /></div>}
                {visiblePanels.outreach && <div className="h-[260px]"><OutreachPanel onCommandClick={handleCommandClick} /></div>}
              </div>
            )}
            {visiblePanels.deadlines && (
              <div className="h-[200px]">
                <DeadlinesTimeline onCommandClick={handleCommandClick} />
              </div>
            )}
          </div>
        )}

        {/* DEFAULT — 3 panels top row + deadlines bottom */}
        {layoutMode === 'default' && (
          <div className="flex flex-col gap-4">
            {/* Top row — use inline grid-template-columns to avoid Tailwind dynamic class purge */}
            {topVisible > 0 && (
              <div
                className="grid gap-4"
                style={{
                  gridTemplateColumns:
                    topVisible === 1 ? '1fr'
                    : topVisible === 2 && visiblePanels.pipeline ? '2fr 1fr'
                    : topVisible === 2 ? '1fr 1fr'
                    : '2fr 1fr 1fr',
                }}
              >
                {visiblePanels.pipeline && (
                  <div className="h-[340px]">
                    <KanbanBoard onCommandClick={handleCommandClick} />
                  </div>
                )}
                {visiblePanels.stats && (
                  <div className="h-[340px]">
                    <LeadStatsPanel />
                  </div>
                )}
                {visiblePanels.outreach && (
                  <div className="h-[340px]">
                    <OutreachPanel onCommandClick={handleCommandClick} />
                  </div>
                )}
              </div>
            )}

            {/* Bottom: deadlines */}
            {visiblePanels.deadlines && (
              <div className="h-[220px]">
                <DeadlinesTimeline onCommandClick={handleCommandClick} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
