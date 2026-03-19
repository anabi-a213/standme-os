/**
 * Sheets Auto-Init
 *
 * Called on every startup. Handles the full lifecycle:
 *   1. Find master spreadsheet — checks SPREADSHEET_ID, then any SHEET_* var.
 *   2. Auto-create a new spreadsheet if none exist (first-run).
 *   3. Back-fill any unset SHEET_* env vars with the master ID so all
 *      agents can always call getSheetId() without null checks.
 *   4. Create any missing tabs with correct headers (idempotent).
 *
 * Setup: you only need ONE env var: SPREADSHEET_ID = your Google Sheet ID.
 * Individual SHEET_* vars are optional overrides for separate spreadsheets.
 */

import { google } from 'googleapis';
import { getGoogleAuth } from './auth';
import { logger } from '../../utils/logger';

interface TabConfig {
  envKey: string;   // must match SHEETS config envKey exactly
  tabName: string;  // must match SHEETS config tabName exactly
  headers: string[];
}

// ── Tab definitions — tabName MUST match src/config/sheets.ts exactly ─────────
const REQUIRED_TABS: TabConfig[] = [
  {
    envKey: 'SHEET_LEAD_MASTER',
    tabName: 'Leads',
    headers: [
      'ID', 'Timestamp', 'Company', 'Contact Name', 'Contact Email', 'Contact Title',
      'Show Name', 'Show City', 'Stand Size', 'Budget', 'Industry', 'Lead Source',
      'Score', 'Score Breakdown', 'Confidence', 'Status', 'Trello Card ID',
      'Enrichment Status', 'DM Name', 'DM Title', 'DM LinkedIn', 'DM Email',
      'Outreach Readiness', 'Language', 'Notes',
    ],
  },
  {
    envKey: 'SHEET_OUTREACH_QUEUE',
    tabName: 'Queue',
    headers: [
      'ID', 'Lead ID', 'Company Name', 'DM Name', 'DM Email',
      'Show Name', 'Readiness Score', 'Sequence Status', 'Added Date', 'Last Action',
    ],
  },
  {
    // Tab name was previously 'Log' — renamed to 'OutreachLog' to avoid
    // collision with SYSTEM_LOG which also used 'Log' in the same spreadsheet.
    envKey: 'SHEET_OUTREACH_LOG',
    tabName: 'OutreachLog',
    headers: [
      'ID', 'Lead ID', 'Company Name', 'Email Type', 'Sent Date',
      'Status', 'Reply Classification', 'Woodpecker ID', 'Notes',
    ],
  },
  {
    envKey: 'SHEET_LESSONS_LEARNED',
    tabName: 'Lessons',
    headers: [
      'ID', 'Project Name', 'Show Name', 'Client', 'Outcome',
      'Stand Size', 'Budget', 'What Went Well', 'What Went Wrong',
      'Cost vs Budget', 'Client Feedback', 'Competitor Intel', 'Doc URL', 'Date',
    ],
  },
  {
    envKey: 'SHEET_TECHNICAL_DEADLINES',
    tabName: 'Deadlines',
    headers: [
      'ID', 'Show Name', 'Client', 'Portal Submission', 'Rigging',
      'Electrics', 'Design Approval', 'Build Start', 'Show Open', 'Breakdown',
      'Confidence Level', 'Source URL', 'Last Verified',
    ],
  },
  {
    envKey: 'SHEET_CONTRACTOR_DB',
    tabName: 'Contractors',
    headers: [
      'ID', 'Name', 'Company', 'Specialty', 'Region',
      'Phone', 'Email', 'Rating', 'Last Booked', 'Notes',
    ],
  },
  {
    envKey: 'SHEET_DRIVE_INDEX',
    tabName: 'Index',
    headers: [
      'File Name', 'File ID', 'File URL', 'Folder Path', 'Parent Folder',
      'File Type', 'Last Modified', 'Linked Project', 'Category',
    ],
  },
  {
    envKey: 'SHEET_CROSS_AGENT_HUB',
    tabName: 'Hub',
    headers: [
      'Timestamp', 'Client Name', 'Show Name', 'Sales Status',
      'Design Status', 'Operation Status', 'Production Status', 'Flags', 'Last Updated',
    ],
  },
  {
    // Tab name was previously 'Log' — renamed to 'SystemLog' to avoid collision.
    envKey: 'SHEET_SYSTEM_LOG',
    tabName: 'SystemLog',
    headers: [
      'Timestamp', 'Agent', 'Action Type', 'Show Name',
      'Detail', 'Result', 'Retry', 'Notes',
    ],
  },
  {
    envKey: 'SHEET_KNOWLEDGE_BASE',
    tabName: 'Knowledge',
    headers: [
      'ID', 'Source', 'Source Type', 'Topic', 'Tags', 'Content', 'Last Updated',
    ],
  },
  {
    envKey: 'SHEET_CAMPAIGN_SALES',
    tabName: 'CampaignSales',
    headers: [
      'ID', 'Campaign ID', 'Show Name', 'Company', 'Contact Name', 'Contact Email',
      'Woodpecker ID', 'Status', 'Classification', 'Stand Size', 'Budget', 'Show Dates',
      'Phone', 'Requirements', 'Conversation Log', 'Last Reply Date', 'Last Action Date',
      'Lead Master ID', 'Notes', 'Website', 'Logo URL',
    ],
  },
];

