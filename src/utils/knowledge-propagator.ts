import { readSheet, updateCell } from '../services/google/sheets';
import { updateKnowledge } from '../services/knowledge';
import { sendToMo, formatType2 } from '../services/telegram/bot';
import { SHEETS } from '../config/sheets';
import { DataField, canOverwrite, encodeField, displayValue } from './confidence';
import { logger } from './logger';

// Maps field name to LEAD_MASTER column letter
// Must match sheets.ts LEAD_MASTER column mapping
const FIELD_COLUMN_MAP: Record<string, string> = {
  companyName:        'C',
  contactName:        'D',
  contactEmail:       'E',
  showName:           'G',
  standSize:          'I',
  budget:             'J',
  industry:           'K',
  standType:          'AA',
  openSides:          'AB',
  mainGoal:           'AC',
  staffCount:         'AD',
  mustHaveElements:   'AE',
  brandColours:       'AF',
  previousExperience: 'AG',
  briefTier:          'AH',
  rendersGenerated:   'AI',
  rendersDriveUrl:    'AJ',
  lastDataUpdate:     'AK',
  dataConfidenceLog:  'AL',
};

// Convert column letter (single or multi-char) to 0-based index
function getColIndex(col: string): number {
  const upper = col.toUpperCase();
  let index = 0;
  for (let i = 0; i < upper.length; i++) {
    index = index * 26 + (upper.charCodeAt(i) - 64);
  }
  return index - 1;
}

export async function propagateLeadData(
  companyName: string,
  newData: Record<string, DataField>,
  sourceAgentId: string
): Promise<{ unlockedSteps: string[] }> {
  try {
    // Exact match only — never fuzzy. Prevents updating the wrong company.
    const allRows = await readSheet(SHEETS.LEAD_MASTER);
    const normalizedSearch = companyName.toLowerCase().trim();
    const rowIndex = allRows.findIndex((row, i) =>
      i > 0 && (row[2] || '').toLowerCase().trim() === normalizedSearch
    );

    if (rowIndex === -1) {
      logger.warn(`[KnowledgePropagator] No exact match for: "${companyName}"`);
      return { unlockedSteps: [] };
    }

    const leadRow = { row: rowIndex + 1, data: allRows[rowIndex] };
    const leadId = allRows[rowIndex][0] || ''; // col A = lead ID

    const updatedFields: string[] = [];

    for (const [fieldName, dataField] of Object.entries(newData)) {
      if (!dataField.value) continue;
      const colLetter = FIELD_COLUMN_MAP[fieldName];
      if (!colLetter) continue;

      const existingValue = leadRow.data[getColIndex(colLetter)] || '';

      if (!existingValue || canOverwrite(existingValue, dataField.confidence)) {
        const encoded = encodeField(dataField.value, dataField.confidence, sourceAgentId);
        await updateCell(SHEETS.LEAD_MASTER, leadRow.row, colLetter, encoded);
        updatedFields.push(fieldName);
      }
    }

    if (updatedFields.length > 0) {
      await updateCell(
        SHEETS.LEAD_MASTER,
        leadRow.row,
        FIELD_COLUMN_MAP.lastDataUpdate,
        new Date().toISOString()
      );

      const summary = updatedFields
        .map(f => `${f}: ${newData[f].value} (${newData[f].confidence})`)
        .join(', ');

      // Use lead ID as the KB source key for uniqueness — never company name alone
      await updateKnowledge(`lead-${leadId}`, {
        topic: companyName,
        tags: `lead,update,lead-${leadId},${companyName.toLowerCase().replace(/\s+/g, '-')}`,
        content: `Updated fields for ${companyName} (${leadId}): ${summary}. Source: ${sourceAgentId}.`,
      });

      // Re-read the row for step readiness check (exact index still valid)
      const freshRows = await readSheet(SHEETS.LEAD_MASTER);
      const freshData = freshRows[rowIndex] || leadRow.data;
      if (freshData) {
        const unlockedSteps = await checkAllStepReadiness(companyName, freshData);

        if (unlockedSteps.length > 0) {
          const stepMessages = unlockedSteps.map(s => stepMessage(s, companyName));
          await sendToMo(
            formatType2(
              `📈 ${companyName} — data updated`,
              `New info saved: ${summary}\n\n` +
              `Now ready for:\n${stepMessages.join('\n')}`
            )
          );
        }

        return { unlockedSteps };
      }
    }

    return { unlockedSteps: [] };
  } catch (err: any) {
    logger.error(`[KnowledgePropagator] Error for ${companyName}: ${err.message}`);
    return { unlockedSteps: [] };
  }
}

export async function checkAllStepReadiness(
  companyName: string,
  row: string[]
): Promise<string[]> {
  const get = (col: string) => displayValue(row[getColIndex(col)] || '');

  const companyNameVal = get('C');
  const showName       = get('G');
  const standSize      = get('I');
  const budget         = get('J');
  const standType      = get(FIELD_COLUMN_MAP.standType);
  const dmEmail        = get('V');
  const contactEmail   = get('E');

  const unlocked: string[] = [];

  if (showName && standSize && budget) {
    unlocked.push('canRunBrief');
  }

  if (showName && standSize && budget && standType) {
    unlocked.push('canRunRenders');
  }

  if ((dmEmail || contactEmail) && showName) {
    unlocked.push('canRunOutreach');
  }

  return unlocked;
}

function stepMessage(step: string, company: string): string {
  const messages: Record<string, string> = {
    canRunBrief:    `• /brief ${company} — concept brief ready`,
    canRunRenders:  `• /renders ${company} — AI renders ready`,
    canRunOutreach: `• /bulkoutreach — ${company} can be added to campaign`,
  };
  return messages[step] || step;
}
