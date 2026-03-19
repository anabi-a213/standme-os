/**
 * Unit tests for src/utils/confidence.ts
 * Pure logic — no mocks required.
 */
import {
  assessConfidence,
  confidenceEmoji,
  canAutomate,
  canActWithAssumption,
} from '../utils/confidence';

describe('assessConfidence', () => {
  it('returns HIGH when hasVerifiedSource is true', () => {
    expect(assessConfidence({ hasVerifiedSource: true })).toBe('HIGH');
  });

  it('returns HIGH when hasDirectMatch is true', () => {
    expect(assessConfidence({ hasDirectMatch: true })).toBe('HIGH');
  });

  it('returns HIGH when both hasVerifiedSource and hasDirectMatch are true', () => {
    expect(assessConfidence({ hasVerifiedSource: true, hasDirectMatch: true })).toBe('HIGH');
  });

  it('returns MEDIUM when isPartialMatch is true (and no verified/direct)', () => {
    expect(assessConfidence({ isPartialMatch: true })).toBe('MEDIUM');
  });

  it('returns LOW when isEstimated is true (and no higher signals)', () => {
    expect(assessConfidence({ isEstimated: true })).toBe('LOW');
  });

  it('returns LOW for empty factors', () => {
    expect(assessConfidence({})).toBe('LOW');
  });

  it('hasVerifiedSource beats isPartialMatch', () => {
    expect(assessConfidence({ hasVerifiedSource: true, isPartialMatch: true })).toBe('HIGH');
  });

  it('hasVerifiedSource beats isEstimated', () => {
    expect(assessConfidence({ hasVerifiedSource: true, isEstimated: true })).toBe('HIGH');
  });

  it('isPartialMatch beats isEstimated', () => {
    expect(assessConfidence({ isPartialMatch: true, isEstimated: true })).toBe('MEDIUM');
  });
});

describe('confidenceEmoji', () => {
  it('returns green circle for HIGH', () => {
    expect(confidenceEmoji('HIGH')).toBe('🟢');
  });

  it('returns yellow circle for MEDIUM', () => {
    expect(confidenceEmoji('MEDIUM')).toBe('🟡');
  });

  it('returns red circle for LOW', () => {
    expect(confidenceEmoji('LOW')).toBe('🔴');
  });
});

describe('canAutomate', () => {
  it('returns true only for HIGH', () => {
    expect(canAutomate('HIGH')).toBe(true);
    expect(canAutomate('MEDIUM')).toBe(false);
    expect(canAutomate('LOW')).toBe(false);
  });
});

describe('canActWithAssumption', () => {
  it('returns true for HIGH', () => {
    expect(canActWithAssumption('HIGH')).toBe(true);
  });

  it('returns true for MEDIUM', () => {
    expect(canActWithAssumption('MEDIUM')).toBe(true);
  });

  it('returns false for LOW', () => {
    expect(canActWithAssumption('LOW')).toBe(false);
  });
});
