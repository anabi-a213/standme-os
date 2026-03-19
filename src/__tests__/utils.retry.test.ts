/**
 * Unit tests for src/utils/retry.ts
 *
 * Retry uses setTimeout for exponential backoff. We use jest fake timers
 * and carefully interleave timer advancement with promise resolution.
 */

jest.mock('../utils/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

import { retry } from '../utils/retry';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

/**
 * Helper: run all pending timers AND flush the microtask queue iteratively.
 * Necessary because retry() awaits a Promise inside the loop.
 */
async function drainTimersAndMicrotasks(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    jest.runAllTimers();
    await Promise.resolve();
    await Promise.resolve();
  }
}

describe('retry', () => {
  it('returns the result immediately on first success', async () => {
    const fn = jest.fn().mockResolvedValue('done');
    const result = await retry(fn, 'test-op', 0, 100);
    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('with maxRetries=0 does not retry on failure', async () => {
    const err = new Error('no retry');
    const fn = jest.fn().mockRejectedValue(err);
    const promise = retry(fn, 'no-retry-op', 0, 100);
    await drainTimersAndMicrotasks();
    await expect(promise).rejects.toThrow('no retry');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries once and succeeds on second attempt', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('recovered');

    const promise = retry(fn, 'test-retry', 1, 100);
    await drainTimersAndMicrotasks(20);
    await expect(promise).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting all retries (maxRetries=2, 3 total calls)', async () => {
    const err = new Error('permanent failure');
    const fn = jest.fn().mockRejectedValue(err);

    const promise = retry(fn, 'test-exhausted', 2, 100);
    await drainTimersAndMicrotasks(20);
    await expect(promise).rejects.toThrow('permanent failure');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('calls fn exactly maxRetries+1 times on repeated failure', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fails'));

    const promise = retry(fn, 'test-count', 3, 100);
    await drainTimersAndMicrotasks(30);
    await expect(promise).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('propagates the last error (not first) after retries', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('first error'))
      .mockRejectedValueOnce(new Error('last error'));

    const promise = retry(fn, 'multi-error', 1, 100);
    await drainTimersAndMicrotasks(20);
    await expect(promise).rejects.toThrow('last error');
  });
});
