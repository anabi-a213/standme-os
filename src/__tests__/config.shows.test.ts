/**
 * Unit tests for src/config/shows.ts
 * Pure logic — no mocks required.
 */
import { VERIFIED_SHOWS, validateShow, ShowInfo } from '../config/shows';

describe('VERIFIED_SHOWS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(VERIFIED_SHOWS)).toBe(true);
    expect(VERIFIED_SHOWS.length).toBeGreaterThan(0);
  });

  it('contains Arab Health in Dubai', () => {
    const show = VERIFIED_SHOWS.find(s => s.name === 'Arab Health');
    expect(show).toBeDefined();
    expect(show!.city).toBe('Dubai');
    expect(show!.country).toBe('UAE');
  });

  it('contains Gulfood in Dubai', () => {
    const show = VERIFIED_SHOWS.find(s => s.name === 'Gulfood');
    expect(show).toBeDefined();
    expect(show!.city).toBe('Dubai');
  });

  it('contains MEDICA in Düsseldorf', () => {
    const show = VERIFIED_SHOWS.find(s => s.name === 'MEDICA');
    expect(show).toBeDefined();
    expect(show!.city).toBe('Düsseldorf');
    expect(show!.country).toBe('Germany');
  });

  it('contains Hannover Messe in Germany', () => {
    const show = VERIFIED_SHOWS.find(s => s.name === 'Hannover Messe');
    expect(show).toBeDefined();
    expect(show!.country).toBe('Germany');
  });

  it('every show has required fields: name, city, country', () => {
    for (const show of VERIFIED_SHOWS) {
      expect(show.name).toBeTruthy();
      expect(show.city).toBeTruthy();
      expect(show.country).toBeTruthy();
    }
  });
});

describe('validateShow', () => {
  describe('exact match (case-insensitive)', () => {
    it('returns valid: true and HIGH confidence for exact show name', () => {
      const result = validateShow('Arab Health');
      expect(result.valid).toBe(true);
      expect(result.confidence).toBe('HIGH');
      expect(result.match).not.toBeNull();
      expect(result.match!.name).toBe('Arab Health');
    });

    it('is case-insensitive for exact match', () => {
      const result = validateShow('arab health');
      expect(result.valid).toBe(true);
      expect(result.confidence).toBe('HIGH');
    });

    it('works for MEDICA exact match', () => {
      const result = validateShow('MEDICA');
      expect(result.valid).toBe(true);
      expect(result.confidence).toBe('HIGH');
    });
  });

  describe('fuzzy match', () => {
    it('returns valid: true and MEDIUM confidence for partial show name', () => {
      // "Intersolar" is a partial match for "Intersolar Europe"
      const result = validateShow('Intersolar');
      expect(result.valid).toBe(true);
      expect(result.confidence).toBe('MEDIUM');
    });

    it('matches when show name is a substring of the query', () => {
      // "MEDICA 2025" contains "MEDICA" (a verified show)
      const result = validateShow('MEDICA 2025');
      expect(result.valid).toBe(true);
      expect(result.confidence).toBe('MEDIUM');
    });
  });

  describe('no match', () => {
    it('returns valid: false and LOW confidence for unknown show', () => {
      const result = validateShow('UnknownExpo2099');
      expect(result.valid).toBe(false);
      expect(result.confidence).toBe('LOW');
      expect(result.match).toBeNull();
    });

    it('returns valid: true with MEDIUM confidence for empty string (fuzzy match edge case)', () => {
      // Current behavior: empty string matches everything via includes('') —
      // every show name includes an empty string, so fuzzy match returns MEDIUM.
      // This test documents (not endorses) the current behavior.
      const result = validateShow('');
      expect(result.valid).toBe(true);
      expect(result.confidence).toBe('MEDIUM');
    });
  });
});
