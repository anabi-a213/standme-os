/**
 * Unit tests for message formatter functions in src/services/telegram/bot.ts
 * These are pure string functions — no bot instance needed.
 *
 * We import the module directly; getBot() and initBot() won't be called
 * because we only exercise the exported formatter functions.
 */

// Mock the AI client so detectLanguage isn't called at import time
jest.mock('../services/ai/client', () => ({
  detectLanguage: jest.fn().mockResolvedValue('en'),
}));

// Mock the access config (getUserRole calls process.env)
// We don't need full mocking — just prevent side effects if any

import { formatType1, formatType2, formatType3 } from '../services/telegram/bot';

describe('formatType1 (ACTION NEEDED)', () => {
  it('includes the ACTION NEEDED header', () => {
    const msg = formatType1('Send email', 'Follow up needed', 'Email draft ready', 'appr-001');
    expect(msg).toContain('ACTION NEEDED');
  });

  it('includes What, Why, and the detail', () => {
    const msg = formatType1('Create card', 'New lead', 'Lead details here', 'appr-002');
    expect(msg).toContain('What:');
    expect(msg).toContain('Why:');
    expect(msg).toContain('Lead details here');
  });

  it('includes approve and reject command links', () => {
    const msg = formatType1('Do thing', 'Because', 'Detail', 'test-id');
    expect(msg).toContain('approve');
    expect(msg).toContain('reject');
    expect(msg).toContain('test-id');
  });

  it('escapes markdown special characters in user content', () => {
    // * _ ` [ ] are markdown chars — they should be escaped
    const msg = formatType1('Bold *text*', 'Why_reason', 'Detail `code`', 'id1');
    // Escaped chars should appear with backslash
    expect(msg).toContain('\\*');
    expect(msg).toContain('\\_');
    expect(msg).toContain('\\`');
  });
});

describe('formatType2 (HEADS UP)', () => {
  it('includes the HEADS UP header', () => {
    const msg = formatType2('Deadline Alert', 'Portal closes tomorrow');
    expect(msg).toContain('HEADS UP');
  });

  it('includes the topic and detail', () => {
    const msg = formatType2('Critical Issue', 'Server is down');
    expect(msg).toContain('Critical Issue');
    expect(msg).toContain('Server is down');
  });

  it('escapes markdown in topic and detail', () => {
    const msg = formatType2('Topic_with_underscores', 'Detail *bold*');
    expect(msg).toContain('\\_');
    expect(msg).toContain('\\*');
  });
});

describe('formatType3 (SUMMARY)', () => {
  it('includes the title', () => {
    const msg = formatType3('Pipeline Summary', []);
    expect(msg).toContain('Pipeline Summary');
  });

  it('includes all section labels and content', () => {
    const msg = formatType3('Report', [
      { label: 'Open Leads', content: '5 leads pending' },
      { label: 'Won This Week', content: '2 deals closed' },
    ]);
    expect(msg).toContain('Open Leads');
    expect(msg).toContain('5 leads pending');
    expect(msg).toContain('Won This Week');
    expect(msg).toContain('2 deals closed');
  });

  it('returns a non-empty string even with empty sections', () => {
    const msg = formatType3('Empty Report', []);
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).toContain('Empty Report');
  });

  it('handles multiple sections in order', () => {
    const sections = [
      { label: 'Section A', content: 'Content A' },
      { label: 'Section B', content: 'Content B' },
    ];
    const msg = formatType3('Multi', sections);
    const posA = msg.indexOf('Section A');
    const posB = msg.indexOf('Section B');
    expect(posA).toBeLessThan(posB);
  });
});
