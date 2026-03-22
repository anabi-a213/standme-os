/**
 * Data Validator
 *
 * Validates lead row data completeness before each pipeline step.
 * Returns structured results with missing required fields and non-blocking warnings.
 *
 * Column references are based on LEAD_MASTER sheet layout in src/config/sheets.ts.
 */

export interface ValidationResult {
  valid: boolean;
  missing: string[];   // required fields absent — block the step
  warnings: string[];  // nice-to-have fields absent — proceed but flag
}

/** Lead row index helpers (0-based, matching LEAD_MASTER columns A→Z) */
const COL = {
  LEAD_ID:       0,   // A
  TIMESTAMP:     1,   // B
  COMPANY:       2,   // C
  CONTACT_NAME:  3,   // D
  EMAIL:         4,   // E
  PHONE:         5,   // F
  SHOW:          6,   // G
  CITY:          7,   // H
  STAND_SIZE:    8,   // I
  BUDGET:        9,   // J
  INDUSTRY:      10,  // K
  SOURCE:        11,  // L
  SCORE:         12,  // M
  TRELLO_ID:     16,  // Q
  ENRICH_STATUS: 17,  // R
  DM_NAME:       18,  // S
  DM_TITLE:      19,  // T
  DM_EMAIL:      21,  // V
  READINESS:     22,  // W
};

function val(row: string[], idx: number): string {
  return (row[idx] || '').trim();
}

/** Minimum data needed to start enrichment */
export function validateForEnrichment(row: string[]): ValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!val(row, COL.COMPANY))  missing.push('company name (col C)');
  if (!val(row, COL.EMAIL))    warnings.push('contact email (col E)');
  if (!val(row, COL.INDUSTRY)) warnings.push('industry (col K)');

  return { valid: missing.length === 0, missing, warnings };
}

/** All four required fields to generate a concept brief */
export function validateForBrief(row: string[]): ValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!val(row, COL.COMPANY))    missing.push('company name (col C)');
  if (!val(row, COL.SHOW))       missing.push('show name (col G)');
  if (!val(row, COL.STAND_SIZE)) missing.push('stand size in sqm (col I)');
  if (!val(row, COL.BUDGET))     missing.push('budget range (col J)');
  if (!val(row, COL.INDUSTRY))   warnings.push('industry (col K)');

  return { valid: missing.length === 0, missing, warnings };
}

/** Required fields before adding a lead to the outreach queue */
export function validateForOutreach(row: string[]): ValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!val(row, COL.COMPANY)) missing.push('company name (col C)');
  if (!val(row, COL.EMAIL))   missing.push('contact email (col E)');
  if (!val(row, COL.SHOW))    warnings.push('show name (col G)');

  const readiness = parseInt(val(row, COL.READINESS) || '0');
  if (readiness < 5) warnings.push(`low outreach readiness score (${readiness}/10)`);

  return { valid: missing.length === 0, missing, warnings };
}

/** Required fields for deal analysis */
export function validateForDealAnalysis(row: string[]): ValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!val(row, COL.COMPANY))  missing.push('company name (col C)');
  if (!val(row, COL.SHOW))     warnings.push('show name (col G)');
  if (!val(row, COL.BUDGET))   warnings.push('budget (col J)');
  if (!val(row, COL.INDUSTRY)) warnings.push('industry (col K)');

  return { valid: missing.length === 0, missing, warnings };
}

/**
 * Build a human-readable error message from a failed validation.
 * Returns empty string if the result is valid.
 */
export function formatValidationError(result: ValidationResult, stepName: string): string {
  if (result.valid && result.warnings.length === 0) return '';

  const parts: string[] = [];

  if (!result.valid) {
    parts.push(`Cannot ${stepName} — missing required fields: ${result.missing.join(', ')}.`);
  }

  if (result.warnings.length > 0) {
    parts.push(`Warnings: ${result.warnings.join(', ')}.`);
  }

  return parts.join(' ');
}
