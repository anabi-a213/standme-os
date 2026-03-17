import { ConfidenceLevel } from './confidence';

export interface Lead {
  id: string;
  timestamp: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactTitle: string;
  showName: string;
  showCity: string;
  standSize: string;
  budget: string;
  industry: string;
  leadSource: string;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  confidence: ConfidenceLevel;
  status: LeadStatus;
  trelloCardId?: string;
  enrichmentStatus: EnrichmentStatus;
  dmName?: string;
  dmTitle?: string;
  dmLinkedIn?: string;
  dmEmail?: string;
  outreachReadiness?: number;
  language: 'ar' | 'en' | 'franco';
  notes: string;
}

export interface ScoreBreakdown {
  showFit: number;      // 0-2
  sizeSignal: number;   // 0-2
  industryFit: number;  // 0-2
  dmSignal: number;     // 0-2
  timeline: number;     // 0-2
}

export type LeadStatus = 'HOT' | 'WARM' | 'COLD' | 'DISQUALIFIED' | 'WON' | 'LOST';
export type EnrichmentStatus = 'PENDING' | 'IN_PROGRESS' | 'ENRICHED' | 'FAILED';

export interface LeadScoreResult {
  total: number;
  breakdown: ScoreBreakdown;
  status: LeadStatus;
}
