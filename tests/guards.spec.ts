import { afterEach, describe, expect, it } from 'vitest';
import { clientIp, createRateLimiter, createTtlCache, envNumber } from '../lib/guards';

describe('createRateLimiter', () => {
  it('allows `limit` hits per window, then limits with a retry time', () => {
    const limiter = createRateLimiter(3, 60_000);
    for (let index = 0; index < 3; index += 1) expect(limiter.hit('a', 1_000 + index).limited).toBe(false);
    const blocked = limiter.hit('a', 1_003);
    expect(blocked.limited).toBe(true);
    expect(blocked.retryAfterSeconds).toBe(60);
    expect(limiter.hit('b', 1_004).limited).toBe(false);
  });
  it('frees the client once the window has passed', () => {
    const limiter = createRateLimiter(1, 1_000);
    limiter.hit('a', 0);
    expect(limiter.hit('a', 500).limited).toBe(true);
    expect(limiter.hit('a', 1_600).limited).toBe(false);
  });
  it('forgets idle clients when too many are tracked', () => {
    const limiter = createRateLimiter(1, 1_000, 2);
    limiter.hit('a', 0); limiter.hit('b', 0); limiter.hit('c', 5_000);
    expect(limiter.hit('a', 5_001).limited).toBe(false);
  });
});

describe('createTtlCache', () => {
  it('returns a value until it expires', () => {
    const cache = createTtlCache<string>(1_000);
    cache.set('k', 'v', 0);
    expect(cache.get('k', 999)).toBe('v');
    expect(cache.get('k', 1_000)).toBeUndefined();
    expect(cache.size).toBe(0);
  });
  it('drops the oldest entry past the maximum', () => {
    const cache = createTtlCache<number>(10_000, 2);
    cache.set('a', 1, 0); cache.set('b', 2, 0); cache.set('c', 3, 0);
    expect(cache.get('a', 1)).toBeUndefined();
    expect(cache.get('c', 1)).toBe(3);
  });
  it('stores nothing when the TTL is 0', () => {
    const cache = createTtlCache<number>(0);
    cache.set('a', 1);
    expect(cache.get('a')).toBeUndefined();
  });
});

describe('clientIp', () => {
  it('uses the first forwarded address, then x-real-ip, else null', () => {
    expect(clientIp(new Request('http://x', { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } }))).toBe('203.0.113.7');
    expect(clientIp(new Request('http://x', { headers: { 'x-real-ip': '198.51.100.2' } }))).toBe('198.51.100.2');
    expect(clientIp(new Request('http://x'))).toBeNull();
  });
});

describe('envNumber', () => {
  afterEach(() => { delete process.env.GUARD_TEST; });
  it('reads positive numbers and falls back on anything else', () => {
    expect(envNumber('GUARD_TEST', 6)).toBe(6);
    process.env.GUARD_TEST = '12';
    expect(envNumber('GUARD_TEST', 6)).toBe(12);
    for (const bad of ['', 'abc', '-3', '0']) { process.env.GUARD_TEST = bad; expect(envNumber('GUARD_TEST', 6)).toBe(6); }
    process.env.GUARD_TEST = '0';
    expect(envNumber('GUARD_TEST', 600, true)).toBe(0);
  });
});
