/**
 * Unit tests for src/services/dashboard/event-bus.ts
 * Pure in-memory EventEmitter logic — no external dependencies.
 */
import { dashboardBus, AgentStatus, AgentEvent } from '../services/dashboard/event-bus';

// Use a fresh import if needed — but since dashboardBus is a singleton
// we just need to be careful about state across tests.

describe('DashboardEventBus.registerAgent', () => {
  it('registers a new agent with idle state', () => {
    dashboardBus.registerAgent('test-ev-1', 'TestAgent1');
    const statuses = dashboardBus.getStatuses();
    const found = statuses.find(s => s.id === 'test-ev-1');
    expect(found).toBeDefined();
    expect(found!.state).toBe('idle');
    expect(found!.runCount).toBe(0);
    expect(found!.errorCount).toBe(0);
  });

  it('is idempotent — registering twice does not duplicate', () => {
    dashboardBus.registerAgent('test-ev-idem', 'IdempotentAgent');
    dashboardBus.registerAgent('test-ev-idem', 'IdempotentAgent');
    const count = dashboardBus.getStatuses().filter(s => s.id === 'test-ev-idem').length;
    expect(count).toBe(1);
  });
});

describe('DashboardEventBus.agentStarted', () => {
  it('sets state to running and records command', () => {
    dashboardBus.registerAgent('start-agent', 'StartAgent');
    dashboardBus.agentStarted('start-agent', 'StartAgent', '/pipeline');
    const status = dashboardBus.getStatuses().find(s => s.id === 'start-agent');
    expect(status!.state).toBe('running');
    expect(status!.lastCommand).toBe('/pipeline');
  });

  it('emits an event on the bus', () => {
    const listener = jest.fn();
    dashboardBus.once('event', listener);
    dashboardBus.agentStarted('any-agent', 'AnyAgent', '/test');
    expect(listener).toHaveBeenCalledTimes(1);
    const event: AgentEvent = listener.mock.calls[0][0];
    expect(event.type).toBe('agent:start');
  });
});

describe('DashboardEventBus.agentFinished', () => {
  it('sets state to idle on success and increments runCount', () => {
    dashboardBus.registerAgent('finish-success', 'FinishSuccess');
    dashboardBus.agentStarted('finish-success', 'FinishSuccess', '/cmd');
    dashboardBus.agentFinished('finish-success', 'FinishSuccess', true, 250, 'done');
    const status = dashboardBus.getStatuses().find(s => s.id === 'finish-success');
    expect(status!.state).toBe('idle');
    expect(status!.lastResult).toBe('SUCCESS');
    expect(status!.runCount).toBe(1);
    expect(status!.errorCount).toBe(0);
    expect(status!.lastDuration).toBe(250);
  });

  it('sets state to error on failure and increments errorCount', () => {
    dashboardBus.registerAgent('finish-fail', 'FinishFail');
    dashboardBus.agentStarted('finish-fail', 'FinishFail', '/cmd');
    dashboardBus.agentFinished('finish-fail', 'FinishFail', false, 100, 'exploded');
    const status = dashboardBus.getStatuses().find(s => s.id === 'finish-fail');
    expect(status!.state).toBe('error');
    expect(status!.lastResult).toBe('FAIL');
    expect(status!.errorCount).toBe(1);
  });

  it('emits agent:end event on success', () => {
    const listener = jest.fn();
    dashboardBus.once('event', listener);
    dashboardBus.agentFinished('emit-end', 'EmitEnd', true, 50, 'ok');
    const event: AgentEvent = listener.mock.calls[0][0];
    expect(event.type).toBe('agent:end');
  });

  it('emits agent:error event on failure', () => {
    const listener = jest.fn();
    dashboardBus.once('event', listener);
    dashboardBus.agentFinished('emit-err', 'EmitErr', false, 50, 'oops');
    const event: AgentEvent = listener.mock.calls[0][0];
    expect(event.type).toBe('agent:error');
  });
});

describe('DashboardEventBus.getRecentLogs', () => {
  it('accumulates log events', () => {
    const before = dashboardBus.getRecentLogs().length;
    dashboardBus.agentStarted('log-test', 'LogTest', '/log');
    const after = dashboardBus.getRecentLogs().length;
    expect(after).toBeGreaterThan(before);
  });
});

describe('DashboardEventBus.getSystemStats', () => {
  it('returns totalRuns, totalErrors, activeAgents, uptimeSince', () => {
    const stats = dashboardBus.getSystemStats();
    expect(typeof stats.totalRuns).toBe('number');
    expect(typeof stats.totalErrors).toBe('number');
    expect(typeof stats.activeAgents).toBe('number');
    expect(typeof stats.uptimeSince).toBe('string');
  });

  it('activeAgents reflects running count', () => {
    dashboardBus.registerAgent('active-check', 'ActiveCheck');
    dashboardBus.agentStarted('active-check', 'ActiveCheck', '/x');
    const stats = dashboardBus.getSystemStats();
    expect(stats.activeAgents).toBeGreaterThan(0);
    // Finish to clean state
    dashboardBus.agentFinished('active-check', 'ActiveCheck', true, 1, 'done');
  });
});

describe('DashboardEventBus.approvalEvent', () => {
  it('emits approval type event', () => {
    const listener = jest.fn();
    dashboardBus.once('event', listener);
    dashboardBus.approvalEvent('approval-agent', 'ApprovalAgent', 'Send email', 'appr-123');
    const event: AgentEvent = listener.mock.calls[0][0];
    expect(event.type).toBe('approval');
    expect(event.data.approvalId).toBe('appr-123');
    expect(event.data.what).toBe('Send email');
  });
});
