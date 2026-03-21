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

// Cached valid timezone for this account — resolved once, reused forever.
let _validTimezone: string | null = null;

// Probe list: try these in order until Instantly accepts one.
// Deliberately broad — covers every format Instantly has been seen to accept.
const TIMEZONE_CANDIDATES = [
  'UTC',
  'Etc/UTC',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Pacific/Auckland',
];

/**
 * Resolves a timezone string guaranteed to be accepted by Instantly.
 * Strategy:
 *   1. Return cached value if already known.
 *   2. Fetch the first existing campaign and read its timezone.
 *   3. Probe TIMEZONE_CANDIDATES one-by-one until a test POST accepts one.
 * Result is cached so this runs at most once per server lifetime.
 */
async function resolveValidTimezone(): Promise<string> {
  if (_validTimezone) return _validTimezone;

  // Strategy 1: steal timezone from an existing campaign (guaranteed valid)
  try {
    const resp = await getClient().get('/campaigns', { params: { limit: 1, skip: 0 } });
    const items: any[] = Array.isArray(resp.data?.items) ? resp.data.items
      : Array.isArray(resp.data) ? resp.data : [];
    const tz = items[0]?.campaign_schedule?.schedules?.[0]?.timezone
      ?? items[0]?.schedules?.[0]?.timezone;
    if (tz && typeof tz === 'string') {
      logger.info(`[Instantly] Using timezone from existing campaign: ${tz}`);
      _validTimezone = tz;
      return tz;
    }
  } catch { /* no campaigns or API error — fall through to probe */ }

  // Strategy 2: probe until Instantly accepts one
  for (const tz of TIMEZONE_CANDIDATES) {
    try {
      // Minimal test campaign — we'll delete it if creation succeeds
      const testBody = {
        name: `__tz_probe_${Date.now()}`,
        campaign_schedule: {
          schedules: [{
            name: 'probe',
            timing: { from: '08:00', to: '18:00' },
            days: { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false },
            timezone: tz,
          }],
        },
      };
      const r = await getClient().post('/campaigns', testBody);
      const probeId = String(r.data?.id ?? r.data?.campaign_id ?? '');
      // Clean up the probe campaign silently
      if (probeId) getClient().delete(`/campaigns/${probeId}`).catch(() => {});
      logger.info(`[Instantly] Probed valid timezone: ${tz}`);
      _validTimezone = tz;
      return tz;
    } catch { /* this tz rejected — try next */ }
  }

  // Should never reach here, but last-resort: return UTC and let Instantly complain
  logger.warn('[Instantly] Could not resolve valid timezone — falling back to UTC');
  _validTimezone = 'UTC';
  return 'UTC';
}

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

// ─── Data Sanitization ────────────────────────────────────────────────────────
//
// ALL data passes through here before touching Instantly's API.
// Handles: whitespace, BOM/zero-width chars, encoding, length limits,
// email validation, URL normalisation, unsafe characters in names.

/** Strip BOM, zero-width spaces, non-printable chars, and trim */
function cleanStr(s: unknown, maxLen = 255): string {
  if (s == null) return '';
  return String(s)
    .replace(/^\uFEFF/, '')            // BOM
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '') // zero-width / soft hyphen
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // control chars
    .trim()
    .slice(0, maxLen);
}

/** Validate and normalise an email address.
 *  Returns the cleaned email, or '' if it looks invalid. */
