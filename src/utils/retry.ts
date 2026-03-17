import { logger } from './logger';

export async function retry<T>(fn: () => Promise<T>, label: string, maxRetries = 1, delayMs = 3000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    logger.warn(`${label} failed: ${error.message}. Retrying in ${delayMs / 1000}s...`);

    await new Promise(resolve => setTimeout(resolve, delayMs));

    try {
      return await fn();
    } catch (retryError: any) {
      logger.error(`${label} failed after retry: ${retryError.message}`);
      throw retryError;
    }
  }
}
