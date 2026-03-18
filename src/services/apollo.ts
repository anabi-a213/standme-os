/**
 * Apollo.io API — Decision Maker Discovery
 *
 * Used by the lead discovery flow to find the right contact at each exhibiting company.
 * Priority order is based on who actually controls exhibition stand budgets:
 *   1. Exhibition / Events / Trade Show Manager  — owns the show budget directly
 *   2. Marketing Manager / Head of Marketing     — approves spend
 *   3. Brand / Communications Manager            — next fallback
 *   4. CMO / VP Marketing                        — larger companies
 *   5. CEO / MD / GM                             — only for small companies
 */

import axios from 'axios';
import { logger } from '../utils/logger';

const APOLLO_BASE = 'https://api.apollo.io/v1';

// Ordered priority groups — lower index = higher priority
const TITLE_PRIORITY_GROUPS = [
  ['exhibition manager', 'events manager', 'trade show manager', 'event manager', 'expo manager'],
  ['marketing manager', 'head of marketing', 'marketing director', 'marketing lead'],
  ['brand manager', 'communications manager', 'comms manager'],
  ['cmo', 'chief marketing officer', 'vp marketing', 'vp of marketing', 'head of brand'],
  ['ceo', 'managing director', 'general manager', 'owner', 'founder', 'president'],
];

export const DM_TITLES = TITLE_PRIORITY_GROUPS.flat().map(t =>
  t.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
);

export interface ApolloContact {
  name: string;
  firstName: string;
  lastName: string;
  title: string;
  email: string;
  emailStatus: string; // 'verified' | 'likely' | 'guessed' | 'unavailable' | 'bounced'
  linkedinUrl: string;
  companyName: string;
  priorityRank: number; // 0 = highest priority
}

function extractDomain(website?: string, existingEmail?: string): string | null {
  if (website) {
    try {
      const url = website.startsWith('http') ? website : `https://${website}`;
      return new URL(url).hostname.replace(/^www\./, '');
    } catch { /* invalid URL */ }
  }
  if (existingEmail && existingEmail.includes('@')) {
    const domain = existingEmail.split('@')[1];
    const freeProviders = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com'];
    if (!freeProviders.includes(domain)) return domain;
  }
  return null;
}

function titlePriority(title: string): number {
  const lower = title.toLowerCase();
  for (let i = 0; i < TITLE_PRIORITY_GROUPS.length; i++) {
    if (TITLE_PRIORITY_GROUPS[i].some(t => lower.includes(t))) return i;
  }
  return TITLE_PRIORITY_GROUPS.length;
}

// Enforce minimum 500ms between Apollo calls to stay within rate limits
let _lastCallAt = 0;
async function rateLimit(): Promise<void> {
  const wait = 500 - (Date.now() - _lastCallAt);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastCallAt = Date.now();
}

/**
 * Find the best decision maker for an exhibiting company.
 * Returns null if no verified/likely contact found.
 */
export async function findDecisionMaker(
  companyName: string,
  website?: string,
  existingEmail?: string,
): Promise<ApolloContact | null> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    logger.warn('[Apollo] APOLLO_API_KEY not set — skipping enrichment');
    return null;
  }

  const domain = extractDomain(website, existingEmail);

  await rateLimit();

  try {
    const payload: Record<string, any> = {
      api_key: apiKey,
      person_titles: DM_TITLES,
      page: 1,
      per_page: 10,
    };

    if (domain) {
      payload.q_organization_domains = [domain];
    } else {
      // Fall back to keyword search by company name
      payload.q_keywords = companyName;
    }

    const res = await axios.post(`${APOLLO_BASE}/mixed_people/search`, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000,
    });

    const people: any[] = res.data?.people || [];
    if (!people.length) return null;

    const candidates = people
      .filter(p => p.email && !['bounced', 'unavailable'].includes(p.email_status || ''))
      .map(p => ({
        name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
        firstName: p.first_name || '',
        lastName: p.last_name || '',
        title: p.title || '',
        email: p.email || '',
        emailStatus: p.email_status || 'unknown',
        linkedinUrl: p.linkedin_url || '',
        companyName: p.organization?.name || companyName,
        priorityRank: titlePriority(p.title || ''),
      }))
      .sort((a, b) => a.priorityRank - b.priorityRank);

    return candidates[0] || null;

  } catch (err: any) {
    if (err.response?.status === 429) {
      logger.warn('[Apollo] Rate limited — sleeping 15s before retry');
      await new Promise(r => setTimeout(r, 15000));
      _lastCallAt = Date.now();
    } else {
      logger.warn(`[Apollo] findDecisionMaker failed for "${companyName}": ${err.message}`);
    }
    return null;
  }
}
