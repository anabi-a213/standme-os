/**
 * Unit tests for src/config/sheets.ts
 * Verifies sheet configs, column maps, and structure consistency.
 */
import { SHEETS, SheetConfig } from '../config/sheets';

describe('SHEETS config', () => {
  it('is an object with at least 10 sheet configs', () => {
    const keys = Object.keys(SHEETS);
    expect(keys.length).toBeGreaterThanOrEqual(10);
  });

  it('every sheet config has envKey, tabName, columns (object), and headerRow', () => {
    for (const [key, sheet] of Object.entries(SHEETS)) {
      expect(typeof sheet.envKey).toBe('string');
      expect(sheet.envKey.length).toBeGreaterThan(0);
      expect(typeof sheet.tabName).toBe('string');
      expect(sheet.tabName.length).toBeGreaterThan(0);
      expect(typeof sheet.columns).toBe('object');
      expect(typeof sheet.headerRow).toBe('number');
    }
  });

  it('all column values are single uppercase letters (A-Z)', () => {
    for (const [sheetKey, sheet] of Object.entries(SHEETS)) {
      for (const [colName, colLetter] of Object.entries(sheet.columns)) {
        expect(colLetter).toMatch(/^[A-Z]$/);
      }
    }
  });

  it('LEAD_MASTER sheet has expected columns', () => {
    const sheet = SHEETS.LEAD_MASTER;
    expect(sheet).toBeDefined();
    expect(sheet.columns.id).toBe('A');
    expect(sheet.columns.companyName).toBe('C');
    expect(sheet.columns.contactEmail).toBe('E');
    expect(sheet.columns.showName).toBe('G');
    expect(sheet.columns.budget).toBe('J');
    expect(sheet.columns.score).toBe('M');
    expect(sheet.columns.trelloCardId).toBe('Q');
  });

  it('SYSTEM_LOG sheet exists with correct columns', () => {
    const sheet = SHEETS.SYSTEM_LOG;
    expect(sheet).toBeDefined();
    expect(sheet.columns.timestamp).toBe('A');
    expect(sheet.columns.agent).toBe('B');
    expect(sheet.columns.actionType).toBe('C');
    expect(sheet.columns.result).toBe('F');
  });

  it('KNOWLEDGE_BASE sheet exists with content column', () => {
    const sheet = SHEETS.KNOWLEDGE_BASE;
    expect(sheet).toBeDefined();
    expect(sheet.columns.content).toBeDefined();
    expect(sheet.columns.topic).toBeDefined();
    expect(sheet.columns.tags).toBeDefined();
  });

  it('CONTRACTOR_DB sheet exists', () => {
    const sheet = SHEETS.CONTRACTOR_DB;
    expect(sheet).toBeDefined();
    expect(sheet.columns.name).toBeDefined();
    expect(sheet.columns.specialty).toBeDefined();
    expect(sheet.columns.region).toBeDefined();
  });

  it('OUTREACH_QUEUE sheet exists', () => {
    const sheet = SHEETS.OUTREACH_QUEUE;
    expect(sheet).toBeDefined();
    expect(sheet.columns.dmEmail).toBeDefined();
    expect(sheet.columns.showName).toBeDefined();
  });

  it('headerRow is 1 for all sheets (first row is always headers)', () => {
    for (const [key, sheet] of Object.entries(SHEETS)) {
      expect(sheet.headerRow).toBe(1);
    }
  });
});
