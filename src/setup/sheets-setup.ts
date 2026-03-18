/**
 * StandMe OS — One-time Google Sheets Setup
 * Run: npm run setup:sheets
 * Creates all required tabs with correct names and header rows.
 */

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { google } from 'googleapis';
import { getGoogleAuth } from '../services/google/auth';

const SHEET_CONFIGS: {
  envKey: string;
  tabName: string;
  headers: string[];
}[] = [
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

async function setupSheets() {
  console.log('\n==========================================');
  console.log('  StandMe OS — Google Sheets Setup');
  console.log('==========================================\n');

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  let allGood = true;

  for (const config of SHEET_CONFIGS) {
    const spreadsheetId = process.env[config.envKey];
    if (!spreadsheetId) {
      console.log(`❌ ${config.envKey} not set in .env — skipping`);
      allGood = false;
      continue;
    }

    try {
      // Get existing sheets
      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      const existingSheets = meta.data.sheets || [];
      const existingNames = existingSheets.map(s => s.properties?.title || '');

      if (existingNames.includes(config.tabName)) {
        console.log(`✅ ${config.envKey} — tab "${config.tabName}" already exists`);
        continue;
      }

      // Add the tab
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: { title: config.tabName },
            },
          }],
        },
      });

      // Add headers
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${config.tabName}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [config.headers] },
      });

      console.log(`✅ ${config.envKey} — created tab "${config.tabName}" with ${config.headers.length} columns`);

    } catch (err: any) {
      console.log(`❌ ${config.envKey} — ${err.message}`);
      allGood = false;
    }
  }

  console.log('\n==========================================');
  console.log(allGood ? '  All sheets ready!' : '  Some sheets had errors — check above.');
  console.log('==========================================\n');
}

setupSheets().catch(err => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
