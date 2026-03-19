/**
 * Unit tests for src/config/standme-knowledge.ts
 * Verifies the static company knowledge data structure.
 */
import { COMPANY } from '../config/standme-knowledge';

describe('COMPANY', () => {
  it('has correct domain', () => {
    expect(COMPANY.domain).toBe('standme.de');
  });

  it('has correct main email', () => {
    expect(COMPANY.emails.main).toBe('info@standme.de');
  });

  it('has Mo\'s email', () => {
    expect(COMPANY.emails.mo).toBe('mohammed.anabi@standme.de');
  });

  it('covers MENA and Europe regions', () => {
    expect(COMPANY.regions).toContain('MENA');
    expect(COMPANY.regions).toContain('Europe');
  });

  it('is based in Germany', () => {
    expect(COMPANY.baseCountry).toBe('Germany');
  });

  it('has Mo as Owner/Admin', () => {
    expect(COMPANY.team.Mo).toBeDefined();
    expect(COMPANY.team.Mo.role).toBe('Owner / Admin');
    expect(COMPANY.team.Mo.fullName).toBe('Mohammed Anabi');
  });

  it('has Hadeer as Operations Lead', () => {
    expect(COMPANY.team.Hadeer).toBeDefined();
    expect(COMPANY.team.Hadeer.role).toBe('Operations Lead');
  });

  it('has Bassel as Sub-Admin', () => {
    expect(COMPANY.team.Bassel).toBeDefined();
    expect(COMPANY.team.Bassel.role).toBe('Sub-Admin');
  });

  it('has a non-empty services array', () => {
    expect(Array.isArray(COMPANY.services)).toBe(true);
    expect(COMPANY.services.length).toBeGreaterThan(0);
  });

  it('has a non-empty differentiation array', () => {
    expect(Array.isArray(COMPANY.differentiation)).toBe(true);
    expect(COMPANY.differentiation.length).toBeGreaterThan(0);
  });
});
