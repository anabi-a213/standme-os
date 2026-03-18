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
  snippet1?: string; // show name
  snippet2?: string; // stand size
  snippet3?: string; // custom hook
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

// ---- Campaigns ----

export async function listCampaigns(): Promise<WoodpeckerCampaign[]> {
  return retry(async () => {
    const resp = await getWoodpeckerClient().get('/campaign_list');
    const data = resp.data;
    // Woodpecker returns an object keyed by campaign ID, or an array
    if (Array.isArray(data)) return data;
    return Object.values(data);
  }, 'listCampaigns');
}

export async function getCampaignStats(campaignId: number): Promise<CampaignStats> {
  return retry(async () => {
    const resp = await getWoodpeckerClient().get(`/campaign_list/${campaignId}/statistics`);
    const d = resp.data;
    return {
      id: campaignId,
      name: d.name || `Campaign ${campaignId}`,
      sent: Number(d.sent || 0),
      opened: Number(d.opened || 0),
      clicked: Number(d.clicked || 0),
      replied: Number(d.replied || 0),
      bounced: Number(d.bounced || 0),
      interested: Number(d.interested || 0),
      not_interested: Number(d.not_interested || 0),
    };
  }, 'getCampaignStats');
}

// ---- Prospects ----

export async function addProspectToCampaign(campaignId: number, prospect: WoodpeckerProspect): Promise<number | null> {
  return retry(async () => {
    const resp = await getWoodpeckerClient().post(`/campaign_list/${campaignId}/prospects`, {
      prospects: [prospect],
    });
    // Woodpecker returns { status: 'OK', prospects: [{id, ...}] }
    const created = resp.data?.prospects?.[0];
    return created?.id ?? null;
  }, 'addProspectToCampaign');
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

export async function stopProspect(prospectId: number): Promise<void> {
  await retry(async () => {
    await getWoodpeckerClient().put(`/prospects/${prospectId}`, {
      status: 'PAUSED',
    });
  }, 'stopProspect');
}
