/**
 * reset-fresh-start.ts
 *
 * Clears all test/lead data so the system can start fresh.
 *
 * What gets cleared:
 *   Sheets (all rows except header):
 *     Leads, EmailFunnel, Queue, OutreachLog, CampaignSales,
 *     SystemLog, WorkflowLog, Hub, Lessons
 *
 *   Knowledge Base (selective — lead records only):
 *     Removes: pipeline-state-*, thread-context-*, pending-approval-*,
 *              woodpecker-prospect-*, woodpecker-reply-*, brief entries, lesson entries
 *     Keeps:   seeded company/show knowledge, Drive index entries, campaign stats
 *
 *   Trello Sales Pipeline:
 *     Deletes all open cards from TRELLO_BOARD_SALES_PIPELINE
 *
 * What is NOT touched:
 *   DRIVE_INDEX, TECHNICAL_DEADLINES, CONTRACTOR_DB, KNOWLEDGE_BASE general entries
 *
 * Run: npx ts-node src/scripts/reset-fresh-start.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
// Load .env from the src/ root regardless of where the script is invoked from
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { google, sheets_v4 } from 'googleapis';
import axios from 'axios';
import { getGoogleAuth } from '../services/google/auth';

const DEFAULT_SHEET_ID = process.env.SPREADSHEET_ID || '';
const TRELLO_KEY  = process.env.TRELLO_API_KEY || '';
const TRELLO_TOKEN = process.env.TRELLO_TOKEN || '';
const TRELLO_BOARD = process.env.TRELLO_BOARD_SALES_PIPELINE || '';

function sheetId(envKey: string): string {
  return process.env[envKey] || DEFAULT_SHEET_ID;
}

// ── Sheets to wipe (keep header row 1) ──────────────────────────────
// Each entry includes the env key for its spreadsheet ID
const SHEETS_TO_CLEAR = [
  { tab: 'Leads',         name: 'LEAD_MASTER',     sid: sheetId('SHEET_LEAD_MASTER')     },
  { tab: 'EmailFunnel',   name: 'EMAIL_FUNNEL',    sid: sheetId('SPREADSHEET_ID')         },
  { tab: 'Queue',         name: 'OUTREACH_QUEUE',  sid: sheetId('SHEET_OUTREACH_QUEUE')  },
  { tab: 'OutreachLog',   name: 'OUTREACH_LOG',    sid: sheetId('SHEET_OUTREACH_LOG')    },
  { tab: 'CampaignSales', name: 'CAMPAIGN_SALES',  sid: sheetId('SHEET_CAMPAIGN_SALES')  },
  { tab: 'SystemLog',     name: 'SYSTEM_LOG',      sid: sheetId('SHEET_SYSTEM_LOG')      },
  { tab: 'WorkflowLog',   name: 'WORKFLOW_LOG',    sid: DEFAULT_SHEET_ID                 },
  { tab: 'Hub',           name: 'CROSS_AGENT_HUB', sid: sheetId('SHEET_CROSS_AGENT_HUB') },
  { tab: 'Lessons',       name: 'LESSONS_LEARNED', sid: sheetId('SHEET_LESSONS_LEARNED') },
];

// ── KB: source prefixes that are lead-specific ───────────────────────
const KB_REMOVE_SOURCE_PREFIXES = [
  'pipeline-state-',
  'thread-context-',
  'pending-approval-',
  'woodpecker-prospect-',
  'woodpecker-reply-',
];

// KB: tag values that indicate a lead-generated entry
const KB_REMOVE_TAGS = ['brief', 'concept', 'lesson'];

// ── Clear one sheet (rows 2 onwards, keep header) ────────────────────
async function clearSheet(sheets: sheets_v4.Sheets, tab: string, name: string, sid: string): Promise<void> {
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: sid,
      range: `${tab}!A2:ZZ`,
    });
    console.log(`  ✅ ${name} (${tab})`);
  } catch (e: any) {
    console.log(`  ⚠️  ${name} — ${e.message}`);
  }
}

// ── Selectively clean Knowledge Base ────────────────────────────────
async function cleanKnowledgeBase(sheets: sheets_v4.Sheets): Promise<void> {
  const KB_SHEET_ID = process.env.SHEET_KNOWLEDGE_BASE || DEFAULT_SHEET_ID;
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: KB_SHEET_ID,
    range: 'Knowledge!A:G',
  });
  const rows = (resp.data.values || []) as string[][];

  if (rows.length <= 1) {
    console.log('  ✅ KNOWLEDGE_BASE — already empty, nothing to clean');
    return;
  }

  const header = rows[0];
  const dataRows = rows.slice(1);

  // col B = source (index 1), col E = tags (index 4)
  const toKeep: string[][] = [header];
  let removed = 0;

  for (const row of dataRows) {
    const source = (row[1] || '').toLowerCase();
    const tags   = (row[4] || '').toLowerCase().split(',').map(t => t.trim());

    const isLeadRecord =
      KB_REMOVE_SOURCE_PREFIXES.some(prefix => source.startsWith(prefix)) ||
      KB_REMOVE_TAGS.some(tag => tags.includes(tag));

    if (isLeadRecord) {
      removed++;
    } else {
      toKeep.push(row);
    }
  }

  // Rewrite the sheet: clear then write back kept rows
  await sheets.spreadsheets.values.clear({
    spreadsheetId: KB_SHEET_ID,
    range: 'Knowledge!A:G',
  });

  if (toKeep.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: KB_SHEET_ID,
      range: 'Knowledge!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: toKeep },
    });
  }

  const kept = toKeep.length - 1; // minus header
  console.log(`  ✅ KNOWLEDGE_BASE — removed ${removed} lead records, kept ${kept} general entries`);
}

// ── Delete all cards from Trello Sales Pipeline ──────────────────────
async function clearTrelloBoard(): Promise<void> {
  if (!TRELLO_BOARD) {
    console.log('  ⚠️  TRELLO_BOARD_SALES_PIPELINE not set — skipping');
    return;
  }
  if (!TRELLO_KEY || !TRELLO_TOKEN) {
    console.log('  ⚠️  TRELLO_API_KEY / TRELLO_TOKEN not set — skipping');
    return;
  }

  const params = { key: TRELLO_KEY, token: TRELLO_TOKEN };

  const resp = await axios.get(
    `https://api.trello.com/1/boards/${TRELLO_BOARD}/cards`,
    { params: { ...params, filter: 'open' } }
  );
  const cards: { id: string; name: string }[] = resp.data;

  if (cards.length === 0) {
    console.log('  ✅ Trello — no cards found, already clean');
    return;
  }

  console.log(`  🗂  Deleting ${cards.length} Trello cards...`);
  let deleted = 0;
  for (const card of cards) {
    try {
      await axios.delete(`https://api.trello.com/1/cards/${card.id}`, { params });
      console.log(`     🗑  ${card.name}`);
      deleted++;
    } catch (e: any) {
      console.log(`     ⚠️  Failed to delete "${card.name}": ${e.message}`);
    }
    // 150ms gap — Trello API is rate-limited
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`  ✅ Trello — deleted ${deleted}/${cards.length} cards`);
}

// ── Main ─────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  StandMe OS — Fresh Start Reset');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (!DEFAULT_SHEET_ID) {
    console.error('❌ SPREADSHEET_ID not set in .env — aborting');
    process.exit(1);
  }

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // 1. Clear sheets
  console.log('📊  Clearing Google Sheets...');
  for (const { tab, name, sid } of SHEETS_TO_CLEAR) {
    await clearSheet(sheets, tab, name, sid);
  }

  // 2. Selective KB clean
  console.log('\n🧠  Cleaning Knowledge Base (lead records only)...');
  await cleanKnowledgeBase(sheets);

  // 3. Trello
  console.log('\n🗂   Clearing Trello Sales Pipeline...');
  await clearTrelloBoard();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ✅ Reset complete — ready for a fresh start!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Kept untouched:');
  console.log('  • DRIVE_INDEX (your indexed documents)');
  console.log('  • TECHNICAL_DEADLINES (show dates)');
  console.log('  • CONTRACTOR_DB (contractor contacts)');
  console.log('  • KNOWLEDGE_BASE general/seed entries\n');
}

main().catch(e => {
  console.error('\n❌ Reset failed:', e.message);
  process.exit(1);
});
