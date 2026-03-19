import { useState, useEffect } from 'react';
import { useDashboard } from '../../../context/dashboard-context';
import { PanelHeader } from './panel-header';
import { getCached, setCache, getCacheAge } from '../../../lib/workspace-cache';
import { Clock } from 'lucide-react';

const CACHE_KEY = 'outreach_status';
const CACHE_TTL = 10 * 60 * 1000;

export function OutreachPanel({ onCommandClick }: { onCommandClick: (cmd: string) => void }) {
  const { runAgent } = useDashboard();
  const [outreachText, setOutreachText] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [cacheAgeText, setCacheAgeText] = useState<string | null>(null);

  // Load from cache on mount
  useEffect(() => {
    const cached = getCached(CACHE_KEY, CACHE_TTL);
    if (cached) {
      setOutreachText(cached);
      const age = getCacheAge(CACHE_KEY); // age is in seconds
      if (age !== null) {
        const mins = Math.round(age / 60);
        setCacheAgeText(mins < 1 ? 'cached just now' : `cached ${mins}m ago`);
        setLastRefresh(new Date(Date.now() - age * 1000));
      }
    }
  }, []);

  const refresh = async () => {
    setLoading(true);
    setCacheAgeText(null);
    const r = await runAgent('/outreachstatus');
    if (r.ok && r.result) {
      setOutreachText(r.result);
      setCache(CACHE_KEY, r.result);
      setLastRefresh(new Date());
    }
    setLoading(false);
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-[var(--border)] bg-[var(--surface-2)]">
      <PanelHeader title="OUTREACH STATUS" lastRefresh={lastRefresh} onRefresh={refresh} loading={loading} />
      <div className="flex-1 overflow-y-auto p-4">
        {cacheAgeText && !loading && (
          <div className="flex items-center gap-1 mb-2">
            <Clock className="h-3 w-3 text-[var(--text-subtle)]" />
            <span className="text-[10px] text-[var(--text-subtle)]">{cacheAgeText}</span>
          </div>
        )}
        {!outreachText && !loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-8">
            <p className="text-xs text-[var(--text-muted)]">No outreach data loaded</p>
            <button onClick={refresh} className="rounded-lg bg-[var(--gold)] px-4 py-2 text-xs font-semibold text-black">
              Load Outreach Stats
            </button>
          </div>
        )}
        {loading && (
          <div className="flex items-center justify-center py-8">
            <p className="text-xs text-[var(--text-muted)]">Running /outreachstatus...</p>
          </div>
        )}
        {outreachText && !loading && (
          <div className="rounded-lg bg-[var(--surface)] p-3">
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--text-secondary)]">{outreachText}</p>
          </div>
        )}
      </div>
      <div className="border-t border-[var(--border)] px-4 py-3 flex gap-2">
        <button onClick={() => onCommandClick('/salesreplies')}
          className="flex-1 rounded-md border border-[var(--gold)]/30 py-1.5 text-xs font-medium text-[var(--gold)] hover:bg-[var(--gold-dim)]">
          Process Replies
        </button>
        <button onClick={() => onCommandClick('/outreach')}
          className="flex-1 rounded-md border border-[var(--border)] py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-3)]">
          Run Outreach
        </button>
      </div>
    </div>
  );
}
