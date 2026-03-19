import { motion } from 'motion/react';
import { Sparkles, User, CheckCircle, Loader } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  streaming?: boolean;
  agentTrigger?: {
    command: string;
    state: 'running' | 'done' | 'error';
    result?: string;
    duration?: string;
  };
}

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isRTL = /[\u0600-\u06FF]/.test(message.content);

  return (
    <motion.div
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Avatar */}
      {!isUser && (
        <motion.div 
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--gold)] to-[var(--gold-bright)]"
          animate={{ 
            boxShadow: [
              '0 0 10px rgba(201, 168, 76, 0.2)',
              '0 0 20px rgba(201, 168, 76, 0.4)',
              '0 0 10px rgba(201, 168, 76, 0.2)',
            ]
          }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <Sparkles className="h-4 w-4 text-black" />
        </motion.div>
      )}

      {isUser && (
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--surface-3)]">
          <User className="h-4 w-4 text-[var(--text-muted)]" />
        </div>
      )}

      {/* Message bubble */}
      <div className={`flex-1 ${isUser ? 'flex justify-end' : ''}`}>
        <motion.div
          className={`max-w-[85%] rounded-xl px-4 py-3 ${
            isUser
              ? 'bg-[var(--surface-warm)] border border-[var(--gold)]/20'
              : 'bg-[var(--surface-2)] border border-[var(--border)]'
          }`}
          initial={{ scale: 0.95 }}
          animate={{ scale: 1 }}
        >
          {/* Message content */}
          <div className={`text-sm leading-relaxed ${isUser ? 'text-[var(--text)]' : 'text-[var(--text-secondary)]'} ${isRTL ? 'text-right' : 'text-left'}`}>
            {message.content}
            {message.streaming && (
              <motion.span
                className="ml-1 inline-block h-4 w-0.5 bg-[var(--gold)]"
                animate={{ opacity: [1, 0, 1] }}
                transition={{ duration: 0.8, repeat: Infinity }}
              />
            )}
          </div>

          {/* Agent trigger card */}
          {message.agentTrigger && (
            <motion.div
              className={`mt-3 rounded-lg border p-3 ${
                message.agentTrigger.state === 'running'
                  ? 'border-[var(--gold)]/30 bg-[var(--gold-dim)]'
                  : message.agentTrigger.state === 'done'
                  ? 'border-[var(--success)]/30 bg-[var(--success-dim)]'
                  : 'border-[var(--error)]/30 bg-[var(--error-dim)]'
              }`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="flex items-center gap-2">
                {message.agentTrigger.state === 'running' && (
                  <Loader className="h-4 w-4 animate-spin text-[var(--gold)]" />
                )}
                {message.agentTrigger.state === 'done' && (
                  <CheckCircle className="h-4 w-4 text-[var(--success)]" />
                )}
                {message.agentTrigger.state === 'error' && (
                  <span className="text-[var(--error)]">✗</span>
                )}
                
                <span className={`flex-1 text-xs font-medium ${
                  message.agentTrigger.state === 'running' ? 'text-[var(--gold)]' :
                  message.agentTrigger.state === 'done' ? 'text-[var(--success)]' :
                  'text-[var(--error)]'
                }`}>
                  {message.agentTrigger.state === 'running' && `Running ${message.agentTrigger.command}...`}
                  {message.agentTrigger.state === 'done' && `${message.agentTrigger.command} — done in ${message.agentTrigger.duration}`}
                  {message.agentTrigger.state === 'error' && `${message.agentTrigger.command} failed`}
                </span>
              </div>

              {/* Progress bar for running state */}
              {message.agentTrigger.state === 'running' && (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                  <motion.div
                    className="h-full bg-[var(--gold)]"
                    animate={{ width: ['0%', '70%', '85%'] }}
                    transition={{ duration: 3, repeat: Infinity }}
                  />
                </div>
              )}

              {/* Result for done state */}
              {message.agentTrigger.state === 'done' && message.agentTrigger.result && (
                <div className="mt-2 text-xs text-[var(--text-muted)]">
                  {message.agentTrigger.result}
                  <button className="ml-2 text-[var(--gold)] hover:underline">
                    [full]
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {/* Timestamp */}
          <div className={`mt-2 text-[10px] text-[var(--text-subtle)] ${isRTL ? 'text-right' : 'text-left'}`}>
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
