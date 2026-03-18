import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Play, MessageSquare, X } from 'lucide-react';
import type { AgentConfig } from '../../lib/api';

interface CommandItem {
  id: string;
  name: string;
  description: string;
  category: string;
  type: 'agent';
  isRunning: boolean;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCommand: (command: string) => void;
  agentConfigs: AgentConfig[];
  runningCommands: string[];
}

export function CommandPalette({ isOpen, onClose, onSelectCommand, agentConfigs, runningCommands }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build commands from agentConfigs dynamically
  const commands: CommandItem[] = agentConfigs.flatMap(config =>
    config.commands.map(cmd => ({
      id: cmd,
      name: cmd,
      description: config.description,
      category: config.name,
      type: 'agent' as const,
      isRunning: runningCommands.includes(cmd),
    }))
  );

  const filteredCommands = commands.filter(cmd =>
    cmd.name.toLowerCase().includes(query.toLowerCase()) ||
    cmd.description.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % filteredCommands.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filteredCommands.length) % filteredCommands.length);
    } else if (e.key === 'Enter' && filteredCommands[selectedIndex]) {
      e.preventDefault();
      handleSelect(filteredCommands[selectedIndex]);
    }
  };

  const handleSelect = (command: CommandItem) => {
    if (command.isRunning) return;
    onSelectCommand(command.id);
    onClose();
    setQuery('');
  };

  if (!isOpen) return null;

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
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
        <div className="relative border-b border-[var(--border)] bg-[var(--surface)]/50 backdrop-blur-xl">
          <div className="flex items-center gap-3 px-6 py-4">
            <Search className="h-5 w-5 text-[var(--gold)]" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search agents, commands..."
              className="flex-1 bg-transparent text-base text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none"
            />
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto">
          {/* Suggested section */}
          {query === '' && (
            <div className="border-b border-[var(--border-subtle)] px-3 py-2">
              <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                All Commands ({commands.length})
              </div>
            </div>
          )}

          {/* Commands list */}
          <div className="p-2">
            {filteredCommands.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-3)]">
                  <Search className="h-6 w-6 text-[var(--text-muted)]" />
                </div>
                <p className="text-sm text-[var(--text-muted)]">No commands found</p>
              </div>
            ) : (
              <div className="space-y-1">
                {filteredCommands.map((command, index) => (
                  <motion.button
                    key={command.id}
                    onClick={() => handleSelect(command)}
                    disabled={command.isRunning}
                    className={`group relative flex w-full items-center gap-4 rounded-lg px-4 py-3 text-left transition-all ${
                      command.isRunning
                        ? 'opacity-60 cursor-not-allowed border border-[var(--gold)]/20 bg-[var(--gold-dim)]'
                        : index === selectedIndex
                        ? 'bg-[var(--gold-dim)] border border-[var(--gold)]/30'
                        : 'border border-transparent hover:bg-[var(--surface-3)]'
                    }`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.02 }}
                  >
                    {/* Icon */}
                    <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
                      index === selectedIndex
                        ? 'bg-[var(--gold)]/20 text-[var(--gold)]'
                        : 'bg-[var(--surface-3)] text-[var(--text-muted)] group-hover:text-[var(--gold)]'
                    } transition-colors`}>
                      {command.isRunning ? (
                        <motion.div
                          className="h-4 w-4 rounded-full border-2 border-[var(--gold)] border-t-transparent"
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                        />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-mono text-sm font-medium ${
                          index === selectedIndex ? 'text-[var(--text-gold)]' : 'text-[var(--text)]'
                        }`}>
                          {command.name}
                        </span>
                        {command.isRunning && (
                          <span className="text-[10px] text-[var(--gold)] font-semibold uppercase">Already running</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        {command.description}
                      </p>
                    </div>

                    {/* Category tag */}
                    <div className="flex-shrink-0">
                      <span className="rounded-full bg-[var(--surface-3)] px-2 py-1 text-[10px] text-[var(--text-muted)]">
                        {command.category}
                      </span>
                    </div>

                    {/* Selected indicator */}
                    {index === selectedIndex && !command.isRunning && (
                      <motion.div
                        className="absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-[var(--gold)]"
                        layoutId="selectedIndicator"
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                      />
                    )}
                  </motion.button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--border-subtle)] bg-[var(--surface)]/50 px-4 py-3">
          <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <kbd className="rounded bg-[var(--surface-3)] px-1.5 py-0.5">↑↓</kbd>
                Navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded bg-[var(--surface-3)] px-1.5 py-0.5">↵</kbd>
                Select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded bg-[var(--surface-3)] px-1.5 py-0.5">ESC</kbd>
                Close
              </span>
            </div>
            <span>{filteredCommands.length} commands</span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
