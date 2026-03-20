/**
 * Instantly.ai v2 API Client
 * Replaces Woodpecker for all outreach operations.
 *
 * Key advantages over Woodpecker Classic:
 * - Full API: create campaigns, write email steps, set status — all programmatic
 * - Built-in email verification before sending
 * - Inbox rotation (Instantly handles this automatically)
 * - Full reply + stats access via API
 * - Rate limit: ~120 req/min (Growth plan)
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { retry } from '../../utils/retry';
import { logger } from '../../utils/logger';

let _client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (!_client) {
    const apiKey = process.env.INSTANTLY_API_KEY || '';
    if (!apiKey) {
      logger.warn('[Instantly] INSTANTLY_API_KEY not set — outreach features disabled');
    }
    _client = axios.create({
      baseURL: 'https://api.instantly.ai/api/v2',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    });
  }
  return _client;
}

// Reset client (e.g. after env var change)
export function resetInstantlyClient(): void {
  _client = null;
}

// ─── Status constants ──────────────────────────────────────────────────────────

export const CAMPAIGN_STATUS = {
  DRAFT:     0,
  ACTIVE:    1,
  PAUSED:    3,
  COMPLETED: 4,
} as const;

export type CampaignStatusValue = typeof CAMPAIGN_STATUS[keyof typeof CAMPAIGN_STATUS];

export function campaignStatusLabel(status: number): string {
  switch (status) {
    case 0: return 'DRAFT';
    case 1: return 'ACTIVE';
    case 3: return 'PAUSED';
    case 4: return 'COMPLETED';
    default: return `STATUS_${status}`;
  }
}

// ─── Type Definitions ──────────────────────────────────────────────────────────

export interface InstantlyCampaign {
  id: string;
  name: string;
  status: number; // use CAMPAIGN_STATUS constants
  created_at?: string;
}

export interface InstantlyEmailStep {
  subject: string;
  body: string;
  delay: number; // days after previous step (0 for first step)
}

export interface InstantlyLead {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  personalization?: string; // icebreaker / opening hook
  website?: string;
  phone?: string;
  custom_variables?: Record<string, string>;
}

export interface InstantlyCampaignSummary {
  campaign_id: string;
  campaign_name: string;
  total_leads: number;
  emails_sent: number;
  opened: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  open_rate: number;
  reply_rate: number;
  bounce_rate: number;
}

export interface InstantlyAccount {
  id: string;
  email: string;
  status: string;
  warmup_status?: string;
  daily_limit?: number;
}

export interface InstantlyReply {
  id: string;
  from_email: string;
  from_name?: string;
  subject?: string;
  body?: string;
  timestamp?: string;
  campaign_id?: string;
  lead_email?: string;
}

// ─── Error Helper ─────────────────────────────────────────────────────────────

function apiError(err: unknown, context: string): Error {
  if (err instanceof AxiosError) {
    const status = err.response?.status ?? '?';
    const detail = err.response?.data
      ? JSON.stringify(err.response.data).slice(0, 300)
      : err.message;
    return new Error(`Instantly API error (${status}) in ${context}: ${detail}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

// ─── Campaign Methods ─────────────────────────────────────────────────────────

export async function listCampaigns(): Promise<InstantlyCampaign[]> {
  return retry(async () => {
    const resp = await getClient().get('/campaigns', { params: { limit: 100, skip: 0 } })
      .catch(err => { throw apiError(err, 'listCampaigns'); });
    const items: any[] = Array.isArray(resp.data?.items) ? resp.data.items
      : Array.isArray(resp.data) ? resp.data : [];
    return items.map(c => ({
      id: String(c.id ?? ''),
      name: String(c.name ?? ''),
      status: Number(c.status ?? 0),
      created_at: c.created_at,
    }));
  }, 'listCampaigns');
}

export async function getCampaign(campaignId: string): Promise<InstantlyCampaign | null> {
  return retry(async () => {
    const resp = await getClient().get(`/campaigns/${campaignId}`)
      .catch(err => { throw apiError(err, 'getCampaign'); });
    const c = resp.data;
    if (!c) return null;
    return { id: String(c.id ?? ''), name: String(c.name ?? ''), status: Number(c.status ?? 0) };
  }, 'getCampaign');
}

/**
 * Create a campaign with email sequence steps built in.
 * Instantly supports full campaign creation via API — no manual UI work needed.
 */
