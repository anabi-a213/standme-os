/**
 * Unit tests for src/services/knowledge.ts
 *
 * Tests search scoring, deduplication, getKnowledgeBySource exact lookup,
 * stats, and error-safe fallbacks.
 *
 * Each test uses a fresh module import (via jest.resetModules) so the
 * in-memory cache starts empty — no cross-test contamination.
 *
 * All Google Sheets calls are mocked — no real API calls.
 */

// ─── Mocks registered BEFORE any import ───────────────────────────────────────

jest.mock('../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('../config/sheets', () => ({
  SHEETS: {
    KNOWLEDGE_BASE: {
      tabName:   'Knowledge',
      envKey:    'SHEET_KNOWLEDGE_BASE',
      headerRow: 1,
      columns:   { id: 'A', source: 'B', sourceType: 'C', topic: 'D', tags: 'E', content: 'F', lastUpdated: 'G' },
    },
  },
}));

// Mutable mock functions — set up per test
const mockReadSheet = jest.fn();
const mockAppendRow = jest.fn();

jest.mock('../services/google/sheets', () => ({
  // Delegates to the outer jest.fn() so per-test mockResolvedValue calls work
  readSheet:   (...a: any[]) => mockReadSheet(...a),
  appendRow:   (...a: any[]) => mockAppendRow(...a),
  appendRows:  jest.fn().mockResolvedValue(undefined),
  updateRange: jest.fn().mockResolvedValue(undefined),
  objectToRow: jest.fn((_: any, obj: Record<string, string>) => Object.values(obj).map(String)),
}));

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Build a raw KB row [id, source, sourceType, topic, tags, content, lastUpdated] */
function makeRow(
  id: string, source: string, sourceType: string,
  topic: string, tags: string, content: string,
): string[] {
  return [id, source, sourceType, topic, tags, content, '2026-01-01T00:00:00.000Z'];
}

const HEADER = ['id', 'source', 'sourceType', 'topic', 'tags', 'content', 'lastUpdated'];

// ─── Test lifecycle ───────────────────────────────────────────────────────────

beforeEach(() => {
  // Reset mock implementations + call counts between tests
  mockReadSheet.mockReset();
  mockAppendRow.mockReset().mockResolvedValue(undefined);
  // Reset module registry so each dynamic import() gets a fresh instance
  // (avoids cache cross-contamination between tests)
  jest.resetModules();
});

// ─── searchKnowledge ─────────────────────────────────────────────────────────

describe('searchKnowledge', () => {
  it('returns empty array when no rows match the query', async () => {
    mockReadSheet.mockResolvedValue([
      HEADER,
      makeRow('K-1', 'src-a', 'drive', 'show', 'intersolar', 'Intersolar exhibitor list'),
    ]);
    const { searchKnowledge } = await import('../services/knowledge');

    const results = await searchKnowledge('gulfood food', 10);
    expect(results).toHaveLength(0);
  });

  it('returns matching rows for the query', async () => {
    mockReadSheet.mockResolvedValue([
      HEADER,
      makeRow('K-1', 'src-a', 'drive', 'show', 'intersolar', 'Intersolar exhibitor list'),
      makeRow('K-2', 'src-b', 'drive', 'show', 'gulfood',    'Gulfood food beverage data'),
    ]);
    const { searchKnowledge } = await import('../services/knowledge');

    const results = await searchKnowledge('gulfood food', 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].source).toBe('src-b');
  });

  it('ranks higher-scoring rows first', async () => {
    // K-1 matches only 'gulfood' (score 1)
    // K-2 matches 'gulfood' AND 'medical' (score 2) → should rank first
    mockReadSheet.mockResolvedValue([
      HEADER,
      makeRow('K-1', 'src-low',  'drive', 'show', 'gulfood',          'Gulfood food and beverage exhibitors'),
      makeRow('K-2', 'src-high', 'drive', 'show', 'gulfood,medical',  'Gulfood medical device exhibitors'),
    ]);
    const { searchKnowledge } = await import('../services/knowledge');

    const results = await searchKnowledge('gulfood medical', 10);
    expect(results[0].source).toBe('src-high');
  });

  it('returns empty array when readSheet throws', async () => {
    mockReadSheet.mockRejectedValue(new Error('Sheets unavailable'));
    const { searchKnowledge } = await import('../services/knowledge');

    const results = await searchKnowledge('anything', 10);
    expect(results).toEqual([]);
  });

  it('respects the limit parameter', async () => {
    mockReadSheet.mockResolvedValue([
      HEADER,
      ...Array.from({ length: 20 }, (_, i) =>
        makeRow(`K-${i}`, `src-${i}`, 'drive', 'show', 'intersolar', `entry ${i}`)
      ),
    ]);
    const { searchKnowledge } = await import('../services/knowledge');

    const results = await searchKnowledge('intersolar', 5);
    expect(results.length).toBeLessThanOrEqual(5);
  });
});

// ─── sourceExistsInKnowledge ──────────────────────────────────────────────────

