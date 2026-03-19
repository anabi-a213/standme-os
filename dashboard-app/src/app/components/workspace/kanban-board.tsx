import { useState, useEffect } from 'react';
import { useDashboard } from '../../../context/dashboard-context';
import { PanelHeader } from './panel-header';
import { motion } from 'motion/react';
import { RefreshCw, Plus, ExternalLink, Clock } from 'lucide-react';
import { fetchBoards, TrelloCard } from '../../../lib/api';
import { getCachedJSON, setCacheJSON, getCacheAge } from '../../../lib/workspace-cache';

const BOARDS = ['Sales Pipeline', 'Sales', 'Design', 'Operation', 'Production'];
// Maps display names → API response keys from getAllBoardsSnapshot()
const BOARD_KEY_MAP: Record<string, string> = {
  'Sales Pipeline': 'salesPipeline',
  'Sales': 'sales',
  'Design': 'design',
  'Operation': 'operation',
  'Production': 'production',
};
const CACHE_KEY = 'boards_snapshot';
const CACHE_TTL = 10 * 60 * 1000; // 10 min

export function KanbanBoard({ onCommandClick }: { onCommandClick: (cmd: string) => void }) {
  const { isMobile } = useDashboard();
  const [activeBoard, setActiveBoard] = useState(BOARDS[0]);
  const [boards, setBoards] = useState<Record<string, TrelloCard[]> | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [cacheAgeText, setCacheAgeText] = useState<string | null>(null);

  // Load from cache on mount
  useEffect(() => {
    const cached = getCachedJSON<Record<string, TrelloCard[]>>(CACHE_KEY, CACHE_TTL);
    if (cached) {
      setBoards(cached);
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
    try {
      const snapshot = await fetchBoards();
      setBoards(snapshot);
      setCacheJSON(CACHE_KEY, snapshot);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Failed to fetch boards:', err);
    }
    setLoading(false);
  };

  // Group cards by list name for active board — use camelCase key from API response
  const activeCards = boards?.[BOARD_KEY_MAP[activeBoard]] || [];
  const listMap = new Map<string, TrelloCard[]>();
  for (const card of activeCards) {
    const list = card.listName || 'Unknown';
    if (!listMap.has(list)) listMap.set(list, []);
    listMap.get(list)!.push(card);
  }
  const lists = Array.from(listMap.entries());

  const isDue = (due: string | null) => {
    if (!due) return null;
    const d = new Date(due);
    const now = new Date();
    if (d < now) return 'overdue';
    const diff = d.getTime() - now.getTime();
    if (diff < 3 * 24 * 60 * 60 * 1000) return 'soon';
    return 'ok';
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-[var(--border)] bg-[var(--surface-2)]">
      <PanelHeader
        title="PIPELINE BOARD"
        lastRefresh={lastRefresh}
        onRefresh={refresh}
        loading={loading}
      />

      {/* Board tabs */}
      <div className={`flex border-b border-[var(--border)] ${isMobile ? 'overflow-x-auto' : ''}`}>
        {BOARDS.map(board => {
          const count = boards?.[BOARD_KEY_MAP[board]]?.length || 0;
          return (
            <button
              key={board}
              onClick={() => setActiveBoard(board)}
              className={`relative flex-shrink-0 px-3 py-2 text-[11px] font-medium transition-colors ${
                activeBoard === board
                  ? 'text-[var(--gold)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {board}
              {count > 0 && (
                <span className="ml-1 text-[9px] opacity-60">({count})</span>
              )}
              {activeBoard === board && (
                <motion.div
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--gold)]"
                  layoutId="boardTab"
                  transition={{ duration: 0.2 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Cache indicator */}
      {cacheAgeText && !loading && (
        <div className="flex items-center gap-1 px-4 pt-2">
          <Clock className="h-3 w-3 text-[var(--text-subtle)]" />
          <span className="text-[10px] text-[var(--text-subtle)]">{cacheAgeText}</span>
        </div>
      )}

      {/* Empty state — no data loaded */}
      {!boards && !loading && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
          <p className="text-sm text-[var(--text-muted)]">No board data loaded</p>
          <motion.button
            onClick={refresh}
            className="flex items-center gap-2 rounded-lg bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-black"
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          >
            <RefreshCw className="h-4 w-4" /> Load All Boards
          </motion.button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <motion.div className="h-8 w-8 rounded-full border-2 border-[var(--gold)] border-t-transparent"
              animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} />
            <p className="text-xs text-[var(--text-muted)]">Fetching 5 boards...</p>
          </div>
        </div>
      )}

      {/* Kanban columns */}
      {boards && !loading && (
        <div className="flex flex-1 gap-3 overflow-x-auto p-4">
          {lists.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-xs text-[var(--text-muted)]">No cards on this board</p>
            </div>
          ) : (
            lists.map(([listName, cards]) => (
              <div key={listName} className={`flex flex-col gap-2 flex-shrink-0 ${isMobile ? 'min-w-[200px]' : 'min-w-[180px]'}`}>
                {/* Column header */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    {listName}
                  </span>
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--gold-dim)] text-[10px] font-bold text-[var(--gold)]">
                    {cards.length}
                  </span>
                </div>
                {/* Cards */}
                <div className="space-y-2 overflow-y-auto" style={{ maxHeight: isMobile ? '220px' : '180px' }}>
                  {cards.map(card => {
                    const dueStatus = isDue(card.due);
                    return (
                      <a
                        key={card.id}
                        href={card.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 transition-colors hover:border-[var(--gold)]/30"
                      >
                        <p className="text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-2">{card.name}</p>
                        {/* Labels */}
                        {card.labels && card.labels.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {card.labels.map((label, i) => (
                              <span key={i} className="rounded px-1.5 py-0.5 text-[9px] font-medium bg-[var(--surface-3)] text-[var(--text-muted)]">
                                {label.name || label.color}
                              </span>
                            ))}
                          </div>
                        )}
                        {/* Due date */}
                        {card.due && (
                          <div className={`mt-1.5 flex items-center gap-1 text-[10px] ${
                            dueStatus === 'overdue' ? 'text-[var(--error)]' :
                            dueStatus === 'soon' ? 'text-[var(--warning)]' :
                            'text-[var(--text-muted)]'
                          }`}>
                            <Clock className="h-2.5 w-2.5" />
                            {new Date(card.due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            {dueStatus === 'overdue' && ' (overdue)'}
                          </div>
                        )}
                      </a>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Bottom actions */}
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