export async function createCampaign(
  name: string,
  emailSteps: InstantlyEmailStep[],
  options: {
    sendDays?: number[];   // 0=Sun, 1=Mon … 6=Sat. Default: Mon-Fri
    startHour?: number;    // 24h, default 8
    endHour?: number;      // 24h, default 18
    timezone?: string;     // default 'Europe/Berlin'
  } = {}
): Promise<string> {
  return retry(async () => {
    const sendDays = options.sendDays ?? [1, 2, 3, 4, 5];
    const tz = options.timezone ?? 'Europe/Berlin';

    const schedule = {
      schedules: [{
        name: 'StandMe Default',
        timing: {
          from: `${String(options.startHour ?? 8).padStart(2, '0')}:00`,
          to:   `${String(options.endHour ?? 18).padStart(2, '0')}:00`,
        },
        days: {
          monday:    sendDays.includes(1),
          tuesday:   sendDays.includes(2),
          wednesday: sendDays.includes(3),
          thursday:  sendDays.includes(4),
          friday:    sendDays.includes(5),
          saturday:  sendDays.includes(6),
          sunday:    sendDays.includes(0),
        },
        timezone: tz,
      }],
    };

    const sequences = emailSteps.length > 0 ? [{
      steps: emailSteps.map((step, i) => ({
        type: 'email',
        delay: i === 0 ? 0 : step.delay,
        variants: [{ subject: step.subject, body: step.body }],
      })),
    }] : [];

    const body: any = { name, campaign_schedule: schedule };
    if (sequences.length > 0) body.sequences = sequences;

    const resp = await getClient().post('/campaigns', body)
      .catch(err => { throw apiError(err, 'createCampaign'); });

    return String(resp.data?.id ?? resp.data?.campaign_id ?? '');
  }, 'createCampaign');
}

export async function setCampaignStatus(
  campaignId: string,
  status: CampaignStatusValue
): Promise<void> {
  await retry(async () => {
    // Try PATCH first (standard v2), fall back to activate endpoint
    await getClient().patch(`/campaigns/${campaignId}`, { status })
      .catch(err => { throw apiError(err, 'setCampaignStatus'); });
  }, 'setCampaignStatus');
}

export async function activateCampaign(campaignId: string): Promise<void> {
  await setCampaignStatus(campaignId, CAMPAIGN_STATUS.ACTIVE);
}

export async function pauseCampaign(campaignId: string): Promise<void> {
  await setCampaignStatus(campaignId, CAMPAIGN_STATUS.PAUSED);
}

/** Find campaign by name (case-insensitive partial match) */
export async function findCampaignByName(showName: string): Promise<InstantlyCampaign | null> {
  const all = await listCampaigns();
  const norm = showName.toLowerCase().replace(/[^a-z0-9]/g, '');
  return all.find(c => c.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(norm)) || null;
}

// ─── Lead Methods ─────────────────────────────────────────────────────────────

/**
 * Add leads to a campaign in batches of 100.
 * Instantly deduplicates automatically with skip_if_in_campaign.
 */
