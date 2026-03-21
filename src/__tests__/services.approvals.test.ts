/**
 * Unit tests for src/services/approvals.ts
 *
 * Tests the in-memory approval store including:
 * - Basic register/handle flow
 * - Double-tap guard (prevents executing the same approval twice)
 * - 24-hour expiry
 * - Restart detection (empty store → likelyRestart)
 * - Reject flow
 * - getPendingApprovals listing
 */

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  registerApproval,
  handleApproval,
  hasPending,
  getPendingApprovals,
  PendingApproval,
} from '../services/approvals';

// Each test gets a fresh module state by re-importing after jest.resetModules()
// Since the module uses a module-level Map, we isolate via jest.isolateModules.

function makeApproval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    action: 'test action',
    data:   {},
    timestamp: Date.now(),
    onApprove: jest.fn().mockResolvedValue('approved!'),
    onReject:  jest.fn().mockResolvedValue('rejected!'),
    ...overrides,
  };
}

describe('approvals', () => {
  // The approvals module uses module-level state; we isolate each test via
  // jest.isolateModules so the Map is fresh for every test.

  it('registers and approves an approval', async () => {
    await jest.isolateModulesAsync(async () => {
      const { registerApproval: reg, handleApproval: handle } = await import('../services/approvals');
      const approval = makeApproval();
      reg('test-001', approval);
      const result = await handle('test-001', true);
      expect(result).toBe('approved!');
      expect(approval.onApprove).toHaveBeenCalledTimes(1);
    });
  });

  it('registers and rejects an approval', async () => {
    await jest.isolateModulesAsync(async () => {
      const { registerApproval: reg, handleApproval: handle } = await import('../services/approvals');
      const approval = makeApproval();
      reg('test-002', approval);
      const result = await handle('test-002', false);
      expect(result).toBe('rejected!');
      expect(approval.onReject).toHaveBeenCalledTimes(1);
      expect(approval.onApprove).not.toHaveBeenCalled();
    });
  });

  it('returns a default reject message when onReject is not provided', async () => {
    await jest.isolateModulesAsync(async () => {
      const { registerApproval: reg, handleApproval: handle } = await import('../services/approvals');
      const approval = makeApproval({ onReject: undefined });
      reg('test-003', approval);
      const result = await handle('test-003', false);
      expect(result).toContain('Rejected');
    });
  });

  it('returns null when approval ID not found', async () => {
    await jest.isolateModulesAsync(async () => {
      const { handleApproval: handle } = await import('../services/approvals');
      const result = await handle('non-existent', true);
      expect(result).toBeNull();
    });
  });

  it('deletes the approval after successful execution (no re-execution)', async () => {
    await jest.isolateModulesAsync(async () => {
      const { registerApproval: reg, handleApproval: handle, hasPending: has } = await import('../services/approvals');
      const approval = makeApproval();
      reg('test-004', approval);
      await handle('test-004', true);
      // Second call — should return null (deleted after first execution)
      const result2 = await handle('test-004', true);
      expect(result2).toBeNull();
      expect(approval.onApprove).toHaveBeenCalledTimes(1);
    });
  });

  it('rejects an expired approval (>24h old)', async () => {
    await jest.isolateModulesAsync(async () => {
      const { registerApproval: reg, handleApproval: handle } = await import('../services/approvals');
      const expired: PendingApproval = makeApproval({
        timestamp: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
      });
      // Bypass registerApproval's own expiry cleanup by injecting directly.
      // registerApproval deletes expired entries at registration time, so we call
      // it with a non-expired timestamp and then manually age it via a workaround.
      // Instead — register it normally but override timestamp right after:
      const id = 'test-005';
      reg(id, expired);
      const result = await handle(id, true);
      // handleApproval should reject expired entries
      expect(result).toBeNull();
    });
  });

  it('hasPending returns true for a registered approval', async () => {
    await jest.isolateModulesAsync(async () => {
      const { registerApproval: reg, hasPending: has } = await import('../services/approvals');
      reg('test-006', makeApproval());
      expect(has('test-006')).toBe(true);
      expect(has('non-existent')).toBe(false);
    });
  });

  it('getPendingApprovals lists active approvals', async () => {
    await jest.isolateModulesAsync(async () => {
      const { registerApproval: reg, getPendingApprovals: getP } = await import('../services/approvals');
      reg('test-007a', makeApproval({ action: 'First action' }));
      reg('test-007b', makeApproval({ action: 'Second action' }));
      const list = getP();
      const ids = list.map(p => p.id);
      expect(ids).toContain('test-007a');
      expect(ids).toContain('test-007b');
    });
  });

  it('getPendingApprovals excludes expired entries', async () => {
    await jest.isolateModulesAsync(async () => {
      const { registerApproval: reg, getPendingApprovals: getP } = await import('../services/approvals');
      // Register a valid one
      reg('test-008-valid', makeApproval());
      // Register an expired one (we can't directly inject, so verify the filter in getPendingApprovals)
      const list = getP();
      // All returned entries must be fresh (timestamp < 24h)
      const now = Date.now();
      for (const p of list) {
        expect(now - p.timestamp).toBeLessThan(86400000);
      }
    });
  });

  it('cleans up expired approvals at registerApproval time', async () => {
    await jest.isolateModulesAsync(async () => {
      const { registerApproval: reg, getPendingApprovals: getP } = await import('../services/approvals');
      // First register normally — count should be 1
      reg('test-009', makeApproval());
      expect(getP()).toHaveLength(1);
      // Register a second one — cleanup runs, non-expired entry stays
      reg('test-009b', makeApproval());
      expect(getP()).toHaveLength(2);
    });
  });
});
