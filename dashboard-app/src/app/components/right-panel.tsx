import { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Send, Paperclip, Maximize2, Trash2, Sparkles } from 'lucide-react';
import { ActivityFeed } from './activity-feed';
import { useDashboard } from '../../context/dashboard-context';
import type { ChatMessage } from '../../context/dashboard-context';

const suggestedQuestions = [
  "What's overdue?",
  "How are leads doing?",
  "Run a status check",
  "Any approvals pending?",
  "Show deadlines this week"
];

function renderMessageContent(content: string, streaming?: boolean): React.ReactNode {
  // Simple markdown-like rendering without new packages
  // Handle bold **text**
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
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
        isUser
          ? 'bg-[var(--gold-dim)] border border-[var(--gold)]/30 text-[var(--text)]'
          : 'bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-secondary)]'
      }`}>
        {renderMessageContent(msg.content, msg.streaming)}

        {/* Agent triggers */}
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

export function RightPanel() {
  const { messages, isTyping, sendMessage, clearChat } = useDashboard();
  const [message, setMessage] = useState('');
  const [isRTL, setIsRTL] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

  return (
    <div className="fixed right-0 top-[var(--topbar-height)] z-40 h-[calc(100vh-var(--topbar-height))] w-[var(--right-panel-width)] border-l border-[var(--border-subtle)] bg-[var(--surface)]/80 backdrop-blur-xl">
      <div className="flex h-full flex-col">
        {/* Activity Feed Section - 35% */}
        <div className="border-b border-[var(--border-subtle)]" style={{ height: '35%' }}>
          <ActivityFeed />
        </div>

        {/* Gold divider */}
        <div className="h-px bg-gradient-to-r from-transparent via-[var(--gold)] to-transparent opacity-30" />

        {/* AI Chat Section - 65% */}
        <div className="flex flex-1 flex-col" style={{ height: '65%' }}>
          {/* Chat Header */}
          <div className="border-b border-[var(--border-subtle)] px-5 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* AI Avatar */}
                <motion.div
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--gold)] to-[var(--gold-bright)] shadow-[var(--shadow-gold)]"
                  animate={{
                    boxShadow: [
                      '0 0 20px rgba(201, 168, 76, 0.3)',
                      '0 0 30px rgba(201, 168, 76, 0.5)',
                      '0 0 20px rgba(201, 168, 76, 0.3)',
                    ]
                  }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  <Sparkles className="h-5 w-5 text-black" />
                </motion.div>

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
                <button className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
                  <Maximize2 className="h-4 w-4" />
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

              {/* Typing indicator */}
              {isTyping && (
                <motion.div
                  className="flex items-center gap-2 px-4 py-2"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <div className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <motion.div
                        key={i}
                        className="h-2 w-2 rounded-full bg-[var(--gold)]"
                        animate={{ y: [0, -8, 0] }}
                        transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.2 }}
                      />
                    ))}
                  </div>
                </motion.div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Suggestion Chips — show only when messages are empty or just welcome */}
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
          <div className="border-t border-[var(--border-subtle)] p-4">
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

              {/* Input footer */}
              <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-3 py-2">
                <button className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)]">
                  <Paperclip className="h-3.5 w-3.5" />
                  <span>Attach args</span>
                </button>

                <div className="text-[10px] text-[var(--text-muted)]">
                  <kbd className="rounded bg-[var(--surface-3)] px-1 py-0.5">Shift+Enter</kbd> for new line · <kbd className="rounded bg-[var(--surface-3)] px-1 py-0.5">⌘K</kbd> for commands
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
