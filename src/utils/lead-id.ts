/**
 * lead-id.ts
 *
 * Generates sequential lead IDs in the format SM-XXXX (e.g. SM-1001, SM-1002).
 *
 * On first call the current max ID is read from LEAD_MASTER so the counter
 * always continues from wherever the sheet left off — even after a redeploy.
 *
 * An in-process counter is incremented for every subsequent call, so bulk
 * operations (Agent-13 creating many leads at once) get unique IDs without
 * hitting the sheet each time.
 */

import { readSheet } from '../services/google/sheets';
import { SHEETS } from '../config/sheets';

const ID_PREFIX = 'SM-';
const ID_START  = 1000; // first ID will be SM-1001

let _next: number | null = null;

/**
 * Returns the next sequential lead ID, e.g. "SM-1001".
 * Initialises from the sheet on first call; increments in-memory after that.
 */
export async function generateLeadId(): Promise<string> {
  if (_next === null) {
    _next = await _readMaxFromSheet() + 1;
  } else {
    _next++;
  }
  return formatId(_next);
}

/** Visible for testing — force a specific starting number. */
export function _resetLeadIdCounter(startAt?: number): void {
  _next = startAt !== undefined ? startAt - 1 : null;
}

// ── helpers ──────────────────────────────────────────────────────────

function formatId(n: number): string {
  // Always at least 4 digits; grows naturally beyond 9999
  return `${ID_PREFIX}${String(n).padStart(4, '0')}`;
}

async function _readMaxFromSheet(): Promise<number> {
  try {
    const rows = await readSheet(SHEETS.LEAD_MASTER);
    let max = ID_START;
    for (const row of rows.slice(1)) {          // skip header
      const raw = (row[0] || '').trim();         // column A = id
      const match = raw.match(/^SM-(\d+)$/i);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > max) max = n;
      }
    }
    return max;
  } catch {
    // If we can't read the sheet, start conservatively from ID_START
    return ID_START;
  }
}
