import { motion, AnimatePresence } from 'motion/react';
import { X, Keyboard } from 'lucide-react';

interface ShortcutsOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

const shortcuts = [
  { key: 'Cmd+K', description: 'Command palette', category: 'Navigation' },
  { key: 'Cmd+Enter', description: 'Send chat message', category: 'Chat' },
  { key: 'Cmd+L', description: 'Clear chat', category: 'Chat' },
  { key: 'Cmd+/', description: 'Focus chat input', category: 'Chat' },
  { key: 'Esc', description: 'Close modals / cancel', category: 'Navigation' },
  { key: '1-9', description: 'Quick-jump to agent card 1-9', category: 'Navigation' },
  { key: 'R', description: 'Refresh agent statuses', category: 'Actions' },
  { key: '?', description: 'This shortcut sheet', category: 'Help' },
  { key: '↑↓', description: 'Navigate command palette', category: 'Navigation' },
  { key: 'Enter', description: 'Select / Execute', category: 'Actions' },
  { key: 'Shift+Enter', description: 'New line in chat', category: 'Chat' },
  { key: 'Tab', description: 'Autocomplete command', category: 'Navigation' },
];

const categories = Array.from(new Set(shortcuts.map(s => s.category)));

export function ShortcutsOverlay({ isOpen, onClose }: ShortcutsOverlayProps) {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[100] flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        {/* Backdrop */}
        <motion.div
          className="absolute inset-0 bg-black/60 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />

        {/* Modal */}
        <motion.div
          className="relative z-10 w-full max-w-2xl overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-2)] shadow-[var(--shadow-2xl)]"
          initial={{ scale: 0.95, y: -20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.95, y: -20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          onClick={e => e.stopPropagation()}
        >
          {/* Gold accent bar */}
          <div className="h-1 w-full bg-gradient-to-r from-transparent via-[var(--gold)] to-transparent opacity-50" />

          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--gold-dim)]">
                <Keyboard className="h-5 w-5 text-[var(--gold)]" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--text)]">
                  Keyboard Shortcuts
                </h2>
                <p className="text-xs text-[var(--text-muted)]">
                  Master StandMe OS with these shortcuts
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="rounded-md p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content */}
          <div className="max-h-[70vh] overflow-y-auto p-6">
            <div className="space-y-6">
              {categories.map((category, categoryIndex) => (
                <motion.div
                  key={category}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: categoryIndex * 0.1 }}
                >
                  {/* Category title */}
                  <div className="mb-3 flex items-center gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      {category}
                    </h3>
                    <div className="h-px flex-1 bg-gradient-to-r from-[var(--border)] to-transparent" />
                  </div>

                  {/* Shortcuts in category */}
                  <div className="space-y-2">
                    {shortcuts
                      .filter(s => s.category === category)
                      .map((shortcut, index) => (
                        <motion.div
                          key={shortcut.key}
                          className="flex items-center justify-between rounded-lg border border-transparent px-4 py-3 transition-colors hover:border-[var(--border)] hover:bg-[var(--surface-3)]"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: categoryIndex * 0.1 + index * 0.03 }}
                        >
                          {/* Description */}
                          <span className="text-sm text-[var(--text-secondary)]">
                            {shortcut.description}
                          </span>

                          {/* Key */}
                          <div className="flex items-center gap-1">
                            {shortcut.key.split('+').map((key, i, arr) => (
                              <div key={i} className="flex items-center gap-1">
                                <kbd className="flex h-7 min-w-[28px] items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 font-mono text-xs font-semibold text-[var(--text)]">
                                  {key}
                                </kbd>
                                {i < arr.length - 1 && (
                                  <span className="text-xs text-[var(--text-muted)]">+</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      ))}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-[var(--border)] bg-[var(--surface)]/50 px-6 py-4">
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span>Press <kbd className="rounded bg-[var(--surface-3)] px-1.5 py-0.5">?</kbd> anytime to view shortcuts</span>
              <span className="text-[var(--gold)]">{shortcuts.length} shortcuts</span>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
