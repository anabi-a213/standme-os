import { useState, useEffect } from 'react';
import { useDashboard } from '../../../context/dashboard-context';
import { PanelHeader } from './panel-header';
import { getCached, setCache, getCacheAge } from '../../../lib/workspace-cache';
import { Clock } from 'lucide-react';

const CACHE_KEY = 'lead_stats';
const CACHE_TTL = 10 * 60 * 1000;

export function LeadStatsPanel() {
  const { runAgent, systemStats } = useDashboard();
  const [statusText, setStatusText] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [cacheAgeText, setCacheAgeText] = useState<string | null>(null);

  // Load from cache on mount
  useEffect(() => {
    const cached = getCached(CACHE_KEY, CACHE_TTL);
    if (cached) {
      setStatusText(cached);
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
    const r = await runAgent('/status');
    if (r.ok && r.result) {
      setStatusText(r.result);
      setCache(CACHE_KEY, r.result);
      setLastRefresh(new Date());
    }
    setLoading(false);
  };

  const extract = (pattern: RegExp) => {
    const m = statusText.match(pattern);
    return m ? m[1] : '—';
  };

  const stats = [
    { label: 'Total Runs', value: systemStats.totalRuns.toString(), trend: null },
    { label: 'Active Agents', value: systemStats.activeAgents.toString(), trend: null },
    { label: 'Total Errors', value: systemStats.totalErrors.toString(), trend: systemStats.totalErrors > 0 ? 'down' : null },
    { label: 'Pipeline', value: extract(/(\d+)\s*active/i) !== '—' ? extract(/(\d+)\s*active/i) : '—', trend: null },
    { label: 'Overdue', value: extract(/(\d+)\s*overdue/i), trend: extract(/(\d+)\s*overdue/i) !== '—' ? 'down' : null },
    { label: 'Uptime', value: systemStats.uptimeSince ? 'Up' : '—', trend: null },
  ];

  return (
    <div className="flex h-full flex-col rounded-xl border border-[var(--border)] bg-[var(--surface-2)]">
      <PanelHeader title="LEAD STATS" lastRefresh={lastRefresh} onRefresh={refresh} loading={loading} />
      <div className="flex-1 p-4">
        {cacheAgeText && !loading && (
          <div className="flex items-center gap-1 mb-2">
            <Clock className="h-3 w-3 text-[var(--text-subtle)]" />
            <span className="text-[10px] text-[var(--text-subtle)]">{cacheAgeText}</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {stats.map(stat => (
            <div key={stat.label} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="text-xl font-bold text-[var(--text-gold)]">{stat.value}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{stat.label}</div>
              {stat.trend === 'down' && <div className="text-[10px] text-[var(--error)]">needs attention</div>}
            </div>
          ))}
        </div>
        {!statusText && !loading && (
          <button onClick={refresh} className="mt-3 w-full rounded-lg border border-[var(--gold)]/30 py-2 text-xs text-[var(--gold)] hover:bg-[var(--gold-dim)]">
            Load Live Stats
          </button>
        )}
        {statusText && (
          <div className="mt-3 rounded-lg bg-[var(--surface)] p-3">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">Pipeline Summary</div>
            <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed line-clamp-4">{statusText.substring(0, 300)}</p>
          </div>
        )}
      </div>
    </div>
  );
}
