import { EventEmitter } from 'events';
import type { Server as SocketServer } from 'socket.io';

export interface AgentEvent {
  type: 'agent:start' | 'agent:end' | 'agent:error' | 'log' | 'approval';
  agentId: string;
  agentName: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface BroadcastMessage {
  agentName: string;
  message: string;
  timestamp: string;
}

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

class DashboardEventBus extends EventEmitter {
  private agentStatuses = new Map<string, AgentStatus>();
  private recentLogs: AgentEvent[] = [];
  private readonly MAX_LOGS = 200;

  // Direct reference to the Socket.IO server — set once from socket.ts after io is created.
  // This avoids any EventEmitter relay and guarantees delivery.
  private _io: SocketServer | null = null;
  private recentBroadcasts: BroadcastMessage[] = [];
  private readonly MAX_BROADCASTS = 50;

  /** Called once from socket.ts after the SocketServer is created */
  setIO(server: SocketServer): void {
    this._io = server;
  }

  /** Returns recent broadcasts so new clients can catch up on connect */
  getRecentBroadcasts(): BroadcastMessage[] {
    return this.recentBroadcasts;
  }

  registerAgent(id: string, name: string): void {
    if (!this.agentStatuses.has(id)) {
      this.agentStatuses.set(id, {
        id,
        name,
        state: 'idle',
        runCount: 0,
        errorCount: 0,
      });
    }
  }

  agentStarted(id: string, name: string, command: string): void {
    const status = this.agentStatuses.get(id);
    if (status) {
      status.state = 'running';
      status.lastCommand = command;
    }
    const event: AgentEvent = {
      type: 'agent:start',
      agentId: id,
      agentName: name,
      timestamp: new Date().toISOString(),
      data: { command },
    };
    this.pushLog(event);
    this.emit('event', event);
  }

  agentFinished(id: string, name: string, success: boolean, duration: number, message: string): void {
    const status = this.agentStatuses.get(id);
    if (status) {
      status.state = success ? 'idle' : 'error';
      status.lastRun = new Date().toISOString();
      status.lastDuration = duration;
      status.lastResult = success ? 'SUCCESS' : 'FAIL';
      status.runCount++;
      if (!success) status.errorCount++;
    }
    const event: AgentEvent = {
      type: success ? 'agent:end' : 'agent:error',
      agentId: id,
      agentName: name,
      timestamp: new Date().toISOString(),
      data: { success, duration, message: message.substring(0, 300) },
    };
    this.pushLog(event);
    this.emit('event', event);
  }

  logEvent(agentId: string, agentName: string, message: string): void {
    const event: AgentEvent = {
      type: 'log',
      agentId,
      agentName,
      timestamp: new Date().toISOString(),
      data: { message },
    };
    this.pushLog(event);
    this.emit('event', event);
  }

  approvalEvent(agentId: string, agentName: string, what: string, approvalId: string): void {
    const event: AgentEvent = {
      type: 'approval',
      agentId,
      agentName,
      timestamp: new Date().toISOString(),
      data: { what, approvalId },
    };
    this.pushLog(event);
    this.emit('event', event);
  }

  /**
   * Mirror a full agent response to the dashboard live chat.
   * Stores the message in a ring buffer (so late-connecting clients see recent history)
   * then emits directly via Socket.IO — no EventEmitter relay, no drop risk.
   */
  broadcastToChat(agentName: string, message: string): void {
    const payload: BroadcastMessage = {
      agentName,
      message,
      timestamp: new Date().toISOString(),
    };
    // Buffer for late-connecting clients
    this.recentBroadcasts.push(payload);
    if (this.recentBroadcasts.length > this.MAX_BROADCASTS) {
      this.recentBroadcasts = this.recentBroadcasts.slice(-this.MAX_BROADCASTS);
    }
    // Emit directly — no EventEmitter hop
    if (this._io) {
      this._io.emit('chat:broadcast', payload);
    }
  }

  getStatuses(): AgentStatus[] {
    return Array.from(this.agentStatuses.values());
  }

  getRecentLogs(): AgentEvent[] {
    return this.recentLogs;
  }

  getSystemStats(): { totalRuns: number; totalErrors: number; activeAgents: number; uptimeSince: string } {
    const statuses = this.getStatuses();
    return {
      totalRuns: statuses.reduce((sum, s) => sum + s.runCount, 0),
      totalErrors: statuses.reduce((sum, s) => sum + s.errorCount, 0),
      activeAgents: statuses.filter(s => s.state === 'running').length,
      uptimeSince: this.startTime,
    };
  }

  private startTime = new Date().toISOString();

  private pushLog(event: AgentEvent): void {
    this.recentLogs.push(event);
    if (this.recentLogs.length > this.MAX_LOGS) {
      this.recentLogs = this.recentLogs.slice(-this.MAX_LOGS);
    }
  }
}

// Singleton
export const dashboardBus = new DashboardEventBus();
