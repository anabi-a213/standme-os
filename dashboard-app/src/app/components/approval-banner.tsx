import { motion, AnimatePresence } from 'motion/react';
import { Clock, ChevronDown, X, Check } from 'lucide-react';
import { useState } from 'react';

interface ApprovalBannerProps {
  agentName: string;
  action: string;
  details?: string;
  onApprove: () => void;
  onReject: () => void;
  isOpen: boolean;
}

export function ApprovalBanner({
  agentName,
  action,
  details,
  onApprove,
  onReject,
  isOpen,
}: ApprovalBannerProps) {
  const [showDetails, setShowDetails] = useState(false);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed right-0 top-[var(--topbar-height)] z-50 w-[var(--right-panel-width)] border-b-2 border-[var(--warning)] bg-gradient-to-r from-[#2a2100] to-[#1a1600]"
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -100, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      >
        <div className="p-4">
          {/* Header */}
          <div className="mb-3 flex items-start gap-3">
            <motion.div
              className="mt-0.5 flex-shrink-0"
              animate={{ rotate: [0, 360] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            >
              <Clock className="h-5 w-5 text-[var(--warning)]" />
            </motion.div>

            <div className="flex-1">
              <h3 className="mb-1 text-sm font-semibold text-[var(--text)]">
                {agentName} is waiting for your approval
              </h3>
              <p className="text-xs text-[var(--text-secondary)]">"{action}"</p>
            </div>

            <button
              onClick={onReject}
              className="flex-shrink-0 rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Details toggle */}
          {details && (
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="mb-3 flex items-center gap-2 text-xs text-[var(--gold)] transition-colors hover:text-[var(--gold-bright)]"
            >
              <motion.div
                animate={{ rotate: showDetails ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronDown className="h-3 w-3" />
              </motion.div>
              <span>View full details</span>
            </button>
          )}

          {/* Expanded details */}
          <AnimatePresence>
            {showDetails && details && (
              <motion.div
                className="mb-3 rounded-lg bg-[var(--surface-2)] p-3"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
              >
                <p className="text-xs text-[var(--text-muted)]">{details}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action buttons */}
          <div className="flex gap-2">
            <motion.button
              onClick={onReject}
              className="flex-1 rounded-lg border border-[var(--error)]/30 bg-transparent px-4 py-2 text-sm font-medium text-[var(--error)] transition-all hover:bg-[var(--error-dim)]"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <X className="mr-1.5 inline-block h-4 w-4" />
              Reject
            </motion.button>

            <motion.button
              onClick={onApprove}
              className="flex-1 rounded-lg bg-[var(--success)] px-4 py-2 text-sm font-semibold text-black transition-all hover:bg-[var(--success)]/90"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Check className="mr-1.5 inline-block h-4 w-4" />
              Approve
            </motion.button>
          </div>
        </div>

        {/* Animated bottom border */}
        <motion.div
          className="h-1 bg-gradient-to-r from-transparent via-[var(--warning)] to-transparent"
          animate={{ x: ['-100%', '100%'] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
        />
      </motion.div>
    </AnimatePresence>
  );
}
