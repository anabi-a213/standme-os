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

  // Trello
  TRELLO_API_KEY: z.string().min(1),
  TRELLO_TOKEN: z.string().min(1),
  TRELLO_BOARD_SALES_PIPELINE: z.string().min(1), // read + write
  TRELLO_BOARD_SALES: z.string().min(1),          // read only
  TRELLO_BOARD_DESIGN: z.string().min(1),         // read only
  TRELLO_BOARD_OPERATION: z.string().min(1),      // read only
  TRELLO_BOARD_PRODUCTION: z.string().min(1),     // read only

  // Woodpecker
  WOODPECKER_API_KEY: z.string().min(1),
  WOODPECKER_CAMPAIGN_ID: z.string().default(''), // optional: force a specific campaign ID

  // Anthropic (Claude)
  ANTHROPIC_API_KEY: z.string().min(1),

  // Gmail
  GMAIL_LABEL: z.string().default('standme-inquiries'),
  SEND_FROM_EMAIL: z.string().default('info@standme.de'),
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
