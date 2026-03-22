/**
 * Shared pending approvals store.
 * Keeps callbacks in memory so approval/reject handlers in index.ts
 * can execute the real action registered by any agent.
 *
 * Callbacks are NOT serialisable, so full persistence is not possible.
 * However, approval *metadata* (action, data, timestamp) IS persisted to
 * the Knowledge Base so that on restart, index.ts can show Mo a
 * human-readable summary of what was pending, rather than a cryptic
 * "approval not found" message.
 *
 * For bulk outreach, reconstructBulkApproval() in the outreach agent still
 * provides full re-execution from KB. Other approval types still require
 * re-running the original command after a Railway restart.
 */

import { logger } from '../utils/logger';
import { saveKnowledge, updateKnowledge, sourceExistsInKnowledge, searchKnowledge } from './knowledge';

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
  logger.info(`[Approvals] Registered: ${id} — "${approval.action}" | total pending: ${pendingApprovals.size}`);

  // Persist metadata to KB so restarts show a human-readable pending list
  // (callbacks cannot be serialised — re-running the command is still required)
  persistApprovalToKB(id, approval).catch(() => {});
}

async function persistApprovalToKB(id: string, approval: PendingApproval): Promise<void> {
  const source = `pending-approval-${id}`;
  const content = JSON.stringify({
    id,
    action:    approval.action,
    data:      approval.data,
    timestamp: approval.timestamp,
  });
  try {
    const exists = await sourceExistsInKnowledge(source);
    if (exists) {
      await updateKnowledge(source, { content, lastUpdated: new Date().toISOString() } as any);
    } else {
      await saveKnowledge({
        source,
        sourceType: 'system',
        topic:      'pending-approval',
        tags:       `approval,pending,${id}`,
        content,
      });
    }
  } catch { /* non-critical — in-memory callbacks are the source of truth */ }
}

async function deleteApprovalFromKB(id: string): Promise<void> {
  try {
    // Mark as executed in KB (cannot delete rows from Sheets — overwrite instead)
    const source = `pending-approval-${id}`;
    const exists = await sourceExistsInKnowledge(source);
    if (exists) {
      await updateKnowledge(source, {
        content:     JSON.stringify({ id, status: 'EXECUTED', executedAt: new Date().toISOString() }),
        tags:        `approval,executed,${id}`,
        lastUpdated: new Date().toISOString(),
      } as any);
    }
  } catch { /* non-critical */ }
}

/**
 * On startup, scan KB for any pending approvals that were registered before a restart.
 * Notifies Mo that they are no longer valid and must be re-run.
 * Returns a summary string (empty string if nothing pending).
 */
export async function scanPendingApprovalsFromKB(): Promise<string> {
  try {
    const entries = await searchKnowledge('pending-approval', 50);
    const pending = entries.filter(e => {
      if (!e.source?.startsWith('pending-approval-')) return false;
      try {
        const data = JSON.parse(e.content);
        // Exclude already-executed entries and entries older than 24h
        if (data.status === 'EXECUTED') return false;
        if (Date.now() - (data.timestamp || 0) > 86400000) return false;
        return true;
      } catch { return false; }
    });

    if (pending.length === 0) return '';

    const lines = pending.map(e => {
      try {
        const data = JSON.parse(e.content);
        return `  • ${data.action} (ID: ${data.id})`;
      } catch { return `  • ${e.source}`; }
    });

    return `⚠️ ${pending.length} approval(s) were pending before the server restarted:\n${lines.join('\n')}\n\nRe-run the original command to get a fresh approval token.`;
  } catch {
    return '';
  }
}

export async function handleApproval(id: string, approved: boolean): Promise<string | null> {
  const pending = pendingApprovals.get(id);
  if (!pending) {
    // Distinguish between restart-loss and genuine expiry/wrong-ID:
    // There are currently 0 pending approvals only if the server just restarted.
    const likelyRestart = pendingApprovals.size === 0;
    logger.warn(
      `[Approvals] handleApproval(${id}): not found — ` +
      (likelyRestart
        ? 'server likely restarted (0 pending approvals in memory). Re-run the original command to get a fresh token.'
        : `ID not in pending map (${pendingApprovals.size} other approvals present). Check ID for typos.`)
    );
    return null;
  }

  // Reject expired approvals defensively (should already be cleaned up by registerApproval,
  // but guard here too so a stale entry cannot be executed after 24h)
  if (Date.now() - pending.timestamp > 86400000) {
    pendingApprovals.delete(id);
    logger.warn(
      `[Approvals] handleApproval(${id}): approval expired (>24h old) — deleted. ` +
      `Approval "${pending.action}" expired — was this from before a restart? Re-run the command to get a fresh approval token.`
    );
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
  deleteApprovalFromKB(id).catch(() => {}); // mark as executed in KB
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

/**
 * Log the current state of the approvals store.
 * Call this at startup so Railway logs show how many (if any) approvals
 * were registered before the process started — normally 0 after a cold start.
 */
export function logApprovalStoreStatus(): void {
  const count = pendingApprovals.size;
  if (count === 0) {
    logger.info('[Approvals] Startup: approval store is empty (expected after fresh start)');
  } else {
    // Should never happen on startup — would mean the Map survived somehow
    const list = [...pendingApprovals.entries()]
      .map(([id, v]) => `  • ${id}: "${v.action}"`)
      .join('\n');
    logger.warn(`[Approvals] Startup: ${count} approval(s) found in store:\n${list}`);
  }
}
