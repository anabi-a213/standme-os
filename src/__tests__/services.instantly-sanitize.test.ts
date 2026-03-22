/**
 * Unit tests for Instantly.ai lead sanitization.
 *
 * sanitizeLead() is the most critical data-quality function in the outreach flow.
 * A bug here means bad leads reach Instantly, causing "Email is required" errors
 * or corrupted personalization fields.
 */

jest.mock('../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

// Import the sanitize function directly from the compiled module.
// We import the entire module so we can also validate the InstantlyLead type.
import { sanitizeLead } from '../services/instantly/client';

describe('sanitizeLead', () => {
  it('returns null for a lead with no email', () => {
    expect(sanitizeLead({ email: '' })).toBeNull();
  });

  it('returns null when email is undefined-like', () => {
    expect(sanitizeLead({ email: '   ' })).toBeNull();
  });

  it('returns null for malformed email (no @)', () => {
    expect(sanitizeLead({ email: 'notanemail' })).toBeNull();
  });

  it('returns null for email with no domain dot', () => {
    expect(sanitizeLead({ email: 'user@nodot' })).toBeNull();
  });

  it('accepts and normalises a valid email', () => {
    const result = sanitizeLead({ email: '  Hans.Mueller@Pharma-Corp.DE  ' });
    expect(result).not.toBeNull();
    expect(result!.email).toBe('hans.mueller@pharma-corp.de');
  });

  it('strips BOM characters from email', () => {
    const result = sanitizeLead({ email: '\uFEFFtest@example.com' });
    expect(result).not.toBeNull();
    expect(result!.email).toBe('test@example.com');
  });

  it('strips zero-width spaces from email', () => {
    const result = sanitizeLead({ email: 'test\u200B@example.com' });
    expect(result).not.toBeNull();
    expect(result!.email).toBe('test@example.com');
  });

  it('uses "Team" as first_name fallback when first_name is empty', () => {
    const result = sanitizeLead({ email: 'test@example.com', first_name: '' });
    expect(result).not.toBeNull();
    expect(result!.first_name).toBe('Team');
  });

  it('uses "Team" as first_name fallback when first_name is only numbers', () => {
    const result = sanitizeLead({ email: 'test@example.com', first_name: '12345' });
    expect(result).not.toBeNull();
    expect(result!.first_name).toBe('Team');
  });

  it('preserves valid first_name', () => {
    const result = sanitizeLead({ email: 'test@example.com', first_name: 'Hans' });
    expect(result!.first_name).toBe('Hans');
  });

  it('truncates company_name at 200 chars', () => {
    const longName = 'A'.repeat(250);
    const result = sanitizeLead({ email: 'test@example.com', company_name: longName });
    expect(result!.company_name!.length).toBe(200);
  });

  it('truncates personalization at 500 chars', () => {
    const longPerso = 'B'.repeat(600);
    const result = sanitizeLead({ email: 'test@example.com', personalization: longPerso });
    expect(result!.personalization!.length).toBe(500);
  });

  it('normalises a website by adding https://', () => {
    const result = sanitizeLead({ email: 'test@example.com', website: 'example.com' });
    expect(result!.website).toBe('https://example.com');
  });

  it('returns empty website for clearly invalid URLs', () => {
    const result = sanitizeLead({ email: 'test@example.com', website: 'not a url !!' });
    expect(result!.website).toBe('');
  });

  it('cleans custom_variables keys and values', () => {
    const result = sanitizeLead({
      email: 'test@example.com',
      custom_variables: {
        'title\u200B': '  Marketing Director  ',
        'show': 'Intersolar\x00Munich',
      },
    });
    expect(result).not.toBeNull();
    expect(result!.custom_variables!['title']).toBe('Marketing Director');
    expect(result!.custom_variables!['show']).toBe('IntersolarMunich');
  });

  it('accepts email with angle brackets and strips them', () => {
    // Some sheets export emails as <user@example.com>
    const result = sanitizeLead({ email: '<user@example.com>' });
    // Should produce a valid email without angle brackets
    expect(result).not.toBeNull();
    expect(result!.email).toBe('user@example.com');
  });

  it('handles null values gracefully — does not throw', () => {
    expect(() =>
      sanitizeLead({ email: 'test@example.com', first_name: null as any, company_name: null as any })
    ).not.toThrow();
  });

  it('returns a complete sanitized lead for a realistic input', () => {
    const input = {
      email: '  Mohammed.Al-Rashid@pharma-corp.com  ',
      first_name: 'Mohammed',
      last_name: 'Al-Rashid',
      company_name: 'PharmaGroup International',
      personalization: 'Great opportunity for your stand at Arab Health',
      website: 'pharma-corp.com',
      phone: '+971 50 123 4567',
      custom_variables: { title: 'Marketing Director', show: 'Arab Health' },
    };

    const result = sanitizeLead(input);
    expect(result).not.toBeNull();
    expect(result!.email).toBe('mohammed.al-rashid@pharma-corp.com');
    expect(result!.first_name).toBe('Mohammed');
    expect(result!.last_name).toBe('Al-Rashid');
    expect(result!.company_name).toBe('PharmaGroup International');
    expect(result!.website).toBe('https://pharma-corp.com');
  });
});
