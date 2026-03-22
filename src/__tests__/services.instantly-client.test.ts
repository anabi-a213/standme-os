/**
 * Unit tests for the Instantly.ai API client.
 *
 * Covers the highest-risk logic:
 *   - addLeads: batch counting across all known response shapes
 *   - addLeads: empty campaignId guard
 *   - addLeads: sanitization integration (bad emails dropped before sending)
 *   - findCampaignByName: strict matching rules
 *   - campaignStatusLabel: exhaustive status mapping
 *
 * All HTTP calls are mocked via jest — no real Instantly API calls.
 */

jest.mock('../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));
jest.mock('../utils/retry', () => ({
  retry: jest.fn((fn: () => Promise<any>) => fn()),
}));

// Capture the axios.create mock so individual tests can control responses
let mockPost = jest.fn();
let mockGet  = jest.fn();
let mockPatch = jest.fn();
let mockDelete = jest.fn();

jest.mock('axios', () => ({
  ...jest.requireActual('axios'),
  create: jest.fn(() => ({
    get:    (...a: any[]) => mockGet(...a),
    post:   (...a: any[]) => mockPost(...a),
    patch:  (...a: any[]) => mockPatch(...a),
    delete: (...a: any[]) => mockDelete(...a),
  })),
  isAxiosError: jest.fn((e: any) => e?.isAxiosError === true),
}));

import {
  addLeads,
  findCampaignByName,
  campaignStatusLabel,
  CAMPAIGN_STATUS,
  resetInstantlyClient,
} from '../services/instantly/client';

beforeEach(() => {
  jest.clearAllMocks();
  // Reset the singleton client so each test gets a fresh axios instance
  resetInstantlyClient();
  process.env.INSTANTLY_API_KEY = 'test-key';
});

// ─── addLeads ─────────────────────────────────────────────────────────────────

describe('addLeads', () => {
  const CAMPAIGN = 'camp-001';
  const VALID_LEAD = { email: 'test@example.com', first_name: 'Test', company_name: 'Example' };

  it('returns {added:0, skipped:0, failed:N} when campaignId is empty', async () => {
    const result = await addLeads('', [VALID_LEAD]);
    expect(result).toEqual({ added: 0, skipped: 0, failed: 1 });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('returns {added:0, skipped:0, failed:N} when campaignId is whitespace', async () => {
    const result = await addLeads('   ', [VALID_LEAD]);
    expect(result).toEqual({ added: 0, skipped: 0, failed: 1 });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('returns zeroes when leads array is empty after sanitization', async () => {
    const result = await addLeads(CAMPAIGN, [{ email: '' }]); // invalid email
    expect(result).toEqual({ added: 0, skipped: 0, failed: 0 });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('handles standard { added, skipped, failed } response shape', async () => {
    mockPost.mockResolvedValue({ data: { added: 5, skipped: 2, failed: 1 } });

    const leads = Array.from({ length: 8 }, (_, i) => ({
      email: `user${i}@example.com`,
    }));
    const result = await addLeads(CAMPAIGN, leads);
    expect(result.added).toBe(5);
    expect(result.skipped).toBe(2);
    expect(result.failed).toBe(1);
  });

  it('handles array-of-per-lead response shape', async () => {
    mockPost.mockResolvedValue({
      data: [
        { status: 'added' },
        { status: 'skipped', duplicate: true },
        { status: 'error', error: 'bad email' },
        { status: 'added' },
      ],
    });

    const leads = [
      { email: 'a@example.com' },
      { email: 'b@example.com' },
      { email: 'c@example.com' },
      { email: 'd@example.com' },
    ];
    const result = await addLeads(CAMPAIGN, leads);
    expect(result.added).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('handles unknown 2xx shape by counting as added and logging a warning', async () => {
    const { logger } = require('../utils/logger');
    mockPost.mockResolvedValue({ data: { status: 'ok', message: 'processed' } });

    const result = await addLeads(CAMPAIGN, [VALID_LEAD]);
    expect(result.added).toBe(1); // fallback: count batch as added
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('unrecognised 2xx response shape')
    );
  });

  it('counts all leads in a failed batch as failed', async () => {
    mockPost.mockRejectedValue({ message: 'Network error', isAxiosError: false });

    const leads = Array.from({ length: 3 }, (_, i) => ({ email: `u${i}@example.com` }));
    const result = await addLeads(CAMPAIGN, leads);
    expect(result.failed).toBe(3);
    expect(result.added).toBe(0);
  });

  it('drops leads with invalid emails before sending', async () => {
    mockPost.mockResolvedValue({ data: { added: 1, skipped: 0, failed: 0 } });

    const leads = [
      { email: 'valid@example.com' },
      { email: 'not-an-email' },   // invalid — should be dropped
      { email: '' },                // empty — should be dropped
    ];
    const result = await addLeads(CAMPAIGN, leads);

    // Only 1 valid lead sent
    const postBody = mockPost.mock.calls[0][1];
    expect(postBody.leads).toHaveLength(1);
    expect(postBody.leads[0].email).toBe('valid@example.com');
    expect(result.added).toBe(1);
  });

  it('sends correct payload fields to Instantly', async () => {
    mockPost.mockResolvedValue({ data: { added: 1, skipped: 0, failed: 0 } });

    await addLeads('camp-xyz', [{ email: 'test@acme.com', first_name: 'Alice', company_name: 'Acme' }]);

    expect(mockPost).toHaveBeenCalledWith(
      '/leads/add',
      expect.objectContaining({
        campaign_id: 'camp-xyz',
        skip_if_in_workspace: true,
        skip_if_in_campaign:  true,
        leads: expect.arrayContaining([
          expect.objectContaining({ email: 'test@acme.com', first_name: 'Alice' }),
        ]),
      })
    );
  });
});

// ─── findCampaignByName ───────────────────────────────────────────────────────

describe('findCampaignByName', () => {
  function makeCampaign(name: string, status = 1) {
    return { id: `id-${name}`, name, status };
  }

  it('finds a campaign by exact name', async () => {
    mockGet.mockResolvedValue({
      data: { items: [makeCampaign('Intersolar 2026 - StandMe')] },
    });

    const result = await findCampaignByName('Intersolar 2026 - StandMe');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Intersolar 2026 - StandMe');
  });

  it('matches when campaign name starts with the show filter', async () => {
    mockGet.mockResolvedValue({
      data: { items: [makeCampaign('Intersolar 2026 - StandMe')] },
    });

    const result = await findCampaignByName('intersolar');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Intersolar 2026 - StandMe');
  });

  it('matches on a whole word boundary — "gulfood" matches "Gulfood 2026 - StandMe"', async () => {
    mockGet.mockResolvedValue({
      data: { items: [makeCampaign('Gulfood 2026 - StandMe')] },
    });

    const result = await findCampaignByName('gulfood');
    expect(result).not.toBeNull();
  });

  it('does NOT match a short substring — "sol" should not match "Intersolar"', async () => {
    mockGet.mockResolvedValue({
      data: { items: [makeCampaign('Intersolar 2026 - StandMe')] },
    });

    const result = await findCampaignByName('sol');
    expect(result).toBeNull(); // too short (< 4 chars) OR no word match
  });

  it('does NOT match when show filter is embedded in the middle of a word', async () => {
    // "solar" is contained in "Intersolar" but is NOT a whole word in the name
    mockGet.mockResolvedValue({
      data: { items: [makeCampaign('Intersolar 2026 - StandMe')] },
    });

    // "solar" alone should NOT match "Intersolar" (it's not a leading or whole-word match)
    const result = await findCampaignByName('solar');
    // "intersolar" does NOT start with "solar", and "solar" is not a standalone word
    expect(result).toBeNull();
  });

  it('returns null when no campaigns exist', async () => {
    mockGet.mockResolvedValue({ data: { items: [] } });
    expect(await findCampaignByName('intersolar')).toBeNull();
  });

  it('returns null for empty/short show name (< 4 chars)', async () => {
    mockGet.mockResolvedValue({ data: { items: [makeCampaign('Test')] } });
    expect(await findCampaignByName('ab')).toBeNull();
    expect(await findCampaignByName('')).toBeNull();
  });

  it('is case-insensitive', async () => {
    mockGet.mockResolvedValue({
      data: { items: [makeCampaign('MEDICA 2026 - StandMe')] },
    });

    const result = await findCampaignByName('medica');
    expect(result).not.toBeNull();
  });
});

// ─── campaignStatusLabel ──────────────────────────────────────────────────────

describe('campaignStatusLabel', () => {
  it('maps all known status codes', () => {
    expect(campaignStatusLabel(CAMPAIGN_STATUS.DRAFT)).toBe('DRAFT');
    expect(campaignStatusLabel(CAMPAIGN_STATUS.ACTIVE)).toBe('ACTIVE');
    expect(campaignStatusLabel(CAMPAIGN_STATUS.PAUSED)).toBe('PAUSED');
    expect(campaignStatusLabel(CAMPAIGN_STATUS.COMPLETED)).toBe('COMPLETED');
  });

  it('returns a fallback for unknown codes', () => {
    expect(campaignStatusLabel(99)).toBe('STATUS_99');
  });
});