describe('sourceExistsInKnowledge', () => {
  it('returns true for exact source match, false otherwise', async () => {
    mockReadSheet.mockResolvedValue([
      HEADER,
      makeRow('K-1', 'bulk-approval-bulkoutreach_intersolar_123', 'sheet', 'pending', '', '{}'),
    ]);
    const { sourceExistsInKnowledge } = await import('../services/knowledge');

    expect(await sourceExistsInKnowledge('bulk-approval-bulkoutreach_intersolar_123')).toBe(true);
    expect(await sourceExistsInKnowledge('bulk-approval-bulkoutreach_gulfood_456')).toBe(false);
  });

  it('is case-insensitive', async () => {
    mockReadSheet.mockResolvedValue([
      HEADER,
      makeRow('K-1', 'Drive-File-ABC123', 'drive', 'show', '', 'content'),
    ]);
    const { sourceExistsInKnowledge } = await import('../services/knowledge');

    expect(await sourceExistsInKnowledge('drive-file-abc123')).toBe(true);
    expect(await sourceExistsInKnowledge('DRIVE-FILE-ABC123')).toBe(true);
  });

  it('returns false when readSheet throws', async () => {
    mockReadSheet.mockRejectedValue(new Error('Sheet error'));
    const { sourceExistsInKnowledge } = await import('../services/knowledge');

    expect(await sourceExistsInKnowledge('anything')).toBe(false);
  });
});

// ─── getKnowledgeBySource ─────────────────────────────────────────────────────

describe('getKnowledgeBySource', () => {
  it('returns the correct entry by exact source — not fuzzy', async () => {
    mockReadSheet.mockResolvedValue([
      HEADER,
      makeRow('K-1', 'bulk-approval-bulkoutreach_intersolar_999', 'sheet', 'pending', 'intersolar', '{"showFilter":"intersolar","campaignId":"c-001"}'),
      makeRow('K-2', 'bulk-approval-bulkoutreach_gulfood_888',   'sheet', 'pending', 'gulfood',    '{"showFilter":"gulfood","campaignId":"c-002"}'),
    ]);
    const { getKnowledgeBySource } = await import('../services/knowledge');

    const entry = await getKnowledgeBySource('bulk-approval-bulkoutreach_intersolar_999');
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe('K-1');
    expect(entry!.content).toContain('"showFilter":"intersolar"');
    expect(entry!.content).not.toContain('gulfood');
  });

  it('does not confuse two similar approval sources', async () => {
    mockReadSheet.mockResolvedValue([
      HEADER,
      makeRow('K-1', 'bulk-approval-bulkoutreach_intersolar_999', 'sheet', 'pending', '', '{"showFilter":"intersolar"}'),
      makeRow('K-2', 'bulk-approval-bulkoutreach_gulfood_888',    'sheet', 'pending', '', '{"showFilter":"gulfood"}'),
    ]);
    const { getKnowledgeBySource } = await import('../services/knowledge');

    const gulfoodEntry = await getKnowledgeBySource('bulk-approval-bulkoutreach_gulfood_888');
    expect(gulfoodEntry!.content).toContain('"showFilter":"gulfood"');
    expect(gulfoodEntry!.content).not.toContain('intersolar');
  });

  it('returns null when source is not found', async () => {
    mockReadSheet.mockResolvedValue([HEADER]);
    const { getKnowledgeBySource } = await import('../services/knowledge');

    expect(await getKnowledgeBySource('no-such-source')).toBeNull();
  });

  it('returns null when readSheet throws', async () => {
    mockReadSheet.mockRejectedValue(new Error('Sheets error'));
    const { getKnowledgeBySource } = await import('../services/knowledge');

    expect(await getKnowledgeBySource('anything')).toBeNull();
  });
});

// ─── getKnowledgeStats ────────────────────────────────────────────────────────

describe('getKnowledgeStats', () => {
  it('returns correct totals and type breakdown', async () => {
    mockReadSheet.mockResolvedValue([
      HEADER,
      makeRow('K-1', 'src-a', 'drive',  'show',    '', 'a'),
      makeRow('K-2', 'src-b', 'drive',  'show',    '', 'b'),
      makeRow('K-3', 'src-c', 'manual', 'general', '', 'c'),
    ]);
    const { getKnowledgeStats } = await import('../services/knowledge');

    const stats = await getKnowledgeStats();
    expect(stats.total).toBe(3);
    expect(stats.byType['drive']).toBe(2);
    expect(stats.byType['manual']).toBe(1);
  });

  it('returns zero totals for an empty sheet', async () => {
    mockReadSheet.mockResolvedValue([HEADER]);
    const { getKnowledgeStats } = await import('../services/knowledge');

    const stats = await getKnowledgeStats();
    expect(stats.total).toBe(0);
    expect(stats.byType).toEqual({});
  });
});

// ─── buildKnowledgeContext ────────────────────────────────────────────────────

describe('buildKnowledgeContext', () => {
  it('returns empty string when no entries match', async () => {
    mockReadSheet.mockResolvedValue([HEADER]);
    const { buildKnowledgeContext } = await import('../services/knowledge');

    expect(await buildKnowledgeContext('intersolar')).toBe('');
  });

  it('returns a formatted context string for matching entries', async () => {
    mockReadSheet.mockResolvedValue([
      HEADER,
      makeRow('K-1', 'src-a', 'drive', 'show', 'intersolar', 'Intersolar 2026 details and exhibitor profile'),
    ]);
    const { buildKnowledgeContext } = await import('../services/knowledge');

    const ctx = await buildKnowledgeContext('intersolar');
    expect(ctx).toContain('Intersolar 2026 details');
    expect(ctx).toContain('DRIVE');
    expect(ctx).toContain('show');
  });
});
