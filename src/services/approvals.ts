/**
 * Shared pending approvals store.
 * Keeps callbacks in memory so approval/reject handlers in index.ts
 * can execute the real action registered by any agent.
 */

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
  pendingApprovals.set(id, approval);
}

export async function handleApproval(id: string, approved: boolean): Promise<string | null> {
  const pending = pendingApprovals.get(id);
  if (!pending) return null;

  // Delete AFTER the callback completes (in finally) so that if the callback
  // throws (e.g. Woodpecker is down), Mo can retry the same approval ID again.
  let result: string;
  try {
    result = approved
      ? await pending.onApprove()
      : await (pending.onReject ? pending.onReject() : Promise.resolve(`Rejected: ${pending.action}`));
  } finally {
    pendingApprovals.delete(id);
  }
  return result!;
}

export function hasPending(id: string): boolean {
  return pendingApprovals.has(id);
}
