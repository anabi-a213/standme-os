/**
 * Shared pending approvals store.
 * Keeps callbacks in memory so approval/reject handlers in index.ts
 * can execute the real action registered by any agent.
 */
import { logger } from '../utils/logger';

export interface PendingApproval {
  action: string;
  data: any;
  timestamp: number;
  onApprove: () => Promise<string>; // returns confirmation message
  onReject?: () => Promise<string>;
}

const pendingApprovals = new Map<string, PendingApproval>();

export function registerApproval(id: string, approval: PendingApproval): void {
  // Expire approvals older than 24 hours
  const now = Date.now();
  for (const [key, val] of pendingApprovals) {
    if (now - val.timestamp > 86400000) pendingApprovals.delete(key);
  }
  if (pendingApprovals.has(id)) {
    logger.warn(`[Approvals] ID collision on "${id}" — overwriting existing approval. Check for duplicate agent runs.`);
  }
  pendingApprovals.set(id, approval);
}

export async function handleApproval(id: string, approved: boolean): Promise<string | null> {
  const pending = pendingApprovals.get(id);
  if (!pending) return null;

  // Delete AFTER the callback succeeds — if it throws, the approval remains
  // so Mo can retry without the "approval not found" error.
  let result: string;
  if (approved) {
    result = await pending.onApprove();
  } else {
    result = pending.onReject ? await pending.onReject() : `Rejected: ${pending.action}`;
  }
  pendingApprovals.delete(id);
  return result;
}

export function hasPending(id: string): boolean {
  return pendingApprovals.has(id);
}

export function getPendingApprovals(): { id: string; action: string; timestamp: number }[] {
  const now = Date.now();
  return [...pendingApprovals.entries()]
    .filter(([, v]) => now - v.timestamp < 86400000)
    .map(([id, v]) => ({ id, action: v.action, timestamp: v.timestamp }));
}