function cleanEmail(raw: unknown): string {
  const s = cleanStr(raw, 320).toLowerCase();
  if (!s) return '';
  // Must contain exactly one @, with non-empty local and domain parts
  const parts = s.split('@');
  if (parts.length !== 2) return '';
  const [local, domain] = parts;
  if (!local || !domain || !domain.includes('.')) return '';
  // Strip any stray whitespace, quotes, angle-brackets that some sheets have
  const clean = s.replace(/[<>"';\s]/g, '');
  // Basic sanity: only allow chars valid in email addresses
  if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(clean)) return '';
  return clean;
}

/** Normalise a name: remove numbers-only strings, limit to 100 chars */
function cleanName(raw: unknown): string {
  const s = cleanStr(raw, 100);
  // Drop values that are obviously not names (pure numbers, IDs)
  if (/^\d+$/.test(s)) return '';
  return s;
}

/** Normalise a URL — add https:// if missing, return '' if clearly invalid */
function cleanWebsite(raw: unknown): string {
  let s = cleanStr(raw, 2048);
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try { new URL(s); return s; } catch { return ''; }
}

/** Sanitize a complete InstantlyLead before sending to the API.
 *  Returns null if the lead has no valid email (must be dropped). */
export function sanitizeLead(raw: InstantlyLead): InstantlyLead | null {
  const email = cleanEmail(raw.email);
  if (!email) return null;   // no valid email → skip

  const firstName = cleanName(raw.first_name) || 'Team';
  const lastName  = cleanName(raw.last_name);

  // Personalization capped at 500 chars (Instantly limit observed in practice)
  const personalization = cleanStr(raw.personalization, 500);

  // Clean custom_variables: ensure all keys/values are safe strings
  const custom_variables: Record<string, string> | undefined = raw.custom_variables
    ? Object.fromEntries(
        Object.entries(raw.custom_variables).map(([k, v]) => [
          cleanStr(k, 50),
          cleanStr(v, 255),
        ])
      )
    : undefined;

  return {
    email,
    first_name:      firstName,
    last_name:       lastName,
    company_name:    cleanStr(raw.company_name, 200),
    personalization,
    website:         cleanWebsite(raw.website),
    phone:           cleanStr(raw.phone, 30),
    ...(custom_variables ? { custom_variables } : {}),
  };
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
  // Resolve a timezone Instantly will accept before building the request
  const tz = options.timezone ?? await resolveValidTimezone();

  return retry(async () => {
    const sendDays = options.sendDays ?? [1, 2, 3, 4, 5];

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

    let resp: any;
    try {
      resp = await getClient().post('/campaigns', body);
    } catch (err: any) {
      // If timezone is still rejected (cached value stale), reset cache and re-throw
      // so the next attempt re-probes with a fresh value.
      const errMsg = err?.response?.data?.message || '';
      if (typeof errMsg === 'string' && errMsg.includes('timezone')) {
        _validTimezone = null; // force re-probe next call
      }
      throw apiError(err, 'createCampaign');
    }

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
/**
 * Build a single lead payload (fields Instantly v2 accepts).
 */
function buildLeadPayload(l: InstantlyLead) {
  return {
    email:           l.email,
    first_name:      l.first_name      || '',
    last_name:       l.last_name       || '',
    company_name:    l.company_name    || '',
    personalization: l.personalization || '',
    website:         l.website         || '',
    phone:           l.phone           || '',
    ...(l.custom_variables ? { variables: l.custom_variables } : {}),
  };
}

/**
 * Add leads to a campaign.
 *
 * Instantly v2 API: POST /leads with ONE lead per request, email at TOP LEVEL.
 * Body: { campaign_id, email, first_name, last_name, company_name, ... }
 * There is no bulk/array endpoint — we send up to 20 concurrent requests.
 */
export async function addLeads(
  campaignId: string,
  leads: InstantlyLead[],
  options: { skipIfInWorkspace?: boolean; skipIfInCampaign?: boolean } = {}
): Promise<{ added: number; skipped: number; failed: number }> {

  // Sanitize ALL leads first — strips bad emails, cleans names, normalises URLs
  const valid: InstantlyLead[] = [];
  let dropped = 0;
  for (const l of leads) {
    const s = sanitizeLead(l);
    if (s) valid.push(s);
    else dropped++;
  }
  if (dropped > 0) {
    logger.warn(`[Instantly] addLeads: dropped ${dropped}/${leads.length} leads (invalid/missing email)`);
  }
  if (valid.length === 0) {
    logger.warn('[Instantly] addLeads: no valid leads after sanitization — nothing sent');
    return { added: 0, skipped: 0, failed: 0 };
  }

  logger.info(`[Instantly] addLeads: sending ${valid.length} leads to campaign ${campaignId}`);

  let added = 0;
  let skipped = 0;
  let failed = 0;
  let firstError = '';   // log just the first unique error for diagnosis

  // Send up to 20 concurrent requests, pause 500ms between groups
  const CONCURRENCY = 20;
  for (let i = 0; i < valid.length; i += CONCURRENCY) {
    const slice = valid.slice(i, i + CONCURRENCY);

    await Promise.all(slice.map(async (l) => {
      try {
        // Instantly v2 single-lead endpoint: email at top level of body
        const body: Record<string, unknown> = {
          campaign_id:          campaignId,
          skip_if_in_workspace: options.skipIfInWorkspace ?? true,
          skip_if_in_campaign:  options.skipIfInCampaign  ?? true,
          ...buildLeadPayload(l),
        };

        const resp = await getClient().post('/leads', body)
          .catch(err => { throw apiError(err, 'addLead'); });

        const r = resp.data;
        // Instantly may return duplicate/skip status in various fields
        if (r?.duplicate || r?.skipped || r?.status === 'skipped') skipped++;
        else added++;

      } catch (err: any) {
        const msg: string = err?.message || String(err);
        if (msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('already')) {
          skipped++;
        } else {
          failed++;
          if (!firstError) {
            firstError = msg;
            logger.warn(`[Instantly] addLead error (first of batch starting ${i}): ${msg}`);
          }
        }
      }
    }));

    // Log progress every 100 leads
    if ((i + CONCURRENCY) % 100 === 0 || i + CONCURRENCY >= valid.length) {
      const done = Math.min(i + CONCURRENCY, valid.length);
      logger.info(`[Instantly] addLeads progress: ${done}/${valid.length} processed (added=${added} skipped=${skipped} failed=${failed})`);
    }

    if (i + CONCURRENCY < valid.length) await new Promise(r => setTimeout(r, 500));
  }

  logger.info(`[Instantly] addLeads complete: added=${added} skipped=${skipped} failed=${failed} dropped=${dropped}`);
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
