/**
 * Drive Exhibitor Parser
 *
 * Reads exhibitor lists from the designated Google Drive folder.
 * Handles: Google Sheets, Excel (.xlsx / .xls), CSV
 * Columns are flexible — Claude normalises whatever headers are present.
 *
 * Folder: https://drive.google.com/drive/folders/1EAEcw-dE43fPGivBGVJEYzEM5zFmc23N
 * Files are named by show (e.g. "Gulfood 2025.xlsx", "Arab Health exhibitors.gsheet")
 */

import { google } from 'googleapis';
import * as XLSX from 'xlsx';
import { getGoogleAuth } from './google/auth';
import { listFiles, DriveFile } from './google/drive';
import { generateText } from './ai/client';
import { logger } from '../utils/logger';

export const EXHIBITOR_FOLDER_ID = '1EAEcw-dE43fPGivBGVJEYzEM5zFmc23N';

const GOOGLE_SHEET_MIME  = 'application/vnd.google-apps.spreadsheet';
const EXCEL_MIME         = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EXCEL_OLD_MIME     = 'application/vnd.ms-excel';
const CSV_MIME           = 'text/csv';
const TEXT_MIME          = 'text/plain';

export interface ExhibitorRecord {
  companyName: string;
  website?: string;
  country?: string;
  contactName?: string;
  contactEmail?: string;
  contactTitle?: string;
  phone?: string;
  industry?: string;
  boothNumber?: string;
}

// ── Column normalisation ──────────────────────────────────────────────────────

/**
 * Use Claude to map whatever headers exist in the file to our standard field names.
 * Falls back to heuristic keyword matching if AI call fails.
 */
