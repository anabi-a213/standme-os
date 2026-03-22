import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Maximize2, Minimize2, Trash2, Sparkles, GripVertical, ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { ActivityFeed } from './activity-feed';
import { useDashboard } from '../../context/dashboard-context';
import type { ChatMessage } from '../../context/dashboard-context';

interface RightPanelProps {
  isMobile?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

const suggestedQuestions = [
  "What's overdue?",
  "How are my leads doing?",
  "Any approvals pending?",
  "Show deadlines this week",
  "Summarise last week's activity",
];

const SUGGESTED_COMMANDS = [
  { label: 'Status',      cmd: '/status',      icon: '📊' },
  { label: 'New Lead',    cmd: '/newlead',     icon: '➕' },
  { label: 'Deadlines',   cmd: '/deadlines',   icon: '⏰' },
  { label: 'Outreach',    cmd: '/outreach',    icon: '📧' },
  { label: 'Brief',       cmd: '/brief',       icon: '🎨' },
  { label: 'Ask Brain',   cmd: '/ask ',        icon: '🧠' },
  { label: 'Enrich',      cmd: '/enrich',      icon: '🔍' },
  { label: 'Campaigns',   cmd: '/campaigns',   icon: '🚀' },
  { label: 'Reminders',   cmd: '/reminders',   icon: '🔔' },
  { label: 'Deal Report', cmd: '/dealanalysis',icon: '📈' },
  { label: 'Post',        cmd: '/post ',       icon: '📱' },
  { label: 'Contractors', cmd: '/contractors', icon: '👷' },
];

function renderMessageContent(content: string, streaming?: boolean): React.ReactNode {
  const parts = content.split(/(\*\*[^*]+\*\*)/g);
  const rendered = parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
  return (
    <span className="whitespace-pre-wrap">
      {rendered}
      {streaming && (
        <motion.span
          className="inline-block w-[2px] h-[1em] bg-[var(--gold)] ml-0.5 align-middle"
          animate={{ opacity: [1, 0, 1] }}
          transition={{ duration: 0.8, repeat: Infinity }}
        />
      )}
    </span>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  const isAgent = msg.source === 'agent';
  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      {/* Agent name label for Telegram-mirrored messages */}
      {isAgent && msg.agentName && (
        <div className="mb-1 flex items-center gap-1 px-1">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            📡 {msg.agentName}
          </span>
          <span className="text-[9px] text-[var(--text-subtle)]">· Telegram</span>
        </div>
      )}
      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
        isUser
          ? 'bg-[var(--gold-dim)] border border-[var(--gold)]/30 text-[var(--text)]'
          : isAgent
          ? 'bg-[var(--surface-2)] border border-[var(--border)] border-l-[3px] border-l-[var(--text-muted)] text-[var(--text-secondary)]'
          : 'bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-secondary)]'
      }`}>
        {renderMessageContent(msg.content, msg.streaming)}

        {msg.agentTriggers && msg.agentTriggers.length > 0 && (
          <div className="mt-2 space-y-1">
            {msg.agentTriggers.map(t => (
              <div key={t.command} className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs ${
                t.state === 'running' ? 'bg-[var(--gold-dim)] border border-[var(--gold)]/30' :
                t.state === 'done' ? 'bg-[var(--success-dim)] border border-[var(--success)]/30' :
                'bg-[var(--error-dim)] border border-[var(--error)]/30'
              }`}>
                <span>{t.state === 'running' ? '⚡' : t.state === 'done' ? '✓' : '✗'}</span>
                <span className="font-mono font-medium">{t.command}</span>
                {t.state === 'running' && <span className="text-[var(--gold)]">running...</span>}
                {t.state === 'done' && <span className="text-[var(--success)] truncate max-w-[200px]">{t.result?.substring(0, 60)}</span>}
                {t.state === 'error' && <span className="text-[var(--error)]">failed</span>}
              </div>
            ))}
          </div>
        )}

        <div className="mt-1 text-[10px] text-[var(--text-muted)]">
          {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}

const MIN_PANEL_WIDTH = 280;
const MAX_PANEL_WIDTH = 680;
const DEFAULT_PANEL_WIDTH = 460;

