import { SHEETS } from '../config/sheets';
import { appendRow } from '../services/google/sheets';
import { logger } from './logger';

export type LogResult = 'SUCCESS' | 'FAIL';

export interface SystemLogEntry {
  agent: string;
  actionType: string;
  showName?: string;
  detail: string;
  result: LogResult;
  retry?: boolean;
  notes?: string;
}

export async function writeSystemLog(entry: SystemLogEntry): Promise<void> {
  const timestamp = new Date().toISOString();

  try {
    await appendRow(SHEETS.SYSTEM_LOG, [
      timestamp,
      entry.agent,
      entry.actionType,
      entry.showName || '',
      entry.detail,
      entry.result,
      entry.retry ? 'YES' : 'NO',
      entry.notes || '',
    ]);
  } catch (err: any) {
    // Never fail silently — but don't crash either
    logger.error(`Failed to write system log: ${err.message}`);
    logger.error(`Log entry was: ${JSON.stringify(entry)}`);
  }
}
