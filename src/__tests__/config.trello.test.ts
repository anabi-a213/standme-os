/**
 * Unit tests for src/config/trello.ts
 * Verifies pipeline stages, board config, and read/write designations.
 */
import { TRELLO_CONFIG, PipelineStage } from '../config/trello';

describe('TRELLO_CONFIG.pipelineStages', () => {
  it('contains exactly 7 pipeline stages', () => {
    expect(TRELLO_CONFIG.pipelineStages.length).toBe(7);
  });

  it('starts with "01 — New Inquiry"', () => {
    expect(TRELLO_CONFIG.pipelineStages[0]).toBe('01 — New Inquiry');
  });

  it('ends with "07 — Lost / Delayed"', () => {
    const stages = TRELLO_CONFIG.pipelineStages;
    expect(stages[stages.length - 1]).toBe('07 — Lost / Delayed');
  });

  it('includes "06 — Won" stage', () => {
    expect(TRELLO_CONFIG.pipelineStages).toContain('06 — Won');
  });

  it('includes "04 — Proposal Sent" stage', () => {
    expect(TRELLO_CONFIG.pipelineStages).toContain('04 — Proposal Sent');
  });

  it('includes "05 — In Negotiation" stage', () => {
    expect(TRELLO_CONFIG.pipelineStages).toContain('05 — In Negotiation');
  });

  it('all stage names are non-empty strings', () => {
    for (const stage of TRELLO_CONFIG.pipelineStages) {
      expect(typeof stage).toBe('string');
      expect(stage.length).toBeGreaterThan(0);
    }
  });
});

describe('TRELLO_CONFIG.boards', () => {
  it('has SALES_PIPELINE board key', () => {
    expect(TRELLO_CONFIG.boards.SALES_PIPELINE).toBeDefined();
    expect(TRELLO_CONFIG.boards.SALES_PIPELINE).toBe('TRELLO_BOARD_SALES_PIPELINE');
  });

  it('has SALES, DESIGN, OPERATION, PRODUCTION boards', () => {
    expect(TRELLO_CONFIG.boards.SALES).toBe('TRELLO_BOARD_SALES');
    expect(TRELLO_CONFIG.boards.DESIGN).toBe('TRELLO_BOARD_DESIGN');
    expect(TRELLO_CONFIG.boards.OPERATION).toBe('TRELLO_BOARD_OPERATION');
    expect(TRELLO_CONFIG.boards.PRODUCTION).toBe('TRELLO_BOARD_PRODUCTION');
  });
});

describe('TRELLO_CONFIG.writableBoards', () => {
  it('only contains SALES_PIPELINE', () => {
    expect(TRELLO_CONFIG.writableBoards).toHaveLength(1);
    expect(TRELLO_CONFIG.writableBoards[0]).toBe('TRELLO_BOARD_SALES_PIPELINE');
  });
});

describe('TRELLO_CONFIG.readOnlyBoards', () => {
  it('has 4 read-only boards', () => {
    expect(TRELLO_CONFIG.readOnlyBoards).toHaveLength(4);
  });

  it('contains SALES, DESIGN, OPERATION, PRODUCTION as read-only', () => {
    expect(TRELLO_CONFIG.readOnlyBoards).toContain('TRELLO_BOARD_SALES');
    expect(TRELLO_CONFIG.readOnlyBoards).toContain('TRELLO_BOARD_DESIGN');
    expect(TRELLO_CONFIG.readOnlyBoards).toContain('TRELLO_BOARD_OPERATION');
    expect(TRELLO_CONFIG.readOnlyBoards).toContain('TRELLO_BOARD_PRODUCTION');
  });

  it('does NOT contain SALES_PIPELINE in read-only list', () => {
    expect(TRELLO_CONFIG.readOnlyBoards).not.toContain('TRELLO_BOARD_SALES_PIPELINE');
  });
});

describe('Board separation invariant', () => {
  it('writable and read-only lists have no overlap', () => {
    const writable = new Set(TRELLO_CONFIG.writableBoards);
    const readOnly = new Set(TRELLO_CONFIG.readOnlyBoards);
    for (const board of writable) {
      expect(readOnly.has(board)).toBe(false);
    }
  });
});
