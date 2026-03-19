const BASE = '/dashboard/api';

export interface AgentStatus {
  id: string;
  name: string;
  state: 'idle' | 'running' | 'error';
  lastRun?: string;
  lastDuration?: number;
  lastResult?: 'SUCCESS' | 'FAIL';
  lastCommand?: string;
  runCount: number;
  errorCount: number;
}

export interface AgentEvent {
  type: 'agent:start' | 'agent:end' | 'agent:error' | 'log' | 'approval';
  agentId: string;
  agentName: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface SystemStats {
  totalRuns: number;
  totalErrors: number;
  activeAgents: number;
  uptimeSince: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  commands: string[];
  schedule?: string | null;
  requiredRole: string;
}

export interface RunResult {
  ok: boolean;
  agent?: string;
  result?: string;
  success?: boolean;
  error?: string;
}

export async function fetchAgents(): Promise<AgentStatus[]> {
  const r = await fetch(`${BASE}/agents`);
  if (!r.ok) throw new Error(`fetchAgents failed: ${r.status}`);
  return r.json();
}

export async function fetchLogs(): Promise<AgentEvent[]> {
  const r = await fetch(`${BASE}/logs`);
  if (!r.ok) throw new Error(`fetchLogs failed: ${r.status}`);
  return r.json();
}

export async function fetchStats(): Promise<SystemStats> {
  const r = await fetch(`${BASE}/stats`);
  if (!r.ok) throw new Error(`fetchStats failed: ${r.status}`);
  return r.json();
}

export async function fetchAgentConfigs(): Promise<AgentConfig[]> {
  const r = await fetch(`${BASE}/agent-configs`);
  if (!r.ok) throw new Error(`fetchAgentConfigs failed: ${r.status}`);
  return r.json();
}

export async function triggerAgent(command: string, args?: string): Promise<void> {
  const r = await fetch(`${BASE}/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, args: args || '' }),
  });
  if (!r.ok) throw new Error(`triggerAgent failed: ${r.status}`);
}

export async function runAgent(command: string, args?: string): Promise<RunResult> {
  const r = await fetch(`${BASE}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, args: args || '' }),
  });
  if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
  return r.json();
}

export async function approveAction(approvalId: string, approved: boolean): Promise<void> {
  const r = await fetch(`${BASE}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approvalId, approved }),
  });
  if (!r.ok) throw new Error(`approveAction failed: ${r.status}`);
}

export interface TrelloCard {
  id: string;
  name: string;
  listName: string;
  due: string | null;
  labels: { name: string; color: string }[];
  url: string;
}

export type BoardsSnapshot = Record<string, TrelloCard[]>;

export async function fetchBoards(): Promise<BoardsSnapshot> {
  const r = await fetch(`${BASE}/boards`);
  if (!r.ok) throw new Error(`Failed to fetch boards: ${r.status}`);
  return r.json();
}
