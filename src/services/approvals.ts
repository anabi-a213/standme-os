/**
 * Shared pending approvals store.
 * Keeps callbacks in memory so approval/reject handlers in index.ts
 * can execute the real action registered by any agent.
 *
 * ⚠️  IN-MEMORY ONLY — approvals do NOT survive a Railway redeploy.
 *     If Mo clicks /approve_xxx after a restart it will return null.
 *     For bulk outreach approvals, reconstructBulkApproval() in the
 *     outreach agent handles this via a Knowledge Base fallback.
 *     All other approval types require re-running the original command.
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

// Guard: track approvals currently executing so double-taps (Mo pressing approve twice)
// cannot fire the callback a second time before the first completes.
const executingApprovals = new Set<string>();

export function registerApproval(id: string, approval: PendingApproval): void {
  // Expire approvals older than 24 hours
  const now = Date.now();
  for (const [key, val] of pendingApprovals) {
    if (now - val.timestamp > 86400000) pendingApprovals.delete(key);
  }
  pendingApprovals.set(id, approval);
  logger.info(`[Approvals] Registered: ${id} — "${approval.action}" (in-memory only — lost on restart)`);
}

export async function handleApproval(id: string, approved: boolean): Promise<string | null> {
  const pending = pendingApprovals.get(id);
  if (!pending) {
    logger.warn(`[Approvals] handleApproval(${id}): not found — callback expired (server restart?) or ID is wrong`);
    return null;
  }

  // Reject expired approvals defensively (should already be cleaned up by registerApproval,
  // but guard here too so a stale entry cannot be executed after 24h)
  if (Date.now() - pending.timestamp > 86400000) {
    pendingApprovals.delete(id);
    logger.warn(`[Approvals] handleApproval(${id}): approval expired (>24h old) — deleted`);
    return null;
  }

  // Prevent double-execution: if this approval is already running (Mo pressed approve twice),
  // return a clear message rather than executing the callback a second time.
  if (executingApprovals.has(id)) {
    logger.warn(`[Approvals] handleApproval(${id}): already executing — duplicate request ignored`);
    return `⏳ This approval is already being processed. Please wait.`;
  }
  executingApprovals.add(id);

  // Delete the approval ONLY after the callback succeeds so that if the callback
  // throws unexpectedly, Mo can retry the same approval ID.
  // NOTE: the onApprove/onReject closures are written to return strings rather than
  // throw, but we guard against regressions here by catching and re-throwing after
  // we know whether to keep or remove the entry.
  let result: string;
  try {
    result = approved
      ? await pending.onApprove()
      : await (pending.onReject ? pending.onReject() : Promise.resolve(`Rejected: ${pending.action}`));
  } catch (err) {
    // Callback threw — leave the approval in place so Mo can retry.
    executingApprovals.delete(id);
    throw err;
  }
  // Only reach here on success — safe to delete now.
  executingApprovals.delete(id);
  pendingApprovals.delete(id);
  logger.info(`[Approvals] Executed: ${id} — ${approved ? 'APPROVED' : 'REJECTED'}`);
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
