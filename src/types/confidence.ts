export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ConfidenceTag<T = string> {
  value: T;
  confidence: ConfidenceLevel;
  source?: string;
}
