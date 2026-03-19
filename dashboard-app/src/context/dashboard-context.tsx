import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from 'react';
import { getSocket } from '../lib/socket';
import { getSessionId } from '../lib/session';
import {
  AgentStatus, AgentEvent, AgentConfig, SystemStats,
  fetchAgents, fetchLogs, fetchStats, fetchAgentConfigs,
  triggerAgent as apiTrigger, runAgent as apiRun,
  approveAction as apiApprove, RunResult,
} from '../lib/api';

const MOBILE_BREAKPOINT = 768;

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
  autoDismiss?: boolean;
}

export interface PendingApproval {
  approvalId: string;
  agentName: string;
  action: string;
  details?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  streaming?: boolean;
  agentTriggers?: { command: string; state: 'running' | 'done' | 'error'; result?: string }[];
}

interface DashboardContextType {
  // Data
  agents: AgentStatus[];
  agentConfigs: AgentConfig[];
  activityEvents: AgentEvent[];
  systemStats: SystemStats;
  // Chat
  messages: ChatMessage[];
  isTyping: boolean;
  sessionId: string;
  // Approvals
  pendingApproval: PendingApproval | null;
  // Toasts
  toasts: Toast[];
  // Mobile
  isMobile: boolean;
  sidebarOpen: boolean;
  chatOpen: boolean;
  toggleSidebar: () => void;
  toggleChat: () => void;
  closeSidebar: () => void;
  closeChat: () => void;
  // Actions
  triggerAgent: (command: string, args?: string) => Promise<void>;
  runAgent: (command: string, args?: string) => Promise<RunResult>;
  sendMessage: (text: string) => void;
  clearChat: () => void;
  approveAction: (approvalId: string, approved: boolean) => Promise<void>;
  dismissApproval: () => void;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
}

const Ctx = createContext<DashboardContextType | null>(null);

export function useDashboard(): DashboardContextType {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDashboard must be used within DashboardProvider');
  return ctx;
}

