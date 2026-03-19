import { google, sheets_v4 } from 'googleapis';
import { getGoogleAuth } from './auth';
import { SheetConfig } from '../../config/sheets';
import { retry } from '../../utils/retry';

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
  const maxCol = Math.max(...Object.values(config.columns).map(c => c.charCodeAt(0) - 'A'.charCodeAt(0)));
  const row = new Array(maxCol + 1).fill('');
  for (const [field, col] of Object.entries(config.columns)) {
    const idx = col.charCodeAt(0) - 'A'.charCodeAt(0);
    row[idx] = obj[field] || '';
  }
  return row;
}

// Returns a clickable Google Sheets URL for the given sheet config
export function sheetUrl(config: SheetConfig): string {
  const id = process.env[config.envKey] || '';
  return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : '';
}