// ── Step 1: Find or auto-create the master spreadsheet ─────────────────────────
async function findOrCreateMasterSpreadsheet(
  sheetsApi: ReturnType<typeof google.sheets>
): Promise<string> {
  // Priority 1: explicit SPREADSHEET_ID env var
  if (process.env.SPREADSHEET_ID) {
    return process.env.SPREADSHEET_ID;
  }

  // Priority 2: any existing SHEET_* env var — use the first found as master
  for (const tab of REQUIRED_TABS) {
    const id = process.env[tab.envKey];
    if (id) {
      logger.info(`[Sheets Init] Using ${tab.envKey} as master spreadsheet`);
      process.env.SPREADSHEET_ID = id;
      return id;
    }
  }

  // Priority 3: nothing set — auto-create a new spreadsheet
  logger.info('[Sheets Init] No spreadsheet configured — auto-creating "StandMe OS — Data"...');
  try {
    const resp = await sheetsApi.spreadsheets.create({
      requestBody: {
        properties: { title: 'StandMe OS — Data' },
      },
    });
    const newId = resp.data.spreadsheetId!;
    const url = `https://docs.google.com/spreadsheets/d/${newId}/edit`;

    process.env.SPREADSHEET_ID = newId;

    logger.info(`[Sheets Init] ✅ Created spreadsheet: ${newId}`);
    logger.info(`[Sheets Init] 🔗 URL: ${url}`);
    logger.info(`[Sheets Init] ⚠️  Add this to Railway env vars: SPREADSHEET_ID=${newId}`);
    logger.info(`[Sheets Init] ⚠️  Also share the sheet with your service account email.`);

    return newId;
  } catch (err: any) {
    logger.error(`[Sheets Init] Failed to auto-create spreadsheet: ${err.message}`);
    throw new Error(
      `Cannot initialise Google Sheets: no SPREADSHEET_ID set and auto-create failed. ` +
      `Create a Google Spreadsheet manually, share it with your service account, ` +
      `and set SPREADSHEET_ID=<id> in Railway. Error: ${err.message}`
    );
  }
}

// ── Step 2: Back-fill SHEET_* env vars from master ─────────────────────────────
function backfillEnvVars(masterId: string): void {
  for (const tab of REQUIRED_TABS) {
    if (!process.env[tab.envKey]) {
      process.env[tab.envKey] = masterId;
    }
  }
}

