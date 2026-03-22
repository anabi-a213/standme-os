/**
 * Conflict Guard — Entity-Level Mutex
 *
 * Prevents two agents from working on the same entity concurrently.
 * Classic example: Agent-01 and Agent-18 both try to create a lead for
 * the same company at the same moment.
 *
 * In-memory only (lost on redeploy) — suitable for a single-process server.
 * 60-second TTL prevents a crashed agent from permanently locking an entity.
 *
 * Usage:
 *   if (!conflictGuard.acquire('lead:acme', this.config.id)) return; // skip
 *   try { ... } finally { conflictGuard.release('lead:acme'); }
 */

import { logger } from '../utils/logger';

const LOCK_TTL_MS = 60_000; // 60 seconds

interface LockEntry {
  agentId: string;
  acquiredAt: number;
}

class ConflictGuard {
  private locks = new Map<string, LockEntry>();

  /**
   * Try to acquire a lock on entityKey for agentId.
   * - Returns true if the lock was granted.
   * - Returns false if the entity is already locked by a DIFFERENT agent.
   * - The same agentId re-acquiring its own lock refreshes the TTL (idempotent).
   */
  acquire(entityKey: string, agentId: string): boolean {
    this.evictExpired();

    const existing = this.locks.get(entityKey);
    if (existing) {
      if (existing.agentId === agentId) {
        existing.acquiredAt = Date.now(); // refresh TTL
        return true;
      }
      logger.warn(
        `[ConflictGuard] DENIED: "${entityKey}" held by ${existing.agentId}, ` +
        `requested by ${agentId}`
      );
      return false;
    }

    this.locks.set(entityKey, { agentId, acquiredAt: Date.now() });
    logger.info(`[ConflictGuard] ACQUIRED: "${entityKey}" by ${agentId}`);
    return true;
  }

  /** Release a lock explicitly after the operation completes */
  release(entityKey: string): void {
    if (this.locks.has(entityKey)) {
      logger.info(`[ConflictGuard] RELEASED: "${entityKey}"`);
      this.locks.delete(entityKey);
    }
  }

  /** Check if an entity is locked (without acquiring) */
  isLocked(entityKey: string): boolean {
    this.evictExpired();
    return this.locks.has(entityKey);
  }

  /** Return which agent holds the lock, or null */
  lockedBy(entityKey: string): string | null {
    this.evictExpired();
    return this.locks.get(entityKey)?.agentId ?? null;
  }

  /** How many locks are currently active */
  activeLockCount(): number {
    this.evictExpired();
    return this.locks.size;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.locks) {
      if (now - entry.acquiredAt > LOCK_TTL_MS) {
        logger.info(
          `[ConflictGuard] EXPIRED (60s TTL): "${key}" was held by ${entry.agentId}`
        );
        this.locks.delete(key);
      }
    }
  }
}

export const conflictGuard = new ConflictGuard();