const MIN_FEED_PERCENT = 15;
const MAX_FEED_PERCENT = 75;
const DEFAULT_FEED_PERCENT = 35;

export function RightPanel({ isMobile, isOpen, onClose }: RightPanelProps = {}) {
  const { messages, isTyping, sendMessage, clearChat } = useDashboard();
  const [message, setMessage] = useState('');
  const [isRTL, setIsRTL] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Panel width resize state
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const isDraggingPanel = useRef(false);
  const panelDragStart = useRef({ x: 0, width: DEFAULT_PANEL_WIDTH });

  // Activity feed collapsed by default — chat gets full height
  const [activityOpen, setActivityOpen] = useState(false);

  // Internal split resize state (feed percent of total height, only used when activity is open)
  const [feedPercent, setFeedPercent] = useState(DEFAULT_FEED_PERCENT);
  const isDraggingSplit = useRef(false);
  const splitDragStart = useRef({ y: 0, percent: DEFAULT_FEED_PERCENT });
  const panelRef = useRef<HTMLDivElement>(null);

  // Sync panel width to CSS variable so main content adjusts.
  // On mobile or when maximized the panel is a full-screen overlay — never consume layout space.
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--right-panel-width',
      (isMobile || maximized) ? '0px' : `${panelWidth}px`
    );
    return () => {
      document.documentElement.style.removeProperty('--right-panel-width');
    };
  }, [panelWidth, isMobile, maximized]);

  // Panel width drag handlers
  const onPanelMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingPanel.current = true;
    panelDragStart.current = { x: e.clientX, width: panelWidth };

    const onMove = (ev: MouseEvent) => {
      if (!isDraggingPanel.current) return;
      const delta = panelDragStart.current.x - ev.clientX;
      const newWidth = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, panelDragStart.current.width + delta));
      setPanelWidth(newWidth);
    };
    const onUp = () => {
      isDraggingPanel.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [panelWidth]);

  // Internal split drag handlers
  const onSplitMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSplit.current = true;
    splitDragStart.current = { y: e.clientY, percent: feedPercent };

    const onMove = (ev: MouseEvent) => {
      if (!isDraggingSplit.current || !panelRef.current) return;
      const panelHeight = panelRef.current.clientHeight;
      const delta = ev.clientY - splitDragStart.current.y;
      const deltaPercent = (delta / panelHeight) * 100;
      const newPercent = Math.min(MAX_FEED_PERCENT, Math.max(MIN_FEED_PERCENT, splitDragStart.current.percent + deltaPercent));
      setFeedPercent(newPercent);
    };
    const onUp = () => {
      isDraggingSplit.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [feedPercent]);

  // Auto-scroll to bottom when new messages arrive
  // Use 'instant' to avoid janky mobile smooth scroll
  useEffect(() => {
    const el = messagesEndRef.current;
    if (!el) return;
    // Small timeout to let the DOM update before scrolling
    const t = setTimeout(() => el.scrollIntoView({ behavior: 'instant' }), 50);
    return () => clearTimeout(t);
  }, [messages, isTyping]);

  // Detect Arabic text for RTL
  useEffect(() => {
    const arabicPattern = /[\u0600-\u06FF]/;
    setIsRTL(arabicPattern.test(message));
  }, [message]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [message]);

  const handleSend = () => {
    if (!message.trim()) return;
    sendMessage(message);
    setMessage('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setMessage(suggestion);
    textareaRef.current?.focus();
  };

  // Mobile: full-screen overlay
  if (isMobile) {
    return (
      <>
        <div className={`mobile-backdrop ${isOpen ? 'open' : ''}`} onClick={onClose} />
        <div
          className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-[var(--bg-primary)] transition-transform duration-300 ease-out"
          style={{
            top: 'env(safe-area-inset-top, 0px)',
            transform: isOpen ? 'translateY(0)' : 'translateY(100%)',
          }}
        >
          {/* Mobile chat header */}
          <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3 shrink-0">
            <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-lg active:bg-[var(--surface-2)]">
              <ArrowLeft className="h-5 w-5 text-[var(--text)]" />
            </button>
            <div className="flex items-center gap-2.5 flex-1">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--gold)] to-[var(--gold-bright)]">
                <Sparkles className="h-4 w-4 text-black" />
              </div>
              <div>
                <div className="text-sm font-semibold text-[var(--text)]">STANDME AI</div>
                <div className="text-[10px] text-[var(--text-muted)]">{isTyping ? 'Thinking...' : 'Ready'}</div>
              </div>
            </div>
            <button onClick={clearChat} className="rounded-md p-2 text-[var(--text-muted)] active:bg-[var(--surface-2)]">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div className="space-y-4">
              {messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)}
              {isTyping && (
                <div className="flex items-center gap-2 px-4 py-2">
                  <div className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-2 w-2 rounded-full bg-[var(--gold)]"
                        style={{ animation: `typingBounce 0.6s ease-in-out ${i * 0.2}s infinite` }} />
                    ))}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            {messages.length <= 1 && (
              <div className="border-t border-[var(--border-subtle)] pt-4 mt-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Quick Actions</div>
                <div className="flex flex-wrap gap-2">
                  {suggestedQuestions.map((s) => (
                    <button key={s} onClick={() => handleSuggestionClick(s)}
                      className="rounded-lg border border-[var(--gold)]/40 px-3 py-2 text-xs text-[var(--gold)] active:bg-[var(--gold-dim)]">{s}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Mobile input */}
          <div className="border-t border-[var(--border-subtle)] bg-[var(--surface)] p-3 shrink-0 mobile-safe-bottom">
            {/* Command chips — horizontal scroll */}
            <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {SUGGESTED_COMMANDS.map(({ label, cmd, icon }) => (
                <button
                  key={cmd}
                  onClick={() => { setMessage(cmd); textareaRef.current?.focus(); }}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--gold)]/60 hover:text-[var(--gold)] active:bg-[var(--gold-dim)]"
                >
                  <span>{icon}</span>
                  <span className="font-medium">{label}</span>
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything..."
                className={`flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--gold)] ${
                  isRTL ? 'text-right' : 'text-left'
                }`}
                rows={1}
                style={{ maxHeight: '120px' }}
              />
              <motion.button
                onClick={handleSend}
                disabled={!message.trim()}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--gold)] text-black disabled:opacity-40"
                whileTap={message.trim() ? { scale: 0.95 } : {}}
              >
                <Send className="h-4 w-4" />
              </motion.button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── DESKTOP ──
  return (
    <div
      className={maximized
        ? 'fixed inset-0 top-[var(--topbar-height)] z-50 bg-[var(--bg-primary)] border-l border-[var(--border-subtle)]'
        : 'fixed right-0 top-[var(--topbar-height)] z-40 h-[calc(100vh-var(--topbar-height))] border-l border-[var(--border-subtle)] bg-[var(--surface)]/80 backdrop-blur-xl'
      }
      style={maximized ? {} : { width: panelWidth }}
    >
      {/* Left edge drag handle — resize panel width */}
      <div
        onMouseDown={onPanelMouseDown}
        className="absolute left-0 top-0 h-full w-1 cursor-col-resize group z-50 hover:bg-[var(--gold)]/40 transition-colors"
        title="Drag to resize panel"
      >
        <div className="absolute left-[-3px] top-1/2 -translate-y-1/2 flex h-10 w-2 items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <GripVertical className="h-4 w-4 text-[var(--gold)]" />
        </div>
      </div>

      <div ref={panelRef} className="flex h-full flex-col">
        {/* Activity Feed — collapsed to header strip by default */}
        <div className="shrink-0 border-b border-[var(--border-subtle)]">
          {/* Clickable header strip — always visible */}
          <button
            onClick={() => setActivityOpen(o => !o)}
            className="flex w-full items-center justify-between px-4 py-2.5 hover:bg-[var(--surface-2)] transition-colors group"
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Live Activity</span>
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)] animate-pulse" />
            </div>
            {activityOpen
              ? <ChevronUp className="h-3.5 w-3.5 text-[var(--text-muted)] group-hover:text-[var(--text)]" />
              : <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)] group-hover:text-[var(--text)]" />
            }
          </button>

          {/* Expandable feed body */}
          <AnimatePresence initial={false}>
            {activityOpen && (
              <motion.div
                key="activity-feed"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: `${feedPercent}vh`, opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="overflow-hidden"
                style={{ minHeight: 0 }}
              >
                <ActivityFeed />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Resize handle — only visible when feed is open */}
          {activityOpen && (
            <div
              onMouseDown={onSplitMouseDown}
              className="relative flex h-4 cursor-row-resize items-center justify-center group hover:bg-[var(--surface-2)] transition-colors"
              title="Drag to adjust size"
            >
              <div className="h-px w-full bg-gradient-to-r from-transparent via-[var(--gold)] to-transparent opacity-30 group-hover:opacity-60 transition-opacity" />
              <div className="absolute flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="h-1 w-6 rounded-full bg-[var(--gold)]/60" />
              </div>
            </div>
          )}
        </div>

        {/* AI Chat Section */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Chat Header */}
          <div className="border-b border-[var(--border-subtle)] px-5 py-4 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--gold)] to-[var(--gold-bright)] shadow-[var(--shadow-gold)]">
                  <Sparkles className="h-5 w-5 text-black" />
                </div>

                <div>
                  <div className="text-sm font-semibold text-[var(--text)]">STANDME AI</div>
                  <div className="text-[10px] text-[var(--text-muted)]">
                    {isTyping ? 'Thinking...' : 'Ready'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={clearChat}
                  className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                  title="Clear chat"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setMaximized(m => !m)}
                  className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--gold)]"
                  title={maximized ? 'Collapse chat' : 'Full-screen chat'}
                >
                  {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="space-y-4">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}

              {isTyping && (
                <motion.div
                  className="flex items-center gap-2 px-4 py-2"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <div className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-2 w-2 rounded-full bg-[var(--gold)]"
                        style={{ animation: `typingBounce 0.6s ease-in-out ${i * 0.2}s infinite` }} />
                    ))}
                  </div>
                </motion.div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {messages.length <= 1 && (
              <motion.div
                className="border-t border-[var(--border-subtle)] pt-4"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Quick Actions
                </div>
                <div className="flex flex-wrap gap-2">
                  {suggestedQuestions.map((suggestion) => (
                    <motion.button
                      key={suggestion}
                      onClick={() => handleSuggestionClick(suggestion)}
                      className="rounded-lg border border-[var(--gold)]/40 bg-transparent px-3 py-1.5 text-xs text-[var(--gold)] transition-all hover:border-[var(--gold)] hover:bg-[var(--gold-dim)]"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      {suggestion}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}
          </div>

          {/* Chat Input */}
          <div className="border-t border-[var(--border-subtle)] p-4 shrink-0">
            {/* Command chips — horizontal scroll */}
            <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {SUGGESTED_COMMANDS.map(({ label, cmd, icon }) => (
                <motion.button
                  key={cmd}
                  onClick={() => { setMessage(cmd); textareaRef.current?.focus(); }}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--gold)]/60 hover:text-[var(--gold)] hover:bg-[var(--gold-dim)]"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <span>{icon}</span>
                  <span className="font-medium">{label}</span>
                </motion.button>
              ))}
            </div>
            <div className={`relative rounded-xl border bg-[var(--surface-2)] transition-all focus-within:border-[var(--gold)] ${
              isRTL ? 'border-[var(--gold)]/30' : 'border-[var(--border)]'
            }`}>
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything — Arabic or English   اسأل أي شيء"
                className={`w-full resize-none bg-transparent px-4 py-3 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none ${
                  isRTL ? 'text-right' : 'text-left'
                }`}
                rows={1}
                style={{ maxHeight: '120px' }}
              />

              <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-3 py-2">
                <div className="text-[10px] text-[var(--text-muted)]">
                  <kbd className="rounded bg-[var(--surface-3)] px-1 py-0.5">Shift+Enter</kbd> new line
                </div>

                <motion.button
                  onClick={handleSend}
                  disabled={!message.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--gold)] px-4 py-2 text-xs font-semibold text-black transition-all hover:bg-[var(--gold-bright)] disabled:opacity-50 disabled:cursor-not-allowed"
                  whileHover={message.trim() ? { scale: 1.02 } : {}}
                  whileTap={message.trim() ? { scale: 0.98 } : {}}
                >
                  <Send className="h-3.5 w-3.5" />
                  Send
                </motion.button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