export async function addLeads(
  campaignId: string,
  leads: InstantlyLead[],
  options: { skipIfInWorkspace?: boolean; skipIfInCampaign?: boolean } = {}
): Promise<{ added: number; skipped: number; failed: number }> {
  let added = 0;
  let skipped = 0;
  let failed = 0;

  const BATCH = 100;
  for (let i = 0; i < leads.length; i += BATCH) {
    const batch = leads.slice(i, i + BATCH);
    try {
      await retry(async () => {
        const resp = await getClient().post('/leads', {
          campaign_id: campaignId,
          skip_if_in_workspace: options.skipIfInWorkspace ?? true,
          skip_if_in_campaign:  options.skipIfInCampaign  ?? true,
          leads: batch.map(l => ({
            email:         l.email,
            first_name:    l.first_name    || '',
            last_name:     l.last_name     || '',
            company_name:  l.company_name  || '',
            personalization: l.personalization || '',
            website:       l.website       || '',
            phone:         l.phone         || '',
            ...(l.custom_variables ? { variables: l.custom_variables } : {}),
          })),
        }).catch(err => { throw apiError(err, 'addLeads'); });

        const result = resp.data;
        // Instantly returns total_count, new_count, duplicate_count
        added  += Number(result?.new_count ?? result?.added ?? batch.length);
        skipped += Number(result?.duplicate_count ?? result?.duplicates ?? 0);
      }, `addLeads[${i}]`);
    } catch (err) {
      logger.warn(`[Instantly] Batch ${i}–${i + batch.length} failed: ${(err as Error).message}`);
      failed += batch.length;
    }

    // 500ms between batches to stay within rate limits
    if (i + BATCH < leads.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return { added, skipped, failed };
}

/** Remove a lead from a campaign by email */
export async function removeLead(campaignId: string, email: string): Promise<void> {
  await retry(async () => {
    await getClient().delete('/leads', { data: { campaign_id: campaignId, emails: [email] } })
      .catch(err => { throw apiError(err, 'removeLead'); });
  }, 'removeLead');
}

// ─── Campaign Analytics ───────────────────────────────────────────────────────

export async function getCampaignSummary(
  campaignId: string
): Promise<InstantlyCampaignSummary> {
  return retry(async () => {
    const resp = await getClient().post('/analytics/campaigns/summary', {
      campaign_ids: [campaignId],
    }).catch(err => { throw apiError(err, 'getCampaignSummary'); });

    const data: any[] = Array.isArray(resp.data) ? resp.data : [resp.data].filter(Boolean);
    const d = data[0] ?? {};
    const sent    = Number(d?.emails_sent    ?? d?.total_sent  ?? 0);
    const opened  = Number(d?.total_opened  ?? d?.opened       ?? 0);
    const replied = Number(d?.total_replied ?? d?.replied      ?? 0);
    const bounced = Number(d?.total_bounced ?? d?.bounced      ?? 0);
    return {
      campaign_id:   campaignId,
      campaign_name: String(d?.campaign_name ?? ''),
      total_leads:   Number(d?.total_leads   ?? 0),
      emails_sent:   sent,
      opened, replied, bounced,
      unsubscribed:  Number(d?.total_unsubscribed ?? d?.unsubscribed ?? 0),
      open_rate:   sent > 0 ? Math.round((opened  / sent) * 100) : 0,
      reply_rate:  sent > 0 ? Math.round((replied / sent) * 100) : 0,
      bounce_rate: sent > 0 ? Math.round((bounced / sent) * 100) : 0,
    };
  }, 'getCampaignSummary');
}

export async function getAllCampaignSummaries(
  campaignIds: string[]
): Promise<InstantlyCampaignSummary[]> {
  if (!campaignIds.length) return [];
  return retry(async () => {
    const resp = await getClient().post('/analytics/campaigns/summary', {
      campaign_ids: campaignIds,
    }).catch(err => { throw apiError(err, 'getAllCampaignSummaries'); });

    const data: any[] = Array.isArray(resp.data) ? resp.data : [resp.data].filter(Boolean);
    return data.map(d => {
      const sent    = Number(d?.emails_sent    ?? d?.total_sent  ?? 0);
      const opened  = Number(d?.total_opened  ?? d?.opened       ?? 0);
      const replied = Number(d?.total_replied ?? d?.replied      ?? 0);
      const bounced = Number(d?.total_bounced ?? d?.bounced      ?? 0);
      return {
        campaign_id:   String(d?.campaign_id   ?? ''),
        campaign_name: String(d?.campaign_name ?? ''),
        total_leads:   Number(d?.total_leads   ?? 0),
        emails_sent:   sent,
        opened, replied, bounced,
        unsubscribed:  Number(d?.total_unsubscribed ?? d?.unsubscribed ?? 0),
        open_rate:   sent > 0 ? Math.round((opened  / sent) * 100) : 0,
        reply_rate:  sent > 0 ? Math.round((replied / sent) * 100) : 0,
        bounce_rate: sent > 0 ? Math.round((bounced / sent) * 100) : 0,
      };
    });
  }, 'getAllCampaignSummaries');
}

// ─── Sending Accounts (Inboxes) ───────────────────────────────────────────────

export async function listAccounts(): Promise<InstantlyAccount[]> {
  return retry(async () => {
    const resp = await getClient().get('/accounts', { params: { limit: 100 } })
      .catch(err => { throw apiError(err, 'listAccounts'); });
    const items: any[] = Array.isArray(resp.data?.items) ? resp.data.items
      : Array.isArray(resp.data) ? resp.data : [];
    return items.map(a => ({
      id:           String(a.id ?? a.email ?? ''),
      email:        String(a.email ?? ''),
      status:       String(a.status ?? 'unknown'),
      warmup_status: String(a.warmup_status ?? ''),
      daily_limit:  Number(a.daily_limit ?? 50),
    }));
  }, 'listAccounts');
}

/** Total daily send capacity across all active accounts */
export async function getDailyCapacity(): Promise<number> {
  const accounts = await listAccounts().catch(() => [] as InstantlyAccount[]);
  const active = accounts.filter(a => a.status === 'active' || a.status === 'connected');
  if (!active.length) return 0;
  return active.reduce((sum, a) => sum + (a.daily_limit ?? 50), 0);
}

// ─── Reply Handling ───────────────────────────────────────────────────────────

export async function getReplies(options: {
  campaignId?: string;
  since?: Date;
  limit?: number;
} = {}): Promise<InstantlyReply[]> {
  return retry(async () => {
    const params: Record<string, any> = { limit: options.limit ?? 100 };
    if (options.campaignId) params.campaign_id = options.campaignId;
    if (options.since) params.after = options.since.toISOString();

    const resp = await getClient().get('/emails/reply-emails', { params })
      .catch(err => { throw apiError(err, 'getReplies'); });

    const items: any[] = Array.isArray(resp.data?.items) ? resp.data.items
      : Array.isArray(resp.data) ? resp.data : [];

    return items.map(r => ({
      id:          String(r.id         ?? ''),
      from_email:  String(r.from_email ?? r.from ?? ''),
      from_name:   String(r.from_name  ?? ''),
      subject:     String(r.subject    ?? ''),
      body:        String(r.body       ?? r.text ?? ''),
      timestamp:   String(r.timestamp  ?? r.created_at ?? ''),
      campaign_id: String(r.campaign_id ?? ''),
      lead_email:  String(r.lead_email ?? r.from_email ?? ''),
    }));
  }, 'getReplies');
}

// ─── Email Verification ───────────────────────────────────────────────────────

/**
 * Verify a batch of emails using Instantly's built-in verifier.
 * Falls back gracefully if the endpoint isn't available on the current plan.
 */
export async function verifyEmails(emails: string[]): Promise<{
  valid: string[];
  risky: string[];
  invalid: string[];
}> {
  if (!emails.length) return { valid: [], risky: [], invalid: [] };

  try {
    const resp = await getClient()
      .post('/email-verifier/verify', { emails: emails.slice(0, 1000) })
      .catch(() => null);

    if (!resp?.data) {
      // Endpoint not available on plan — treat all as valid
      // (Instantly silently handles bounces during sending anyway)
      return { valid: emails, risky: [], invalid: [] };
    }

    const valid: string[] = [];
    const risky: string[] = [];
    const invalid: string[] = [];
    const results: any[] = Array.isArray(resp.data) ? resp.data : [];

    for (const r of results) {
      const email  = String(r.email ?? '');
      const status = String(r.status ?? '').toLowerCase();
      if (status === 'valid')                            valid.push(email);
      else if (status === 'risky' || status === 'accept_all') risky.push(email);
      else                                               invalid.push(email);
    }

    return { valid, risky, invalid };
  } catch {
    return { valid: emails, risky: [], invalid: [] };
  }
}

// ─── Health & Utility ─────────────────────────────────────────────────────────

export function isInstantlyConfigured(): boolean {
  return !!process.env.INSTANTLY_API_KEY;
}

/** Quick connection test — returns number of campaigns or throws */
export async function testConnection(): Promise<number> {
  const campaigns = await listCampaigns();
  return campaigns.length;
}
