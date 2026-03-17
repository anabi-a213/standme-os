import axios, { AxiosInstance } from 'axios';
import { retry } from '../../utils/retry';

let _client: AxiosInstance | null = null;

function getWoodpeckerClient(): AxiosInstance {
  if (!_client) {
    _client = axios.create({
      baseURL: 'https://api.woodpecker.co/rest/v1',
      headers: {
        Authorization: `Basic ${Buffer.from(process.env.WOODPECKER_API_KEY + ':').toString('base64')}`,
        'Content-Type': 'application/json',
      },
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

export async function addProspectToCampaign(campaignId: number, prospect: WoodpeckerProspect): Promise<void> {
  await retry(async () => {
    await getWoodpeckerClient().post(`/campaign_list/${campaignId}/prospects`, {
      prospects: [prospect],
    });
  }, 'addProspectToCampaign');
}

export async function getCampaignStats(campaignId: number): Promise<CampaignStats> {
  return retry(async () => {
    const resp = await getWoodpeckerClient().get(`/campaign_list/${campaignId}/statistics`);
    return resp.data;
  }, 'getCampaignStats');
}

export async function listCampaigns(): Promise<{ id: number; name: string; status: string }[]> {
  return retry(async () => {
    const resp = await getWoodpeckerClient().get('/campaign_list');
    return resp.data;
  }, 'listCampaigns');
}

export async function getProspectActivity(email: string): Promise<{
  status: string;
  opened: boolean;
  clicked: boolean;
  replied: boolean;
  bounced: boolean;
}> {
  return retry(async () => {
    const resp = await getWoodpeckerClient().get('/prospects', {
      params: { search: email },
    });
    const prospect = resp.data?.[0];
    if (!prospect) return { status: 'NOT_FOUND', opened: false, clicked: false, replied: false, bounced: false };
    return {
      status: prospect.status || 'UNKNOWN',
      opened: prospect.opened === 'true' || prospect.opened === true,
      clicked: prospect.clicked === 'true' || prospect.clicked === true,
      replied: prospect.replied === 'true' || prospect.replied === true,
      bounced: prospect.bounced === 'true' || prospect.bounced === true,
    };
  }, 'getProspectActivity');
}

export async function stopProspect(prospectId: number): Promise<void> {
  await retry(async () => {
    await getWoodpeckerClient().put(`/prospects/${prospectId}`, {
      status: 'PAUSED',
    });
  }, 'stopProspect');
}
