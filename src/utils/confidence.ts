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

// ── Data field confidence (for LEAD_MASTER encoding) ────────────────────────

export type DataConfidence = 'CONFIRMED' | 'INFERRED' | 'ASSUMED';

export interface DataField {
  value: string;
  confidence: DataConfidence;
  source: string;
}

// Encode a value with its confidence for storage in Sheets
// e.g. encode('60', 'CONFIRMED', 'email') → '60::CONFIRMED::email'
export function encodeField(
  value: string,
  confidence: DataConfidence,
  source: string
): string {
  if (!value) return '';
  return `${value}::${confidence}::${source}`;
}

// Decode a stored field back to its parts
// Returns { value, confidence, source } or null if not encoded
export function decodeField(raw: string): DataField | null {
  if (!raw) return null;
  const parts = raw.split('::');
  if (parts.length === 3) {
    return {
      value: parts[0],
      confidence: parts[1] as DataConfidence,
      source: parts[2],
    };
  }
  // Legacy value with no encoding — treat as CONFIRMED from unknown source
  return { value: raw, confidence: 'CONFIRMED', source: 'legacy' };
}

// Get clean display value (strips confidence encoding)
export function displayValue(raw: string): string {
  const decoded = decodeField(raw);
  return decoded ? decoded.value : raw;
}

// Get confidence of a stored field
export function getConfidence(raw: string): DataConfidence {
  const decoded = decodeField(raw);
  return decoded ? decoded.confidence : 'CONFIRMED';
}

// Can new data overwrite existing data?
// Rule: only overwrite if new confidence >= existing confidence
export function canOverwrite(
  existing: string,
  newConfidence: DataConfidence
): boolean {
  const existingConf = getConfidence(existing);
  const order: Record<DataConfidence, number> = {
    CONFIRMED: 3,
    INFERRED: 2,
    ASSUMED: 1,
  };
  return order[newConfidence] >= order[existingConf];
}

// Format an assumption label for output text
export function assumptionLabel(confidence: DataConfidence): string {
  if (confidence === 'CONFIRMED') return '';
  if (confidence === 'INFERRED') return ' (estimated)';
  return ' ⚠️ [assumed — confirm with client]';
}