const DEFAULT_STATS: SystemStats = { totalRuns: 0, totalErrors: 0, activeAgents: 0, uptimeSince: new Date().toISOString() };

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [agentConfigs, setAgentConfigs] = useState<AgentConfig[]>([]);
  const [activityEvents, setActivityEvents] = useState<AgentEvent[]>([]);
  const [systemStats, setSystemStats] = useState<SystemStats>(DEFAULT_STATS);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const sessionId = useRef(getSessionId()).current;
  const streamingMsgId = useRef<string | null>(null);

  // Mobile state
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobile(mobile);
      if (!mobile) { setSidebarOpen(false); setChatOpen(false); }
    };
    check(); // run once on mount to catch initial size
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const toggleSidebar = useCallback(() => { setSidebarOpen(p => !p); setChatOpen(false); }, []);
  const toggleChat = useCallback(() => { setChatOpen(p => !p); setSidebarOpen(false); }, []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const closeChat = useCallback(() => setChatOpen(false), []);

  const addToast = (toast: Omit<Toast, 'id'>) => {
    const t: Toast = { ...toast, id: Date.now().toString() };
    setToasts(p => [...p.slice(-4), t]);
    if (toast.autoDismiss !== false) {
      setTimeout(() => setToasts(p => p.filter(x => x.id !== t.id)), toast.type === 'error' ? 8000 : 4000);
    }
  };

  const dismissToast = (id: string) => setToasts(p => p.filter(t => t.id !== id));

  const addEvent = (event: AgentEvent) => {
    setActivityEvents(p => {
      const updated = [...p, event];
      return updated.slice(-200);
    });
  };

  // Load initial data
  useEffect(() => {
    Promise.all([fetchAgents(), fetchLogs(), fetchStats(), fetchAgentConfigs()])
      .then(([a, l, s, c]) => {
        setAgents(a);
        setActivityEvents(l);
        setSystemStats(s);
        setAgentConfigs(c);
      })
      .catch(() => addToast({ type: 'error', message: 'Failed to load dashboard data', autoDismiss: false }));
  }, []);

  // Socket.IO setup
  useEffect(() => {
    const socket = getSocket();

    socket.on('connect', () => {
      addToast({ type: 'success', message: 'Connected to StandMe OS' });
      // Request chat history
      socket.emit('chat:history', { sessionId });
    });

    socket.on('disconnect', () => {
      addToast({ type: 'error', message: 'Connection lost — reconnecting...', autoDismiss: false });
    });

    socket.on('connect_error', () => {
      addToast({ type: 'error', message: 'Cannot connect to server', autoDismiss: false });
    });

    // Initial state from server
    socket.on('init', (data: { agents: AgentStatus[]; logs: AgentEvent[]; stats: SystemStats }) => {
      setAgents(data.agents);
      setActivityEvents(data.logs);
      setSystemStats(data.stats);
    });

    // Agent state updates
    socket.on('agents', (data: AgentStatus[]) => setAgents(data));
    socket.on('stats', (data: SystemStats) => setSystemStats(data));
    socket.on('event', (event: AgentEvent) => {
      addEvent(event);
      // Handle approval events
      if (event.type === 'approval') {
        setPendingApproval({
          approvalId: event.data.approvalId as string,
          agentName: event.agentName,
          action: event.data.what as string,
          details: event.data.details as string | undefined,
        });
      }
    });

    // ── CHAT EVENTS ──
    socket.on('chat:welcome', (data: { text: string; timestamp: string }) => {
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: data.text,
        timestamp: new Date(data.timestamp),
      }]);
    });

    socket.on('chat:history', (data: { history: { role: string; content: string; timestamp: string }[]; sessionId: string }) => {
      if (data.sessionId !== sessionId) return;
      if (data.history.length === 0) return;
      setMessages(data.history.map((m, i) => ({
        id: `hist-${i}`,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: new Date(m.timestamp),
      })));
    });

    socket.on('chat:typing', (data: { sessionId: string }) => {
      if (data.sessionId !== sessionId) return;
      setIsTyping(true);
    });

    socket.on('chat:chunk', (data: { text: string; sessionId: string }) => {
      if (data.sessionId !== sessionId) return;
      setIsTyping(false);
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.id === streamingMsgId.current && last.role === 'assistant') {
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content + data.text, streaming: true },
          ];
        }
        const newId = `ai-${Date.now()}`;
        streamingMsgId.current = newId;
        return [...prev, {
          id: newId,
          role: 'assistant',
          content: data.text,
          timestamp: new Date(),
          streaming: true,
          agentTriggers: [],
        }];
      });
    });

    socket.on('chat:agent_start', (data: { command: string; sessionId: string }) => {
      if (data.sessionId !== sessionId) return;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        const triggers = [...(last.agentTriggers || [])];
        const existing = triggers.findIndex(t => t.command === data.command);
        if (existing >= 0) {
          triggers[existing] = { ...triggers[existing], state: 'running' };
        } else {
          triggers.push({ command: data.command, state: 'running' });
        }
        return [...prev.slice(0, -1), { ...last, agentTriggers: triggers }];
      });
    });

    socket.on('chat:agent_done', (data: { command: string; result: string; success: boolean; sessionId: string }) => {
      if (data.sessionId !== sessionId) return;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        const triggers = [...(last.agentTriggers || [])];
        const idx = triggers.findIndex(t => t.command === data.command);
        if (idx >= 0) {
          triggers[idx] = { command: data.command, state: data.success ? 'done' : 'error', result: data.result };
        }
        return [...prev.slice(0, -1), { ...last, agentTriggers: triggers }];
      });
    });

    socket.on('chat:done', (data: { sessionId: string }) => {
      if (data.sessionId !== sessionId) return;
      setIsTyping(false);
      streamingMsgId.current = null;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.streaming) {
          return [...prev.slice(0, -1), { ...last, streaming: false }];
        }
        return prev;
      });
    });

    socket.on('chat:error', (data: { message: string; sessionId: string }) => {
      if (data.sessionId !== sessionId) return;
      setIsTyping(false);
      streamingMsgId.current = null;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.streaming) {
          return [...prev.slice(0, -1), { ...last, streaming: false }];
        }
        return prev;
      });
      addToast({ type: 'error', message: `Chat error: ${data.message}` });
    });

    socket.on('chat:cleared', (data: { sessionId: string }) => {
      if (data.sessionId !== sessionId) return;
      setMessages([]);
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.off('init');
      socket.off('agents');
      socket.off('stats');
      socket.off('event');
      socket.off('chat:welcome');
      socket.off('chat:history');
      socket.off('chat:typing');
      socket.off('chat:chunk');
      socket.off('chat:agent_start');
      socket.off('chat:agent_done');
      socket.off('chat:done');
      socket.off('chat:error');
      socket.off('chat:cleared');
    };
  }, [sessionId]);

  const triggerAgent = async (command: string, args?: string) => {
    try {
      await apiTrigger(command, args);
      addToast({ type: 'info', message: `▶ ${command} triggered` });
    } catch (err: any) {
      addToast({ type: 'error', message: `Failed to trigger ${command}: ${err.message}` });
    }
  };

  const runAgent = async (command: string, args?: string): Promise<RunResult> => {
    try {
      return await apiRun(command, args);
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  };

  const sendMessage = (text: string) => {
    if (!text.trim()) return;
    const socket = getSocket();
    // Add user message immediately
    setMessages(prev => [...prev, {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    }]);
    socket.emit('chat:send', { message: text, sessionId });
  };

  const clearChat = () => {
    const socket = getSocket();
    socket.emit('chat:clear', { sessionId });
  };

  const approveAction = async (approvalId: string, approved: boolean) => {
    await apiApprove(approvalId, approved);
    setPendingApproval(null);
    addToast({ type: 'success', message: approved ? '✓ Action approved' : '✕ Action rejected' });
  };

  const dismissApproval = () => setPendingApproval(null);

  return (
    <Ctx.Provider value={{
      agents, agentConfigs, activityEvents, systemStats,
      messages, isTyping, sessionId,
      pendingApproval, toasts,
      isMobile, sidebarOpen, chatOpen, toggleSidebar, toggleChat, closeSidebar, closeChat,
      triggerAgent, runAgent, sendMessage, clearChat,
      approveAction, dismissApproval,
      addToast, dismissToast,
    }}>
      {children}
    </Ctx.Provider>
  );
}
