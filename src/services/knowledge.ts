/**
 * Knowledge Base Service
 * Persistent memory that grows as agents read files, Trello cards, sheets, etc.
 * Stored in Google Sheets (KNOWLEDGE_BASE tab) — always available, no cold start.
 *
 * CACHING: All reads share a 5-minute in-memory cache. Multiple agents running
 * in the same process will share one cache — no redundant Sheets API calls.
 * The cache is automatically invalidated on every write (save or update).
 */

import { SHEETS } from '../config/sheets';
import { appendRow, readSheet, updateRange, objectToRow } from './google/sheets';
import { logger } from '../utils/logger';

export interface KnowledgeEntry {
  id: string;
  source: string;       // URL or name of source
  sourceType: string;   // drive | trello | sheet | manual
  topic: string;        // company | show | contractor | project | general
  tags: string;         // comma-separated keywords
  content: string;      // the knowledge (max ~500 chars)
  lastUpdated: string;
}

// ──────────────────────────────────────────────────────────────
// Internal cache — shared across all agents in this process
// ──────────────────────────────────────────────────────────────

interface KbCache {
  rows: string[][];
  fetchedAt: number;
}

let _cache: KbCache | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getCachedRows(): Promise<string[][]> {
  const now = Date.now();
  if (_cache && (now - _cache.fetchedAt) < CACHE_TTL_MS) {
    return _cache.rows;
  }
  const rows = await readSheet(SHEETS.KNOWLEDGE_BASE);
  _cache = { rows, fetchedAt: now };
  return rows;
}

function invalidateCache(): void {
  _cache = null;
}

// ──────────────────────────────────────────────────────────────
// Write: save a new entry
// ──────────────────────────────────────────────────────────────

export async function saveKnowledge(entry: Omit<KnowledgeEntry, 'id' | 'lastUpdated'>): Promise<void> {
  try {
    const id = `K-${Date.now()}`;
    const lastUpdated = new Date().toISOString();

    await appendRow(SHEETS.KNOWLEDGE_BASE, objectToRow(SHEETS.KNOWLEDGE_BASE, {
      id,
      source: entry.source.slice(0, 200),
      sourceType: entry.sourceType,
      topic: entry.topic.slice(0, 100),
      tags: entry.tags.slice(0, 200),
      content: entry.content.slice(0, 500),
      lastUpdated,
    }));

    invalidateCache(); // next read will fetch fresh data
  } catch (err: any) {
    logger.warn(`[Knowledge] Failed to save entry: ${err.message}`);
  }
}

// ──────────────────────────────────────────────────────────────
// Write: update an existing entry by source (used by /reindexdrive)
// If source not found, falls back to saveKnowledge (creates new).
// Returns true if an existing entry was updated, false if not found.
// ──────────────────────────────────────────────────────────────

