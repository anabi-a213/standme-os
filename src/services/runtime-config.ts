/**
 * Runtime Config Service
 *
 * Stores dynamic configuration (e.g. Drive folder IDs created by /setupdrive)
 * in the Google Sheets KNOWLEDGE_BASE so they survive Railway deployments
 * without needing manual env var updates.
 *
 * HOW IT WORKS:
 * - At startup: loads all runtime config from KNOWLEDGE_BASE into process.env
 *   (only keys not already set in Railway — Railway vars always win)
 * - When /setupdrive creates a folder: saves ID directly to KNOWLEDGE_BASE
 * - Next time the bot starts (or live via cache): ID is already there
 *
 * RESULT:
 * - Drive folder IDs never need to be in Railway
 * - No manual copy-paste after /setupdrive
 * - Works for any future dynamic config (new sheets, new boards, etc.)
 */

import { saveKnowledge, searchKnowledge } from './knowledge';
import { logger } from '../utils/logger';

const RUNTIME_SOURCE_TYPE = 'runtime-config';
const RUNTIME_TOPIC = 'config';

// In-memory cache: key → value (populated at startup, updated on writes)
const _cache = new Map<string, string>();
let _loaded = false;

// ── Load all runtime config from KNOWLEDGE_BASE into process.env ──
// Call this once at startup (before any agents need the values).
// Only sets process.env[key] if the key is NOT already set in Railway.

export async function loadRuntimeConfig(): Promise<void> {
  if (_loaded) return;

  try {
    const entries = await searchKnowledge(RUNTIME_SOURCE_TYPE, 100);
    const runtimeEntries = entries.filter(e => e.sourceType === RUNTIME_SOURCE_TYPE);

    let loaded = 0;
    for (const entry of runtimeEntries) {
      const key = entry.source;
      const value = entry.content;
      if (!key || !value) continue;

      // Cache it
      _cache.set(key, value);

      // Only set in process.env if Railway hasn't already set it
      if (!process.env[key]) {
        process.env[key] = value;
        loaded++;
      }
    }

    _loaded = true;
    if (loaded > 0) {
      logger.info(`[RuntimeConfig] Loaded ${loaded} dynamic config values from Knowledge Base`);
    }
  } catch (err: any) {
    // Non-fatal — fall back to process.env only
    logger.warn(`[RuntimeConfig] Could not load from Knowledge Base: ${err.message}`);
    _loaded = true;
  }
}

// ── Save a single config value to KNOWLEDGE_BASE + process.env ──
// Safe to call at any time (not just startup). Used by /setupdrive.

export async function saveRuntimeConfig(key: string, value: string): Promise<void> {
  // Update memory + process.env immediately
  _cache.set(key, value);
  process.env[key] = value;

  // Persist to KNOWLEDGE_BASE
  // Use key as the source so we can find it later by source name
  try {
    await saveKnowledge({
      source: key,
      sourceType: RUNTIME_SOURCE_TYPE,
      topic: RUNTIME_TOPIC,
      tags: `runtime-config, drive-folder, ${key.toLowerCase().replace(/_/g, '-')}`,
      content: value,
    });
  } catch (err: any) {
    logger.warn(`[RuntimeConfig] Failed to persist "${key}": ${err.message}`);
  }
}

// ── Save multiple config values at once (batch) ──
// Used by setupDriveFolderTree after creating all 31 folders.

export async function saveRuntimeConfigs(entries: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(entries)) {
    if (key === 'ROOT') continue; // ROOT is hardcoded, never needs saving
    await saveRuntimeConfig(key, value);
  }
}

// ── Get a config value (memory cache → process.env fallback) ──
export function getRuntimeConfig(key: string): string {
  return _cache.get(key) || process.env[key] || '';
}
