import { logger } from './logger';

/** True when the error is a Google Sheets / Google API rate-limit or quota error */
function isQuotaError(err: any): boolean {
  const msg: string = (err?.message || err?.toString() || '').toLowerCase();
  return (
    msg.includes('quota exceeded') ||
    msg.includes('rate limit')     ||
    msg.includes('too many requests') ||
    msg.includes('userrate')       ||
    err?.status === 429            ||
    err?.code   === 429
  );
}

export async function retry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 1,
  delayMs    = 3000,
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries) {
        // Quota / rate-limit: Google resets the window every 60 s.
        // Retrying after 3 s hits the same quota again — wait the full minute.
        const wait = isQuotaError(error)
          ? 65_000                           // 65 s — clears the 60-s quota window
          : delayMs * Math.pow(2, attempt);  // normal exponential back-off
        const waitSec = Math.round(wait / 1000);
        logger.warn(
          `${label} failed (attempt ${attempt + 1}/${maxRetries + 1}): ${error.message}. ` +
          `Retrying in ${waitSec}s...`,
        );
        await new Promise(resolve => setTimeout(resolve, wait));
      }
    }
  }

  logger.error(`${label} failed after ${maxRetries + 1} attempt(s): ${lastError?.message}`);
  throw lastError;
}