export async function updateKnowledge(
  source: string,
  updates: Partial<Omit<KnowledgeEntry, 'id' | 'source'>>
): Promise<boolean> {
  try {
    // Use the shared cache for the lookup — this is critical during bulk reindex.
    // Doing a fresh readSheet() per file would hammer the Sheets API quota (60 reads/min).
    // Since updateKnowledge only modifies content in-place (never adds/removes rows),
    // cached row indices are stable throughout the entire reindex run.
    const rows = await getCachedRows();
    const sourceLower = source.toLowerCase();

    // Find the row where column B (index 1) matches the source
    let foundIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][1] || '').toLowerCase() === sourceLower) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex === -1) {
      // Not found — fall back to saving as a new entry (saveKnowledge handles cache invalidation)
      if (updates.content) {
        await saveKnowledge({
          source,
          sourceType: updates.sourceType || 'drive',
          topic: updates.topic || 'general',
          tags: updates.tags || '',
          content: updates.content,
        });
      }
      return false; // signals "was not an update, was a create"
    }

    // Build the updated row, preserving fields that aren't being updated
    const existing = rows[foundIndex];
    const updatedRow = [
      existing[0] || '',                                                        // id (A) — never changes
      existing[1] || '',                                                        // source (B) — never changes
      updates.sourceType || existing[2] || '',                                  // sourceType (C)
      (updates.topic || existing[3] || '').slice(0, 100),                      // topic (D)
      (updates.tags || existing[4] || '').slice(0, 200),                       // tags (E)
      (updates.content ? updates.content.slice(0, 500) : existing[5] || ''),  // content (F)
      new Date().toISOString(),                                                  // lastUpdated (G)
    ];

    // Sheet row number is 1-indexed: header = row 1, first data = row 2
    const sheetRow = foundIndex + 1;
    await updateRange(SHEETS.KNOWLEDGE_BASE, `A${sheetRow}:G${sheetRow}`, [updatedRow]);

    // Do NOT invalidate cache here — updateKnowledge only modifies content in-place.
    // Row structure is unchanged so cached indices remain valid.
    // Cache will naturally expire after CACHE_TTL_MS (5 min).
    return true;
  } catch (err: any) {
    logger.warn(`[Knowledge] Update failed for "${source}": ${err.message}`);
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
// Read: search by keyword (multi-term scored ranking)
// ──────────────────────────────────────────────────────────────

export async function searchKnowledge(query: string, limit = 10): Promise<KnowledgeEntry[]> {
  try {
    const rows = await getCachedRows();

    // Split into meaningful terms (ignore short stop words)
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (terms.length === 0) return [];

    const scored = rows.slice(1)
      .map(r => {
        const rowText = r.join(' ').toLowerCase();
        // Score = number of query terms found anywhere in the row
        const score = terms.filter(t => rowText.includes(t)).length;
        return { r, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score) // highest match count first
      .slice(0, limit)
      .map(({ r }) => ({
        id: r[0] || '',
        source: r[1] || '',
        sourceType: r[2] || '',
        topic: r[3] || '',
        tags: r[4] || '',
        content: r[5] || '',
        lastUpdated: r[6] || '',
      }));

    return scored;
  } catch (err: any) {
    logger.warn(`[Knowledge] Search failed: ${err.message}`);
    return [];
  }
}

// ──────────────────────────────────────────────────────────────
// Read: check if a source already exists (deduplication)
// ──────────────────────────────────────────────────────────────

export async function sourceExistsInKnowledge(source: string): Promise<boolean> {
  try {
    const rows = await getCachedRows();
    const s = source.toLowerCase();
    return rows.slice(1).some(r => (r[1] || '').toLowerCase() === s);
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
// Read: get all entries for a topic
// ──────────────────────────────────────────────────────────────

export async function getKnowledgeByTopic(topic: string, limit = 15): Promise<KnowledgeEntry[]> {
  try {
    const rows = await getCachedRows();
    const t = topic.toLowerCase();

    return rows.slice(1)
      .filter(r => (r[3] || '').toLowerCase().includes(t) || (r[4] || '').toLowerCase().includes(t))
      .slice(-limit)
      .map(r => ({
        id: r[0] || '',
        source: r[1] || '',
        sourceType: r[2] || '',
        topic: r[3] || '',
        tags: r[4] || '',
        content: r[5] || '',
        lastUpdated: r[6] || '',
      }));
  } catch (err: any) {
    logger.warn(`[Knowledge] getByTopic failed: ${err.message}`);
    return [];
  }
}

// ──────────────────────────────────────────────────────────────
// Read: get recent entries (for Brain context)
// ──────────────────────────────────────────────────────────────

export async function getRecentKnowledge(limit = 20): Promise<KnowledgeEntry[]> {
  try {
    const rows = await getCachedRows();
    return rows.slice(1)
      .slice(-limit)
      .map(r => ({
        id: r[0] || '',
        source: r[1] || '',
        sourceType: r[2] || '',
        topic: r[3] || '',
        tags: r[4] || '',
        content: r[5] || '',
        lastUpdated: r[6] || '',
      }))
      .reverse(); // newest first
  } catch (err: any) {
    logger.warn(`[Knowledge] getRecent failed: ${err.message}`);
    return [];
  }
}

// ──────────────────────────────────────────────────────────────
// Read: build a context string for AI prompts
// ──────────────────────────────────────────────────────────────

export async function buildKnowledgeContext(query: string): Promise<string> {
  const entries = await searchKnowledge(query, 8);
  if (entries.length === 0) return '';

  return entries.map(e =>
    `[${e.sourceType.toUpperCase()} | ${e.topic}] ${e.content} (from: ${e.source})`
  ).join('\n');
}

// ──────────────────────────────────────────────────────────────
// Read: raw row count + type breakdown (used by /kbstats)
// ──────────────────────────────────────────────────────────────

export async function getKnowledgeStats(): Promise<{
  total: number;
  byType: Record<string, number>;
  recent: KnowledgeEntry[];
}> {
  try {
    const rows = await getCachedRows();
    const data = rows.slice(1).filter(r => r[0]); // skip empty rows

    const byType: Record<string, number> = {};
    for (const r of data) {
      const t = r[2] || 'unknown';
      byType[t] = (byType[t] || 0) + 1;
    }

    const recent = data.slice(-5).reverse().map(r => ({
      id: r[0] || '',
      source: r[1] || '',
      sourceType: r[2] || '',
      topic: r[3] || '',
      tags: r[4] || '',
      content: r[5] || '',
      lastUpdated: r[6] || '',
    }));

    return { total: data.length, byType, recent };
  } catch (err: any) {
    logger.warn(`[Knowledge] Stats failed: ${err.message}`);
    return { total: 0, byType: {}, recent: [] };
  }
}

// ──────────────────────────────────────────────────────────────
// Build agent system prompt prefix from static knowledge
// ──────────────────────────────────────────────────────────────

export function buildAgentKnowledgePrefix(agentName: string): string {
  const { getStaticKnowledge } = require('../config/standme-knowledge');
  const base = getStaticKnowledge(false); // compact version for non-Brain agents
  return `You are the ${agentName} agent for StandMe — an exhibition stand design & build company (MENA & Europe).\n\n${base}\n\n`;
}
