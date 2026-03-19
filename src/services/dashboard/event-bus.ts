import { EventEmitter } from 'events';

export interface AgentEvent {
  type: 'agent:start' | 'agent:end' | 'agent:error' | 'log' | 'approval';
  agentId: string;
  agentName: string;
  timestamp: string;
  data: Record<string, unknown>;
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

  // Broadcast a full agent response message to the dashboard live chat
  broadcastToChat(agentName: string, message: string): void {
    this.emit('chat:broadcast', {
      agentName,
      message,
      timestamp: new Date().toISOString(),
    });
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
