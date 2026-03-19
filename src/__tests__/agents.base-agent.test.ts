/**
 * Unit tests for src/agents/base-agent.ts
 * Tests the run() orchestration logic without live APIs.
 *
 * All external dependencies are mocked:
 *   - logger (console noise)
 *   - telegram/bot (no real bot)
 *   - services/google/sheets (no Google API)
 *   - dashboard/event-bus (in-memory, but isolated)
 */

// ── Module mocks ──────────────────────────────────────────────────────────────
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../services/telegram/bot', () => ({
  getBot: jest.fn(() => ({ sendMessage: jest.fn().mockResolvedValue({}) })),
  formatType1: jest.fn((_w: string, _y: string, _d: string, _id: string) => 'TYPE1'),
  formatType2: jest.fn((_t: string, _d: string) => 'TYPE2'),
  formatType3: jest.fn((_t: string, _s: unknown[]) => 'TYPE3'),
  sendToMo: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/system-log', () => ({
  writeSystemLog: jest.fn().mockResolvedValue(undefined),
}));

// ──────────────────────────────────────────────────────────────────────────────

import { BaseAgent } from '../agents/base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';

// Helper: build a minimal AgentContext
function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    userId: 'test-user-123',
    chatId: 999,
    command: '/test',
    args: 'some args',
    role: UserRole.ADMIN,
    language: 'en',
    ...overrides,
  };
}

// Concrete TestAgent — execute() returns whatever we tell it to
class TestAgent extends BaseAgent {
  config: AgentConfig = {
    id: 'test-agent',
    name: 'Test Agent',
    description: 'for unit tests',
    commands: ['/test'],
    requiredRole: UserRole.ADMIN,
  };

  executeImpl: () => Promise<AgentResponse> = async () => ({
    success: true,
    message: 'default response',
    confidence: 'HIGH',
  });

  async execute(_ctx: AgentContext): Promise<AgentResponse> {
    return this.executeImpl();
  }
}

describe('BaseAgent.run', () => {
  let agent: TestAgent;

  beforeEach(() => {
    agent = new TestAgent();
    jest.clearAllMocks();
  });

  it('returns the result from execute() on success', async () => {
    agent.executeImpl = async () => ({ success: true, message: 'hello world', confidence: 'HIGH' });
    const result = await agent.run(makeContext());
    expect(result.success).toBe(true);
    expect(result.message).toBe('hello world');
  });

  it('returns success: false and descriptive message when execute() throws', async () => {
    agent.executeImpl = async () => { throw new Error('boom'); };
    const result = await agent.run(makeContext());
    expect(result.success).toBe(false);
    expect(result.message).toContain('boom');
    expect(result.confidence).toBe('LOW');
  });

  it('injects threadContext and activeFocus for real user IDs', async () => {
    let capturedCtx: AgentContext | null = null;
    agent.execute = async (ctx) => {
      capturedCtx = ctx;
      return { success: true, message: 'ok', confidence: 'HIGH' };
    };
    const ctx = makeContext({ userId: 'inject-user' });
    await agent.run(ctx);
    // threadContext is a string (possibly empty), activeFocus may be undefined
    expect(capturedCtx).not.toBeNull();
    expect('threadContext' in capturedCtx!).toBe(true);
  });

  it('does NOT inject threadContext for SYSTEM userId', async () => {
    let capturedCtx: AgentContext | null = null;
    agent.execute = async (ctx) => {
      capturedCtx = ctx;
      return { success: true, message: 'ok', confidence: 'HIGH' };
    };
    await agent.run(makeContext({ userId: 'SYSTEM' }));
    // threadContext should NOT be set for SYSTEM
    expect(capturedCtx!.threadContext).toBeUndefined();
  });

  it('calls sendToMo when execute() throws', async () => {
    const { sendToMo } = require('../services/telegram/bot');
    agent.executeImpl = async () => { throw new Error('fatal error'); };
    await agent.run(makeContext());
    expect(sendToMo).toHaveBeenCalledTimes(1);
  });
});

describe('BaseAgent.runScheduled', () => {
  it('calls run() with SYSTEM userId and "scheduled" command', async () => {
    const agent = new TestAgent();
    const spy = jest.spyOn(agent, 'run');
    await agent.runScheduled();
    expect(spy).toHaveBeenCalledTimes(1);
    const ctx = spy.mock.calls[0][0];
    expect(ctx.userId).toBe('SYSTEM');
    expect(ctx.command).toBe('scheduled');
  });
});
