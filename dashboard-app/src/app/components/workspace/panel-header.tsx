import { RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';

interface PanelHeaderProps {
  title: string;
  lastRefresh: Date | null;
  onRefresh: () => void;
  loading: boolean;
}

export function PanelHeader({ title, lastRefresh, onRefresh, loading }: PanelHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{title}</h3>
        {lastRefresh && (
          <span className="text-[10px] text-[var(--text-subtle)]">
            {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
      <motion.button
        onClick={onRefresh}
        disabled={loading}
        className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--gold)] disabled:opacity-50"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <motion.div animate={loading ? { rotate: 360 } : {}} transition={{ duration: 1, repeat: loading ? Infinity : 0, ease: 'linear' }}>
          <RefreshCw className="h-3.5 w-3.5" />
        </motion.div>
      </motion.button>
    </div>
  );
}
