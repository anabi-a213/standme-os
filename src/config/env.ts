import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  MO_TELEGRAM_ID: z.string().default('6140480367'),
  MO_BACKUP_TELEGRAM_ID: z.string().default('517107884'),
  HADEER_TELEGRAM_ID: z.string().default('5135842073'),
  BASSEL_TELEGRAM_USERNAME: z.string().default('bassel_al_hussein'),

  // Google OAuth2
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REFRESH_TOKEN: z.string().min(1),

  // Google Sheet IDs
  SHEET_LEAD_MASTER: z.string().min(1),
  SHEET_LESSONS_LEARNED: z.string().min(1),
  SHEET_OUTREACH_QUEUE: z.string().min(1),
  SHEET_OUTREACH_LOG: z.string().min(1),
  SHEET_TECHNICAL_DEADLINES: z.string().min(1),
  SHEET_CONTRACTOR_DB: z.string().min(1),
  SHEET_DRIVE_INDEX: z.string().min(1),
  SHEET_CROSS_AGENT_HUB: z.string().min(1),
  SHEET_SYSTEM_LOG: z.string().min(1),
  SHEET_KNOWLEDGE_BASE: z.string().optional().default(''),
  SHEET_WORKFLOW_LOG: z.string().optional().default(''),
  SHEET_CAMPAIGN_SALES: z.string().optional().default(''),
  SHEET_EMAIL_FUNNEL: z.string().optional().default(''),

  // Trello
  TRELLO_API_KEY: z.string().min(1),
  TRELLO_TOKEN: z.string().min(1),
  TRELLO_BOARD_SALES_PIPELINE: z.string().min(1), // read + write
  TRELLO_BOARD_SALES: z.string().min(1),          // read only
  TRELLO_BOARD_DESIGN: z.string().min(1),         // read only
  TRELLO_BOARD_OPERATION: z.string().min(1),      // read only
  TRELLO_BOARD_PRODUCTION: z.string().min(1),     // read only

  // Woodpecker
  WOODPECKER_API_KEY: z.string().optional().default(''),
  WOODPECKER_CAMPAIGN_ID: z.string().default(''), // optional: force a specific campaign ID
  WOODPECKER_WEBHOOK_SECRET: z.string().optional().default(''),

  // Instantly.ai (cold outreach — Growth plan uses 3h poller; Hypergrowth uses webhook)
  INSTANTLY_API_KEY: z.string().optional().default(''),
  INSTANTLY_WEBHOOK_SECRET: z.string().optional().default(''),
  INSTANTLY_WEBHOOK_ENABLED: z.string().optional().default('false'),

  // Anthropic (Claude)
  ANTHROPIC_API_KEY: z.string().min(1),

  // Freepik AI — for /renders command (automatic image generation)
  FREEPIK_API_KEY: z.string().optional().default(''),

  // Gmail
  GMAIL_LABEL: z.string().default('standme-inquiries'),
  SEND_FROM_EMAIL: z.string().default('info@standme.de'),

  // Google Drive — legacy generic folder (fallback if specific folders not set)
  DRIVE_FOLDER_AGENTS: z.string().default(''),
  // Comma-separated extra emails to share agent files with (for people outside standme.de)
  TEAM_SHARE_EMAILS: z.string().default(''),
  // Explicit file owner email (fallback for sharing when org policy blocks link sharing)
  DRIVE_OWNER_EMAIL: z.string().default(''),

  // ── StandMe OS Drive Folder Tree ──
  // Set these by running /setupdrive from Telegram, then pasting the output into .env

  // 00_Admin
  DRIVE_FOLDER_ADMIN: z.string().default(''),
  DRIVE_FOLDER_APPROVALS_LOG: z.string().default(''),
  DRIVE_FOLDER_TEMPLATES_MASTER: z.string().default(''),
  DRIVE_FOLDER_PRICING_MODEL: z.string().default(''),
  DRIVE_FOLDER_FINANCE: z.string().default(''),
  DRIVE_FOLDER_INVOICES: z.string().default(''),
  DRIVE_FOLDER_PAYMENTS: z.string().default(''),
  DRIVE_FOLDER_JOB_COSTING: z.string().default(''),
  DRIVE_FOLDER_SUPPLIER_INVOICES: z.string().default(''),

  // 01_Sales
  DRIVE_FOLDER_SALES: z.string().default(''),
  DRIVE_FOLDER_LEADS: z.string().default(''),
  DRIVE_FOLDER_LEADS_INBOUND: z.string().default(''),
  DRIVE_FOLDER_LEADS_OUTBOUND: z.string().default(''),
  DRIVE_FOLDER_LEADS_QUALIFIED: z.string().default(''),
  DRIVE_FOLDER_LEADS_LOST: z.string().default(''),
  DRIVE_FOLDER_PROPOSALS: z.string().default(''),
  DRIVE_FOLDER_OFFER_SHEETS: z.string().default(''),
  DRIVE_FOLDER_CONTRACTS_TEMPLATES: z.string().default(''),
  DRIVE_FOLDER_OUTREACH_ASSETS: z.string().default(''),

  // 02_Projects
  DRIVE_FOLDER_PROJECTS: z.string().default(''),
  DRIVE_FOLDER_PROJECTS_ACTIVE: z.string().default(''),
  DRIVE_FOLDER_PROJECTS_ARCHIVE: z.string().default(''),

  // 03_Events_And_Venues
  DRIVE_FOLDER_EVENTS: z.string().default(''),

  // 04_Contractors
  DRIVE_FOLDER_CONTRACTORS: z.string().default(''),

  // 05_Design_References
  DRIVE_FOLDER_DESIGN_REFS: z.string().default(''),
  DRIVE_FOLDER_DESIGN_BY_INDUSTRY: z.string().default(''),
  DRIVE_FOLDER_DESIGN_BY_STYLE: z.string().default(''),
  DRIVE_FOLDER_DESIGN_BY_STAND_TYPE: z.string().default(''),

  // 06_Lessons_Learned
  DRIVE_FOLDER_LESSONS: z.string().default(''),
  DRIVE_FOLDER_LESSONS_WON: z.string().default(''),
  DRIVE_FOLDER_LESSONS_LOST: z.string().default(''),
  DRIVE_FOLDER_LESSONS_DELIVERY: z.string().default(''),
  DRIVE_FOLDER_LESSONS_PROCESS: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      const missing = result.error.issues.map(i => i.path.join('.')).join(', ');
      throw new Error(`Missing environment variables: ${missing}`);
    }
    _env = result.data;
  }
  return _env;
}