// ── Step 3: Create any missing tabs in the spreadsheet ────────────────────────
async function ensureTabs(
  sheetsApi: ReturnType<typeof google.sheets>,
  spreadsheetId: string
): Promise<{ created: number; skipped: number; errors: number }> {
  let created = 0;
  let skipped = 0;
  let errors = 0;

  // Get the sheet's current tabs once — avoid repeated API calls
  let existingTabNames: string[] = [];
  try {
    const meta = await sheetsApi.spreadsheets.get({ spreadsheetId });
    existingTabNames = (meta.data.sheets || []).map(s => s.properties?.title || '');
  } catch (err: any) {
    logger.error(`[Sheets Init] Cannot read spreadsheet ${spreadsheetId}: ${err.message}`);
    logger.error(`[Sheets Init] Make sure the service account has Editor access to the spreadsheet.`);
    return { created: 0, skipped: 0, errors: REQUIRED_TABS.length };
  }

  // Tabs that belong to their own separate spreadsheet — handle separately
  const spreadsheetGroups = new Map<string, TabConfig[]>();
  for (const tab of REQUIRED_TABS) {
    const id = process.env[tab.envKey] || spreadsheetId;
    if (!spreadsheetGroups.has(id)) spreadsheetGroups.set(id, []);
    spreadsheetGroups.get(id)!.push(tab);
  }

  for (const [sheetId, tabs] of spreadsheetGroups) {
    // Re-fetch tab list for this specific spreadsheet if different from master
    let tabNames = sheetId === spreadsheetId ? existingTabNames : [];
    if (sheetId !== spreadsheetId) {
      try {
        const meta = await sheetsApi.spreadsheets.get({ spreadsheetId: sheetId });
        tabNames = (meta.data.sheets || []).map(s => s.properties?.title || '');
      } catch (err: any) {
        logger.warn(`[Sheets Init] Cannot read spreadsheet for ${sheetId}: ${err.message}`);
        errors += tabs.length;
        continue;
      }
    }

    for (const tab of tabs) {
      if (tabNames.includes(tab.tabName)) {
        skipped++;
        continue;
      }

      try {
        // Create the tab
        await sheetsApi.spreadsheets.batchUpdate({
          spreadsheetId: sheetId,
          requestBody: {
            requests: [{ addSheet: { properties: { title: tab.tabName } } }],
          },
        });

        // Write headers to row 1
        await sheetsApi.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `${tab.tabName}!A1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [tab.headers] },
        });

        // Freeze header row for readability
        await sheetsApi.spreadsheets.batchUpdate({
          spreadsheetId: sheetId,
          requestBody: {
            requests: [{
              updateSheetProperties: {
                properties: {
                  title: tab.tabName,
                  gridProperties: { frozenRowCount: 1 },
                },
                fields: 'gridProperties.frozenRowCount',
              },
            }],
          },
        }).catch(() => { /* freeze is cosmetic — ignore if it fails */ });

        logger.info(`[Sheets Init] ✅ Created tab "${tab.tabName}" (${tab.envKey})`);
        tabNames.push(tab.tabName); // update local list so same-spreadsheet tabs don't retry
        created++;
      } catch (err: any) {
        logger.warn(`[Sheets Init] Failed to create tab "${tab.tabName}": ${err.message}`);
        errors++;
      }
    }
  }

  return { created, skipped, errors };
}

// ── Main export ────────────────────────────────────────────────────────────────
export async function initSheets(): Promise<void> {
  const auth = getGoogleAuth();
  const sheetsApi = google.sheets({ version: 'v4', auth });

  try {
    // 1. Find or auto-create the master spreadsheet
    const masterId = await findOrCreateMasterSpreadsheet(sheetsApi);
    logger.info(`[Sheets Init] Master spreadsheet: ${masterId}`);
    logger.info(`[Sheets Init] URL: https://docs.google.com/spreadsheets/d/${masterId}/edit`);

    // 2. Back-fill all unset SHEET_* env vars with the master ID
    backfillEnvVars(masterId);

    // 3. Create any missing tabs
    const { created, skipped, errors } = await ensureTabs(sheetsApi, masterId);
    logger.info(`[Sheets Init] Done: ${created} tabs created, ${skipped} already exist, ${errors} errors`);

    if (errors > 0) {
      logger.warn(`[Sheets Init] ${errors} tab(s) failed — check service account permissions.`);
    }

  } catch (err: any) {
    // Don't crash the whole server — just log the error and continue
    logger.error(`[Sheets Init] FAILED: ${err.message}`);
    logger.error(`[Sheets Init] Agents that require sheets will fail until this is resolved.`);
  }
}

// ── Exported helper: run /sheetssetup command ─────────────────────────────────
// Returns a human-readable status string for the Telegram healthcheck command.
export async function getSheetsStatus(): Promise<string> {
  const auth = getGoogleAuth();
  const sheetsApi = google.sheets({ version: 'v4', auth });

  const masterId = process.env.SPREADSHEET_ID || '';
  if (!masterId) {
    return '❌ No SPREADSHEET_ID set. Run /sheetssetup to auto-create.';
  }

  // Cache of spreadsheetId → existing tab names (avoid re-fetching same sheet)
  const tabCache = new Map<string, string[]>();

  async function getTabsForSheet(sheetId: string): Promise<string[]> {
    if (tabCache.has(sheetId)) return tabCache.get(sheetId)!;
    try {
      const meta = await sheetsApi.spreadsheets.get({ spreadsheetId: sheetId });
      const tabs = (meta.data.sheets || []).map(s => s.properties?.title || '');
      tabCache.set(sheetId, tabs);
      return tabs;
    } catch {
      tabCache.set(sheetId, []);
      return [];
    }
  }

  // Check each tab in its ACTUAL spreadsheet (not just the master)
  const tabStatusLines: string[] = [];
  let missingCount = 0;

  for (const t of REQUIRED_TABS) {
    const sheetId = process.env[t.envKey] || masterId;
    const isSeparate = sheetId !== masterId;
    const tabs = await getTabsForSheet(sheetId);
    const exists = tabs.includes(t.tabName);
    if (!exists) missingCount++;
    const label = isSeparate ? ` (separate sheet)` : '';
    tabStatusLines.push(`${exists ? '✅' : '❌'} ${t.tabName}${label}`);
  }

  const url = `https://docs.google.com/spreadsheets/d/${masterId}/edit`;

  return [
    `📊 *Google Sheets Status*`,
    `Master: ${url}`,
    ``,
    tabStatusLines.join('\n'),
    ``,
    missingCount > 0
      ? `⚠️ ${missingCount} tab(s) missing — run /sheetssetup to create them.`
      : `✅ All 11 tabs present and accounted for.`,
  ].join('\n');
}
