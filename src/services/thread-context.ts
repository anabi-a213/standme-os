/**
 * Thread Context Service
 *
 * Tracks per-user cross-agent conversation state:
 * - What entity (lead/project/show/contractor) the user is currently focused on
 * - Recent interactions across ALL agents (not just Brain)
 * - Provides context string any agent can inject into its AI prompt
 *
 * This ensures agents never respond "in a vacuum" — they know what you've been
 * working on even if you switch commands or agents mid-conversation.
 */

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
