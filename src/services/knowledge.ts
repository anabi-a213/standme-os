/**
 * Knowledge Base Service
 * Persistent memory that grows as agents read files, Trello cards, sheets, etc.
 * Stored in Google Sheets (KNOWLEDGE_BASE tab) — always available, no cold start.
 */

import { SHEETS } from '../config/sheets';
import { appendRow, readSheet, objectToRow } from './google/sheets';
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

// ---- Save a single knowledge entry ----

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
  } catch (err: any) {
    logger.warn(`[Knowledge] Failed to save entry: ${err.message}`);
  }
}

// ---- Search knowledge by keyword ----

export async function searchKnowledge(query: string, limit = 10): Promise<KnowledgeEntry[]> {
  try {
    const rows = await readSheet(SHEETS.KNOWLEDGE_BASE);
    const q = query.toLowerCase();

    return rows.slice(1)
      .filter(r => r.some(cell => cell?.toLowerCase().includes(q)))
      .slice(0, limit)
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
    logger.warn(`[Knowledge] Search failed: ${err.message}`);
    return [];
  }
}

// ---- Get all entries for a topic (company/show/etc.) ----

export async function getKnowledgeByTopic(topic: string, limit = 15): Promise<KnowledgeEntry[]> {
  try {
    const rows = await readSheet(SHEETS.KNOWLEDGE_BASE);
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

// ---- Get recent entries (for Brain context) ----

export async function getRecentKnowledge(limit = 20): Promise<KnowledgeEntry[]> {
  try {
    const rows = await readSheet(SHEETS.KNOWLEDGE_BASE);
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

// ---- Build a knowledge context string for AI prompts ----

export async function buildKnowledgeContext(query: string): Promise<string> {
  const entries = await searchKnowledge(query, 8);
  if (entries.length === 0) return '';

  return entries.map(e =>
    `[${e.sourceType.toUpperCase()} | ${e.topic}] ${e.content} (from: ${e.source})`
  ).join('\n');
}

// ---- Build agent system prompt prefix from static knowledge ----
// Use this in any agent's system prompt to give it StandMe + industry context.
// Import getStaticKnowledge from '../config/standme-knowledge' and call this.

export function buildAgentKnowledgePrefix(agentName: string): string {
  const { getStaticKnowledge } = require('../config/standme-knowledge');
  const base = getStaticKnowledge(false); // compact version for non-Brain agents
  return `You are the ${agentName} agent for StandMe — an exhibition stand design & build company (MENA & Europe).\n\n${base}\n\n`;
}
