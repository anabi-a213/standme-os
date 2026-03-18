import { useState } from 'react';
import { useDashboard } from '../../../context/dashboard-context';
import { PanelHeader } from './panel-header';
import { motion } from 'motion/react';
import { RefreshCw, Plus } from 'lucide-react';

const STAGES = ['Qualifying', 'Proposal', 'Approved', 'Design', 'Production', 'Build', 'Complete'];

export function KanbanBoard({ onCommandClick }: { onCommandClick: (cmd: string) => void }) {
  const { runAgent, triggerAgent } = useDashboard();
  const [statusText, setStatusText] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refresh = async () => {
    setLoading(true);
    const result = await runAgent('/status');
    if (result.ok && result.result) {
      setStatusText(result.result);
      setLastRefresh(new Date());
    }
    setLoading(false);
  };

  // Parse statusText into per-stage sections
  const parseStages = (text: string): Record<string, string> => {
    const sections: Record<string, string> = {};
    STAGES.forEach(stage => {
      const regex = new RegExp(`\\*?${stage}[^\\n]*\\n([\\s\\S]*?)(?=\\n\\*?(?:${STAGES.join('|')})|$)`, 'i');
      const match = text.match(regex);
      sections[stage] = match ? match[1].trim() : '';
    });
    return sections;
  };

  const stageSections = statusText ? parseStages(statusText) : {};

  return (
    <div className="flex h-full flex-col rounded-xl border border-[var(--border)] bg-[var(--surface-2)]">
      <PanelHeader
        title="PIPELINE BOARD"
        lastRefresh={lastRefresh}
        onRefresh={refresh}
        loading={loading}
      />
      {!statusText && !loading && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
          <p className="text-sm text-[var(--text-muted)]">No pipeline data loaded</p>
          <motion.button
            onClick={refresh}
            className="flex items-center gap-2 rounded-lg bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-black"
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          >
            <RefreshCw className="h-4 w-4" /> Load Pipeline
          </motion.button>
        </div>
      )}
      {loading && (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <motion.div className="h-8 w-8 rounded-full border-2 border-[var(--gold)] border-t-transparent"
              animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} />
            <p className="text-xs text-[var(--text-muted)]">Running /status...</p>
          </div>
        </div>
      )}
      {statusText && !loading && (
        <div className="flex flex-1 gap-3 overflow-x-auto p-4">
          {STAGES.map(stage => {
            const content = stageSections[stage] || '';
            const lines = content.split('\n').filter(l => l.trim());
            return (
              <div key={stage} className="flex min-w-[160px] flex-col gap-2 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{stage}</span>
                  {lines.length > 0 && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--gold-dim)] text-[10px] font-bold text-[var(--gold)]">
                      {lines.length}
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {lines.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[var(--border)] p-3 text-center text-[10px] text-[var(--text-muted)]">Empty</div>
                  ) : lines.map((line, i) => (
                    <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{line.replace(/^[-•*]\s*/, '')}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="border-t border-[var(--border)] px-4 py-3">
        <div className="flex gap-2">
          <button onClick={() => onCommandClick('/movecard')}
            className="flex items-center gap-1.5 rounded-md border border-[var(--gold)]/30 px-3 py-1.5 text-xs font-medium text-[var(--gold)] hover:bg-[var(--gold-dim)]">
            Move Stage
          </button>
          <button onClick={() => onCommandClick('/newlead')}
            className="flex items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-3)]">
            <Plus className="h-3 w-3" /> Add Lead
          </button>
        </div>
      </div>
    </div>
  );
}
