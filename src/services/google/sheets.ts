import { google, sheets_v4 } from 'googleapis';
import { getGoogleAuth } from './auth';
import { SheetConfig } from '../../config/sheets';
import { retry } from '../../utils/retry';
import { logger } from '../../utils/logger';

let _sheets: sheets_v4.Sheets | null = null;

function getSheetsClient(): sheets_v4.Sheets {
  if (!_sheets) {
    _sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
  }
  return _sheets;
}

function getSheetId(config: SheetConfig): string {
  // Check sheet-specific env var first, then fall back to master SPREADSHEET_ID.
  // This means you only need ONE env var (SPREADSHEET_ID) pointing to a single
  // Google Spreadsheet — all 11 sheet tabs will live in that one file.
  // Individual SHEET_* vars can optionally override to separate spreadsheets.
  return process.env[config.envKey] || process.env.SPREADSHEET_ID || '';
}

export async function readSheet(config: SheetConfig, range?: string): Promise<string[][]> {
  const sheetId = getSheetId(config);
  const fullRange = range ? `${config.tabName}!${range}` : config.tabName;

  return retry(async () => {
    const response = await getSheetsClient().spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: fullRange,
    });
    return (response.data.values || []) as string[][];
  }, 'readSheet');
}

export async function appendRow(config: SheetConfig, values: string[]): Promise<void> {
  const sheetId = getSheetId(config);

  await retry(async () => {
    await getSheetsClient().spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${config.tabName}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [values] },
    });
  }, 'appendRow');
}

// Append multiple rows in a single API call — use this instead of looping appendRow
export async function appendRows(config: SheetConfig, rows: string[][]): Promise<void> {
  if (rows.length === 0) return;
  const sheetId = getSheetId(config);

  await retry(async () => {
    await getSheetsClient().spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${config.tabName}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });
  }, 'appendRows');
}

export async function updateCell(config: SheetConfig, row: number, col: string, value: string): Promise<void> {
  const sheetId = getSheetId(config);

  await retry(async () => {
    await getSheetsClient().spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${config.tabName}!${col}${row}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[value]] },
    });
  }, 'updateCell');
}

export async function updateRange(config: SheetConfig, range: string, values: string[][]): Promise<void> {
  const sheetId = getSheetId(config);

  await retry(async () => {
    await getSheetsClient().spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${config.tabName}!${range}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  }, 'updateRange');
}

export async function findRowByValue(config: SheetConfig, column: string, value: string): Promise<{ row: number; data: string[] } | null> {
  const rows = await readSheet(config);
  const colIndex = column.charCodeAt(0) - 'A'.charCodeAt(0);

  for (let i = config.headerRow; i < rows.length; i++) {
    if (rows[i][colIndex] && rows[i][colIndex].toLowerCase() === value.toLowerCase()) {
      return { row: i + 1, data: rows[i] }; // +1 for 1-indexed sheets
    }
  }
  return null;
}

// Convert row array to object using column mapping
export function rowToObject(config: SheetConfig, row: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const [field, col] of Object.entries(config.columns)) {
    const idx = col.charCodeAt(0) - 'A'.charCodeAt(0);
    obj[field] = row[idx] || '';
  }
  return obj;
}

// Convert object to row array using column mapping
export function objectToRow(config: SheetConfig, obj: Record<string, string>): string[] {
  const colEntries = Object.values(config.columns);
  if (colEntries.length === 0) {
    throw new Error(`objectToRow: sheet config "${config.tabName}" has no column mappings — cannot build row`);
  }
  const maxCol = Math.max(...colEntries.map(c => c.charCodeAt(0) - 'A'.charCodeAt(0)));
  if (!isFinite(maxCol) || maxCol < 0) {
    throw new Error(`objectToRow: sheet config "${config.tabName}" produced invalid column index (${maxCol}) — check column letters`);
  }
  const row = new Array(maxCol + 1).fill('');
  for (const [field, col] of Object.entries(config.columns)) {
    const idx = col.charCodeAt(0) - 'A'.charCodeAt(0);
    row[idx] = obj[field] || '';
  }
  return row;
}

// Returns a clickable Google Sheets URL for the given sheet config.
// Works for both single-spreadsheet setups (SPREADSHEET_ID only) and
// multi-spreadsheet setups (individual SHEET_* env vars set).
export function sheetUrl(config: SheetConfig): string {
  const id = process.env[config.envKey] || process.env.SPREADSHEET_ID || '';
  return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : '';
}

/** True if the sheet is reachable — works for both SHEET_* and SPREADSHEET_ID setups */
export function hasSheet(config: SheetConfig): boolean {
  return !!(process.env[config.envKey] || process.env.SPREADSHEET_ID);
}

/**
 * Validate that the actual header row in a Google Sheet matches the column mapping
 * defined in the SheetConfig.  Logs a WARNING if mismatches are found — does NOT throw.
 *
 * Call this at startup (or in /healthcheck) for critical sheets (e.g. LEAD_MASTER,
 * OUTREACH_LOG) to catch manual column reorders before they silently corrupt writes.
 *
 * Returns true if no mismatches were found, false otherwise.
 *
 * Example usage:
 *   await validateSheetHeaders(SHEETS.LEAD_MASTER);
 */
export async function validateSheetHeaders(config: SheetConfig): Promise<boolean> {
  try {
    const rows = await readSheet(config, 'A1:Z1');
    if (!rows || rows.length === 0) {
      logger.warn(`[Sheets] validateSheetHeaders(${config.tabName}): header row not found — sheet may be empty`);
      return false;
    }
    const actualHeaders: string[] = rows[0] || [];
    const mismatches: string[] = [];

    for (const [field, col] of Object.entries(config.columns)) {
      const colIdx = col.charCodeAt(0) - 'A'.charCodeAt(0);
      const actualHeader = (actualHeaders[colIdx] || '').trim().toLowerCase();
      const expectedField = field.toLowerCase();
      // Convert camelCase to space-separated words: contactName → contact name
      const humanizedField = field.replace(/([A-Z])/g, ' $1').toLowerCase().trim();

      // Allow if actual header matches either the raw field name or the humanized (spaced) form
      const matches =
        actualHeader.includes(expectedField) || expectedField.includes(actualHeader) ||
        actualHeader.includes(humanizedField) || humanizedField.includes(actualHeader);

      if (actualHeader && !matches) {
        mismatches.push(`col ${col} (${field}): sheet has "${actualHeaders[colIdx] || 'empty'}" — expected field matching "${field}"`);
      }
    }

    if (mismatches.length > 0) {
      logger.warn(
        `[Sheets] validateSheetHeaders(${config.tabName}): ${mismatches.length} column mismatch(es) detected!\n` +
        mismatches.map(m => `  ⚠️  ${m}`).join('\n') + '\n' +
        `  This may mean columns were manually reordered in the sheet. Check objectToRow() writes for this tab.`
      );
      return false;
    }

    logger.info(`[Sheets] validateSheetHeaders(${config.tabName}): OK — ${actualHeaders.length} headers match config`);
    return true;
  } catch (err: any) {
    logger.warn(`[Sheets] validateSheetHeaders(${config.tabName}): could not read headers — ${err.message}`);
    return false;
  }
}
