const CACHE_PREFIX = 'standme_ws_';
const DEFAULT_TTL = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
  data: string;
  timestamp: number;
}

export function getCached(key: string, ttl = DEFAULT_TTL): string | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.timestamp > ttl) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export function setCache(key: string, data: string): void {
  try {
    const entry: CacheEntry = { data, timestamp: Date.now() };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch { /* quota exceeded — ignore */ }
}

export function getCacheAge(key: string): number | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    return Math.floor((Date.now() - entry.timestamp) / 1000);
  } catch {
    return null;
  }
}

export function clearCache(key: string): void {
  localStorage.removeItem(CACHE_PREFIX + key);
}

export function getCachedJSON<T>(key: string, ttl = DEFAULT_TTL): T | null {
  const raw = getCached(key, ttl);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function setCacheJSON(key: string, data: unknown): void {
  setCache(key, JSON.stringify(data));
}
