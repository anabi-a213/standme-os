/**
 * Thread Context Service
 *
 * Tracks per-user cross-agent conversation state:
 * - What entity (lead/project/show/contractor) the user is currently focused on
 * - Recent interactions across ALL agents (not just Brain)
 * - Provides context string any agent can inject into its AI prompt
 *
 * Thread context is now persisted to the Knowledge Base so sessions survive
 * Railway restarts. Saves are debounced (1 per user per 30s) to avoid quota hits.
 */

import { saveKnowledge, updateKnowledge, searchKnowledge, sourceExistsInKnowledge } from './knowledge';
import { logger } from '../utils/logger';

interface ThreadEntry {
  timestamp: number;
  agentId: string;
  command: string;
  userMsg: string;    // first 200 chars
  response: string;   // first 300 chars
  entityType?: string;
  entityName?: string;
}

interface UserThread {
  entries: ThreadEntry[];
  activeFocus?: { type: string; name: string };
  lastSeen: number;
}

const threads = new Map<string, UserThread>();
const MAX_ENTRIES = 20;
const SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours — stale sessions reset focus

// Debounce KB saves: track last save time per userId
const lastKbSave = new Map<string, number>();
const KB_SAVE_DEBOUNCE_MS = 30_000; // save at most once per 30s per user

function getOrCreate(userId: string): UserThread {
  let thread = threads.get(userId);
  if (!thread) {
    thread = { entries: [], lastSeen: Date.now() };
    threads.set(userId, thread);
  }
  // Reset active focus if user has been idle for a long time
  if (Date.now() - thread.lastSeen > SESSION_TIMEOUT_MS) {
    thread.activeFocus = undefined;
  }
  thread.lastSeen = Date.now();
  return thread;
}

/**
 * Returns a formatted string summarising the user's recent activity
 * across all agents. Inject this into any agent's AI prompt.
 */
export function getThreadContext(userId: string): string {
  const thread = threads.get(userId);
  if (!thread || thread.entries.length === 0) return '';

  const lines: string[] = ['--- THREAD CONTEXT ---'];

  if (thread.activeFocus) {
    lines.push(`CURRENTLY WORKING ON: ${thread.activeFocus.type.toUpperCase()} — "${thread.activeFocus.name}"`);
  }

  lines.push('RECENT ACTIVITY (newest first):');
  const recent = [...thread.entries].reverse().slice(0, 10);
  for (const entry of recent) {
    const ago = Math.round((Date.now() - entry.timestamp) / 60000);
    const timeStr = ago < 2 ? 'just now' : ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;
    const entity = entry.entityName ? ` [${entry.entityType}: ${entry.entityName}]` : '';
    lines.push(`  [${timeStr}] ${entry.command}${entity} → ${entry.response.substring(0, 150)}`);
  }

  return lines.join('\n');
}

/**
 * Save an agent interaction to the user's thread.
 * Call this after every agent execution.
 * Persists to KB (debounced) so sessions survive Railway restarts.
 */
export function saveThreadEntry(
  userId: string,
  agentId: string,
  command: string,
  userMsg: string,
  response: string,
  entity?: { type: string; name: string }
): void {
  const thread = getOrCreate(userId);

  thread.entries.push({
    timestamp: Date.now(),
    agentId,
    command,
    userMsg: userMsg.substring(0, 200),
    response: response.substring(0, 300),
    entityType: entity?.type,
    entityName: entity?.name,
  });

  // Keep last N entries
  while (thread.entries.length > MAX_ENTRIES) thread.entries.shift();

  // Update active focus if entity was provided
  if (entity) {
    thread.activeFocus = entity;
  }

  threads.set(userId, thread);

  // Persist to KB (debounced) — skip SYSTEM user (scheduled runs have no thread to restore)
  if (userId !== 'SYSTEM') {
    persistThreadToKB(userId, thread).catch(() => {}); // fire-and-forget, non-blocking
  }
}

/** Persist a user's thread to KB (debounced at 30s per user) */
async function persistThreadToKB(userId: string, thread: UserThread): Promise<void> {
  const now = Date.now();
  const lastSave = lastKbSave.get(userId) || 0;
  if (now - lastSave < KB_SAVE_DEBOUNCE_MS) return; // debounce

  lastKbSave.set(userId, now);

  const source = `thread-context-${userId}`;
  const content = JSON.stringify({
    activeFocus: thread.activeFocus,
    lastSeen:    thread.lastSeen,
    entries:     thread.entries.slice(-10), // save last 10 entries only
  });

  try {
    const exists = await sourceExistsInKnowledge(source);
    if (exists) {
      await updateKnowledge(source, { content, lastUpdated: new Date().toISOString() } as any);
    } else {
      await saveKnowledge({
        source,
        sourceType: 'system',
        topic:      `thread-context-${userId}`,
        tags:       `thread,context,user-${userId}`,
        content,
      });
    }
  } catch (err: any) {
    logger.warn(`[ThreadContext] KB persist failed for ${userId}: ${err.message}`);
  }
}

/**
 * Restore user thread sessions from KB on startup.
 * Call this in index.ts after KB is ready.
 */
export async function loadThreadsFromKB(): Promise<void> {
  try {
    const entries = await searchKnowledge('thread-context', 50);
    const threadEntries = entries.filter(e => e.source?.startsWith('thread-context-'));
    let loaded = 0;

    for (const entry of threadEntries) {
      try {
        const userId = entry.source.replace('thread-context-', '');
        const data = JSON.parse(entry.content);

        // Only restore sessions that are less than 4 hours old
        const age = Date.now() - (data.lastSeen || 0);
        if (age > SESSION_TIMEOUT_MS) continue;

        const thread: UserThread = {
          entries:     data.entries || [],
          activeFocus: data.activeFocus,
          lastSeen:    data.lastSeen || Date.now(),
        };
        threads.set(userId, thread);
        loaded++;
      } catch { /* corrupt entry — skip */ }
    }

    if (loaded > 0) logger.info(`[ThreadContext] Restored ${loaded} user thread(s) from KB`);
  } catch (err: any) {
    logger.warn(`[ThreadContext] Failed to load threads from KB: ${err.message}`);
  }
}

/**
 * Explicitly set what the user is focused on.
 * Use this when the user mentions a specific lead/project/show/contractor.
 */
export function setActiveFocus(userId: string, type: string, name: string): void {
  const thread = getOrCreate(userId);
  thread.activeFocus = { type, name };
  threads.set(userId, thread);
}

/**
 * Get the current active focus for a user.
 */
export function getActiveFocus(userId: string): { type: string; name: string } | undefined {
  return threads.get(userId)?.activeFocus;
}

/**
 * Clear the user's thread (e.g. when they explicitly start a new topic).
 */
export function clearThread(userId: string): void {
  threads.delete(userId);
}