async function inferColumnMap(
  headers: string[],
  sampleRow: string[],
): Promise<Record<string, number>> {
  const headerList = headers.map((h, i) => `${i}:"${h}"`).join(', ');
  const sampleStr  = sampleRow.map((v, i) => `col${i}:"${v}"`).join(', ');

  const prompt =
    `Spreadsheet headers (index:"header"): ${headerList}\n` +
    `Sample data row: ${sampleStr}\n\n` +
    `Map these columns to standard field names. Return ONLY a JSON object where keys are field names ` +
    `and values are the column index (integer). Only include fields you are confident about.\n` +
    `Available fields: companyName, website, country, contactName, contactEmail, contactTitle, phone, industry, boothNumber\n` +
    `Example output: {"companyName":0,"website":3,"country":1}`;

  try {
    const raw = await generateText(
      prompt,
      'You map spreadsheet column headers to standard field names. Return only valid JSON with no explanation.',
      150,
    );
    const cleaned = raw.replace(/```(?:json)?\n?|```/g, '').trim();
    const parsed  = JSON.parse(cleaned);
    if (typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    logger.warn('[DriveExhibitor] AI column mapping failed — using keyword fallback');
  }

  // Keyword fallback
  const lower  = headers.map(h => h.toLowerCase().trim());
  const find   = (terms: string[]) => lower.findIndex(h => terms.some(t => h.includes(t)));
  const result: Record<string, number> = {};

  const company = find(['exhibitor', 'company', 'organisation', 'organization', 'firm']);
  const website = find(['website', 'web', 'url', 'domain', 'www', 'homepage', 'site']);
  const country = find(['country', 'nation', 'location', 'region', 'market']);
  const email   = find(['email', 'e-mail', 'mail']);
  const phone   = find(['phone', 'tel', 'mobile', 'contact number', 'number']);
  const industry = find(['industry', 'sector', 'category', 'type', 'segment']);
  const booth   = find(['booth', 'stand', 'hall', 'space', 'location']);
  const contact = find(['contact', 'person', 'representative', 'name']); // only if company already found

  if (company  >= 0) result.companyName  = company;
  if (website  >= 0) result.website      = website;
  if (country  >= 0) result.country      = country;
  if (email    >= 0) result.contactEmail  = email;
  if (phone    >= 0) result.phone         = phone;
  if (industry >= 0) result.industry      = industry;
  if (booth    >= 0) result.boothNumber   = booth;
  // Only map 'name' to contactName if companyName is already taken care of separately
  if (contact  >= 0 && contact !== company) result.contactName = contact;

  return result;
}

function parseRows(rows: string[][], colMap: Record<string, number>): ExhibitorRecord[] {
  const get = (row: string[], field: string) => {
    const idx = colMap[field];
    return idx !== undefined ? (row[idx] || '').trim() : '';
  };

  const results: ExhibitorRecord[] = [];
  for (const row of rows) {
    const company = get(row, 'companyName');
    if (!company || company.toLowerCase() === 'company name') continue; // skip header repeats

    results.push({
      companyName:  company,
      website:      get(row, 'website')      || undefined,
      country:      get(row, 'country')      || undefined,
      contactName:  get(row, 'contactName')  || undefined,
      contactEmail: get(row, 'contactEmail') || undefined,
      contactTitle: get(row, 'contactTitle') || undefined,
      phone:        get(row, 'phone')        || undefined,
      industry:     get(row, 'industry')     || undefined,
      boothNumber:  get(row, 'boothNumber')  || undefined,
    });
  }
  return results;
}

// ── File readers ──────────────────────────────────────────────────────────────

async function readGoogleSheet(fileId: string): Promise<string[][]> {
  const sheets = google.sheets({ version: 'v4', auth: getGoogleAuth() });
  const res    = await sheets.spreadsheets.values.get({
    spreadsheetId: fileId,
    range: 'A:ZZ',
  });
  return (res.data.values || []).map(row => row.map(cell => String(cell ?? '')));
}

async function readExcelFile(fileId: string): Promise<string[][]> {
  // Download binary via Drive API (auth handled automatically)
  const drive = google.drive({ version: 'v3', auth: getGoogleAuth() });
  const res   = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  );
  const workbook  = XLSX.read(res.data as ArrayBuffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet     = workbook.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  return rows.map(row => row.map((cell: any) => String(cell ?? '')));
}

async function readCsvFile(fileId: string): Promise<string[][]> {
  const drive = google.drive({ version: 'v3', auth: getGoogleAuth() });
  const res   = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'text' },
  );
  const text = res.data as string;
  return text.split('\n').filter(l => l.trim()).map(line => {
    // Naive CSV split — handles quoted commas
    const cells: string[] = [];
    let cur = '';
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { cells.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/** List all files in the exhibitor folder. */
export async function listExhibitorFiles(): Promise<DriveFile[]> {
  return listFiles(EXHIBITOR_FOLDER_ID);
}

/**
 * Find the exhibitor file for a given show by matching the filename.
 * Case-insensitive, ignores spaces, strips extension.
 */
export async function findExhibitorFile(showName: string): Promise<DriveFile | null> {
  const files  = await listExhibitorFiles();
  const needle = showName.toLowerCase().replace(/\s+/g, '');

  // Exact partial match first
  let match = files.find(f => {
    const base = f.name.toLowerCase().replace(/\s+/g, '').replace(/\.(xlsx?|csv|gsheet)$/, '');
    return base.includes(needle) || needle.includes(base);
  });

  // Looser word-by-word match if nothing found
  if (!match) {
    const words = showName.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    match = files.find(f => {
      const fname = f.name.toLowerCase();
      return words.every(w => fname.includes(w));
    });
  }

  return match || null;
}

/**
 * Parse an exhibitor file into structured records.
 * Automatically detects file type (Google Sheets, Excel, CSV).
 * Uses Claude to normalise column headers — handles any layout.
 */
export async function parseExhibitorFile(file: DriveFile): Promise<ExhibitorRecord[]> {
  let rows: string[][] = [];

  if (file.mimeType === GOOGLE_SHEET_MIME) {
    rows = await readGoogleSheet(file.id);
  } else if ([EXCEL_MIME, EXCEL_OLD_MIME].includes(file.mimeType)) {
    rows = await readExcelFile(file.id);
  } else if ([CSV_MIME, TEXT_MIME].includes(file.mimeType)) {
    rows = await readCsvFile(file.id);
  } else {
    // Unknown type — try as Google Sheet first, then Excel
    try {
      rows = await readGoogleSheet(file.id);
    } catch {
      try {
        rows = await readExcelFile(file.id);
      } catch {
        logger.warn(`[DriveExhibitor] Cannot parse "${file.name}" (type: ${file.mimeType})`);
        return [];
      }
    }
  }

  if (rows.length < 2) {
    logger.warn(`[DriveExhibitor] "${file.name}" has fewer than 2 rows — skipping`);
    return [];
  }

  // Find first non-empty header row (skip blank rows at top)
  let headerRowIndex = 0;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    if (rows[i].some(c => c.trim())) { headerRowIndex = i; break; }
  }

  const headers   = rows[headerRowIndex];
  const dataRows  = rows.slice(headerRowIndex + 1).filter(r => r.some(c => c.trim()));
  const sampleRow = dataRows[0] || [];

  const colMap = await inferColumnMap(headers, sampleRow);
  const records = parseRows(dataRows, colMap);

  logger.info(`[DriveExhibitor] Parsed ${records.length} companies from "${file.name}"`);
  return records;
}
