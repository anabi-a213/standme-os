import axios, { AxiosInstance } from 'axios';
import { retry } from '../../utils/retry';

let _client: AxiosInstance | null = null;

function getWoodpeckerClient(): AxiosInstance {
  if (!_client) {
    const apiKey = process.env.WOODPECKER_API_KEY || '';
    _client = axios.create({
      baseURL: 'https://api.woodpecker.co/rest/v1',
      headers: {
        // Woodpecker uses HTTP Basic auth: API key as username, empty password
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
  }
  return _client;
}

export interface WoodpeckerProspect {
  id?: number;
  email: string;
  first_name: string;
  last_name: string;
  company: string;
  industry?: string;
  tags?: string;
  snippet1?: string; // industry-specific cold email opening hook
  snippet2?: string; // DM job title
  snippet3?: string; // company website or country
  status?: string;
}

export interface WoodpeckerCampaign {
  id: number;
  name: string;
  status: string; // RUNNING | PAUSED | COMPLETED | DRAFT
}

export interface CampaignStats {
  id: number;
  name: string;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  interested: number;
  not_interested: number;
}

export interface WoodpeckerEmailStep {
  id?: number;
  step?: number;
  subject: string;
  body: string;
  delay?: number; // days after previous step
}

export interface WoodpeckerCampaignDetails extends WoodpeckerCampaign {
  from_name?: string;
  from_email?: string;
  emails?: WoodpeckerEmailStep[];
}

// ---- Campaigns ----

/**
 * List all campaigns. Woodpecker returns an object keyed by campaign ID,
 * with stats embedded in each campaign object under `statistics`.
 * This is the only reliable campaign endpoint in Woodpecker Classic API.
 */
export async function listCampaigns(): Promise<WoodpeckerCampaign[]> {
  return retry(async () => {
    const resp = await getWoodpeckerClient().get('/campaign_list');
    const data = resp.data;
    const raw: any[] = Array.isArray(data) ? data : Object.values(data);
    return raw.map(c => ({ id: Number(c.id), name: String(c.name || ''), status: String(c.status || '') }));
  }, 'listCampaigns');
}

/**
 * Get stats for a single campaign.
 * Woodpecker Classic API does not have a per-campaign stats endpoint.
 * We fetch the full campaign list and extract the matching entry's stats.
 */
export async function getCampaignStats(campaignId: number): Promise<CampaignStats> {
  const resp = await getWoodpeckerClient().get('/campaign_list');
  const data = resp.data;
  const raw: any[] = Array.isArray(data) ? data : Object.values(data);
  const c = raw.find(x => Number(x.id) === campaignId);
  if (!c) throw new Error(`Campaign ${campaignId} not found`);

  // Stats are under `statistics` or top-level depending on API version
  const s = c.statistics ?? c;
  return {
    id: campaignId,
    name: String(c.name || `Campaign ${campaignId}`),
    sent:          Number(s.sent          ?? 0),
    opened:        Number(s.opened        ?? 0),
    clicked:       Number(s.clicked       ?? 0),
    replied:       Number(s.replied       ?? 0),
    bounced:       Number(s.bounced       ?? 0),
    interested:    Number(s.interested    ?? 0),
    not_interested: Number(s.not_interested ?? 0),
  };
}

/**
 * Get campaign details (basic info + stats).
 * Email sequences are not accessible via Woodpecker Classic API.
 */
export async function getCampaignDetails(campaignId: number): Promise<WoodpeckerCampaignDetails> {
  const resp = await getWoodpeckerClient().get('/campaign_list');
  const data = resp.data;
  const raw: any[] = Array.isArray(data) ? data : Object.values(data);
  const c = raw.find(x => Number(x.id) === campaignId);
  if (!c) throw new Error(`Campaign ${campaignId} not found`);
  return {
    id:         Number(c.id),
    name:       String(c.name       || ''),
    status:     String(c.status     || ''),
    from_name:  String(c.from_name  || ''),
    from_email: String(c.from_email || ''),
    emails: [], // Woodpecker Classic API does not expose email sequences
  };
}

/**
 * NOTE: Woodpecker Classic API does NOT support creating campaigns programmatically.
 * Campaigns must be created in the Woodpecker UI.
 * This function will always throw — callers should handle this gracefully.
 */
export async function createCampaign(_name: string, _fromName: string, _fromEmail: string): Promise<number> {
  throw new Error('Woodpecker Classic API does not support creating campaigns via API. Create the campaign in the Woodpecker UI, then re-run.');
}

// ---- Prospects ----

export async function addProspectToCampaign(campaignId: number, prospect: WoodpeckerProspect): Promise<number | null> {
  return retry(async () => {
    // Woodpecker Classic API v1: campaign key is "id", NOT "campaign_id"
    const resp = await getWoodpeckerClient().post('/add_prospects_campaign', {
      campaign: { id: campaignId },
      prospects: [prospect],
    }).catch((err: any) => {
      const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      throw new Error(`Woodpecker API error (${err.response?.status ?? '?'}): ${detail}`);
    });
    // Woodpecker returns { status: 'OK', prospects: [{id, ...}] }
    const created = resp.data?.prospects?.[0];
    return created?.id ?? null;
  }, 'addProspectToCampaign');
}

/**
 * Add multiple prospects to a campaign in batches (max 100 per request).
 * Returns array of created/updated prospect IDs (null for failed).
 */
export async function addProspectsToCampaign(
  campaignId: number,
  prospects: WoodpeckerProspect[],
  batchSize = 100,
): Promise<(number | null)[]> {
  const results: (number | null)[] = [];
  for (let i = 0; i < prospects.length; i += batchSize) {
    const batch = prospects.slice(i, i + batchSize);
    const resp = await retry(async () => {
      // Woodpecker Classic API v1: campaign key is "id", NOT "campaign_id"
      return getWoodpeckerClient().post('/add_prospects_campaign', {
        campaign: { id: campaignId },
        prospects: batch,
      }).catch((err: any) => {
        const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        throw new Error(`Woodpecker API error (${err.response?.status ?? '?'}): ${detail}`);
      });
    }, `addProspectsBatch[${i}]`);
    const returned: any[] = resp.data?.prospects ?? [];
    for (const p of returned) {
      results.push(p?.id ?? null);
    }
    // Small delay between batches to avoid rate limiting (409)
    if (i + batchSize < prospects.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return results;
}

export async function getProspectByEmail(email: string): Promise<WoodpeckerProspect | null> {
  return retry(async () => {
    const resp = await getWoodpeckerClient().get('/prospects_list', {
      params: { email },
    });
    const data = resp.data;
    if (Array.isArray(data) && data.length > 0) return data[0];
    if (typeof data === 'object' && data.email) return data;
    return null;
  }, 'getProspectByEmail');
}

export async function getProspectActivity(email: string): Promise<{
  status: string;
  opened: boolean;
  clicked: boolean;
  replied: boolean;
  bounced: boolean;
}> {
  try {
    const prospect = await getProspectByEmail(email);
    if (!prospect) return { status: 'NOT_FOUND', opened: false, clicked: false, replied: false, bounced: false };
    return {
      status: prospect.status || 'UNKNOWN',
      opened: prospect.status === 'OPENED',
      clicked: prospect.status === 'CLICKED',
      replied: prospect.status === 'REPLIED',
      bounced: prospect.status === 'BOUNCED',
    };
  } catch {
    return { status: 'ERROR', opened: false, clicked: false, replied: false, bounced: false };
  }
}

/**
 * Collect all unique sending email addresses across all Woodpecker campaigns.
 * These are the inboxes replies arrive in — used by /indexgmail to know which
 * Gmail addresses to search for business conversations.
 */
export async function listSendingInboxes(): Promise<string[]> {
  const campaigns = await listCampaigns();
  const emails = new Set<string>();

  // Fetch campaign details in parallel (max 10 at a time)
  for (let i = 0; i < campaigns.length; i += 10) {
    const batch = campaigns.slice(i, i + 10);
    const details = await Promise.allSettled(batch.map(c => getCampaignDetails(c.id)));
    for (const d of details) {
      if (d.status === 'fulfilled' && d.value.from_email) {
        emails.add(d.value.from_email.toLowerCase().trim());
      }
    }
  }

  return Array.from(emails);
}

export async function stopProspect(prospectId: number): Promise<void> {
  await retry(async () => {
    await getWoodpeckerClient().put(`/prospects/${prospectId}`, {
      status: 'PAUSED',
    });
  }, 'stopProspect');
}

// ---- Get all prospects in a campaign, optionally filtered by status ----

export async function getProspectsByCampaign(
  campaignId: number,
  status?: string
): Promise<WoodpeckerProspect[]> {
  return retry(async () => {
    const params: Record<string, string | number> = { campaign_id: campaignId };
    if (status) params.status = status;

    const resp = await getWoodpeckerClient().get('/prospects_list', { params });
    const data = resp.data;
    if (Array.isArray(data)) return data;
    // Woodpecker sometimes returns { prospects: [...] }
    if (Array.isArray(data?.prospects)) return data.prospects;
    return [];
  }, 'getProspectsByCampaign');
}
