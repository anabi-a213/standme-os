import { ConfidenceLevel } from '../types/confidence';

export function assessConfidence(factors: {
  hasVerifiedSource?: boolean;
  hasDirectMatch?: boolean;
  isEstimated?: boolean;
  isPartialMatch?: boolean;
}): ConfidenceLevel {
  if (factors.hasVerifiedSource || factors.hasDirectMatch) return 'HIGH';
  if (factors.isPartialMatch) return 'MEDIUM';
  if (factors.isEstimated) return 'LOW';
  return 'LOW';
}

export function confidenceEmoji(level: ConfidenceLevel): string {
  switch (level) {
    case 'HIGH': return '🟢';
    case 'MEDIUM': return '🟡';
    case 'LOW': return '🔴';
  }
}

export function canAutomate(level: ConfidenceLevel): boolean {
  return level === 'HIGH';
}

export function canActWithAssumption(level: ConfidenceLevel): boolean {
  return level === 'HIGH' || level === 'MEDIUM';
}
