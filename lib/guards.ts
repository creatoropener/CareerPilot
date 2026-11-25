// Small, dependency-free guards for the serverless functions: a per-client rate limiter and a short-lived cache.
// Both live in memory. A serverless instance does not share memory with other instances, so these are a best-effort
// first line of defence; add a Vercel Firewall rate-limit rule on the path for a hard limit.

/** The caller's IP address, or null when the platform did not provide one (for example, local development). */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || request.headers.get('x-real-ip')?.trim();
  return ip ? ip.slice(0, 64) : null;
}

export interface RateLimitResult {
  limited: boolean;
  /** Whole seconds until the oldest counted request leaves the window; 0 when not limited. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  hit(key: string, now?: number): RateLimitResult;
  reset(): void;
}

/** Sliding-window limiter: at most `limit` hits per `windowMs` for each key. */
export function createRateLimiter(limit: number, windowMs: number, maxKeys = 500): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    hit(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > maxKeys) {
        for (const [other, times] of hits) if (times.every((time) => now - time >= windowMs)) hits.delete(other);
      }
      if (recent.length <= limit) return { limited: false, retryAfterSeconds: 0 };
      return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
    },
    reset() { hits.clear(); },
  };
}

export interface TtlCache<T> {
  get(key: string, now?: number): T | undefined;
  set(key: string, value: T, now?: number): void;
  clear(): void;
  readonly size: number;
}

/** Cache with an expiry time and a maximum size; the oldest entry is dropped first. A TTL of 0 turns it off. */
export function createTtlCache<T>(ttlMs: number, maxEntries = 50): TtlCache<T> {
  const entries = new Map<string, { value: T; expires: number }>();
  return {
    get(key, now = Date.now()) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expires <= now) { entries.delete(key); return undefined; }
      return entry.value;
    },
    set(key, value, now = Date.now()) {
      if (ttlMs <= 0) return;
      entries.delete(key);
      entries.set(key, { value, expires: now + ttlMs });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    clear() { entries.clear(); },
    get size() { return entries.size; },
  };
}

/** A positive whole number from an environment variable, or the fallback. 0 is allowed when `allowZero` is set. */
export function envNumber(name: string, fallback: number, allowZero = false): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return value > 0 || (allowZero && value === 0) ? Math.floor(value) : fallback;
}
