import { logger } from './logger';

export async function retry<T>(fn: () => Promise<T>, label: string, maxRetries = 1, delayMs = 3000): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries) {
        const wait = delayMs * Math.pow(2, attempt); // exponential backoff per retry
        logger.warn(`${label} failed (attempt ${attempt + 1}/${maxRetries + 1}): ${error.message}. Retrying in ${wait / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, wait));
      }
    }
  }

  logger.error(`${label} failed after ${maxRetries + 1} attempt(s): ${lastError?.message}`);
  throw lastError;
}
