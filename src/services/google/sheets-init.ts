/**
 * Sheets Auto-Init
 * Called on startup: checks all required tabs exist, creates any that are missing.
 * Safe to run on every deploy — skips tabs that already exist.
 */

import { google } from 'googleapis';
import { getGoogleAuth } from './auth';
import { logger } from '../../utils/logger';

interface TabConfig {
  envKey: string;
  tabName: string;
  headers: string[];
}

const REQUIRED_TABS: TabConfig[] = [
  {
    envKey: 'SHEET_LEAD_MASTER',
    tabName: 'Leads',
    headers: ['ID', 'Timestamp', 'Company', 'Contact Name', 'Contact Email', 'Contact Title',
      'Show Name', 'Show City', 'Stand Size', 'Budget', 'Industry', 'Lead Source',
      'Score', 'Score Breakdown', 'Confidence', 'Status', 'Trello Card ID',
      'Enrichment Status', 'DM Name', 'DM Title', 'DM LinkedIn', 'DM Email',
      'Outreach Readiness', 'Language', 'Notes'],
  },
  {
    envKey: 'SHEET_OUTREACH_QUEUE',
    tabName: 'Queue',
    headers: ['ID', 'Lead ID', 'Company Name', 'DM Name', 'DM Email',
      'Show Name', 'Readiness Score', 'Sequence Status', 'Added Date', 'Last Action'],
  },
  {
    envKey: 'SHEET_OUTREACH_LOG',
    tabName: 'Log',
    headers: ['ID', 'Lead ID', 'Company Name', 'Email Type', 'Sent Date',
      'Status', 'Reply Classification', 'Woodpecker ID', 'Notes'],
  },
  {
    envKey: 'SHEET_LESSONS_LEARNED',
    tabName: 'Lessons',
    headers: ['ID', 'Project Name', 'Show Name', 'Client', 'Outcome',
      'Stand Size', 'Budget', 'What Went Well', 'What Went Wrong',
      'Cost vs Budget', 'Client Feedback', 'Competitor Intel', 'Doc URL', 'Date'],
  },
  {
    envKey: 'SHEET_TECHNICAL_DEADLINES',
    tabName: 'Deadlines',
    headers: ['ID', 'Show Name', 'Client', 'Portal Submission', 'Rigging',
      'Electrics', 'Design Approval', 'Build Start', 'Show Open', 'Breakdown',
      'Confidence Level', 'Source URL', 'Last Verified'],
  },
  {
    envKey: 'SHEET_CONTRACTOR_DB',
    tabName: 'Contractors',
    headers: ['ID', 'Name', 'Company', 'Specialty', 'Region',
      'Phone', 'Email', 'Rating', 'Last Booked', 'Notes'],
  },
  {
    envKey: 'SHEET_DRIVE_INDEX',
    tabName: 'Index',
    headers: ['File Name', 'File ID', 'File URL', 'Folder Path', 'Parent Folder',
      'File Type', 'Last Modified', 'Linked Project', 'Category'],
  },
  {
    envKey: 'SHEET_CROSS_AGENT_HUB',
    tabName: 'Hub',
    headers: ['Timestamp', 'Client Name', 'Show Name', 'Sales Status',
      'Design Status', 'Operation Status', 'Production Status', 'Flags', 'Last Updated'],
  },
  {
    envKey: 'SHEET_SYSTEM_LOG',
    tabName: 'Log',
    headers: ['Timestamp', 'Agent', 'Action Type', 'Show Name',
      'Detail', 'Result', 'Retry', 'Notes'],
  },
  {
    envKey: 'SHEET_KNOWLEDGE_BASE',
    tabName: 'Knowledge',
    headers: ['ID', 'Source', 'Source Type', 'Topic', 'Tags', 'Content', 'Last Updated'],
  },
];

export async function initSheets(): Promise<void> {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const config of REQUIRED_TABS) {
    const spreadsheetId = process.env[config.envKey];
    if (!spreadsheetId) {
      logger.warn(`[Sheets Init] ${config.envKey} not set — skipping`);
      continue;
    }

    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      const existingNames = (meta.data.sheets || []).map(s => s.properties?.title || '');

      if (existingNames.includes(config.tabName)) {
        skipped++;
        continue;
      }

      // Create the missing tab
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: config.tabName } } }],
        },
      });

      // Add headers
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${config.tabName}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [config.headers] },
      });

      logger.info(`[Sheets Init] Created tab "${config.tabName}" in ${config.envKey}`);
      created++;

    } catch (err: any) {
      logger.warn(`[Sheets Init] ${config.envKey} error: ${err.message}`);
      errors++;
    }
  }

  logger.info(`[Sheets Init] Done: ${created} created, ${skipped} already exist, ${errors} errors`);
}
