import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST, resetSearchGuards } from '../api/search-jobs';

const request = (payload: unknown) => new Request('http://x/api/search-jobs', { method: 'POST', body: JSON.stringify(payload) });
const base = { targetRoles: 'Supply Chain Manager', skills: 'SAP', location: 'Mumbai', workMode: 'Any', timeWindow: '1w', sources: ['indeed', 'naukri'] };
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

interface Sent { query: string; include_domains: string[]; start_date: string; end_date: string }

function mockFetch(results: unknown[], planner?: () => Response) {
  const sent: Sent[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).includes('nebius')) return planner ? planner() : new Response('', { status: 500 });
    sent.push(JSON.parse(String(init?.body)) as Sent);
    return new Response(JSON.stringify({ results }), { status: 200 });
  });
  return sent;
}

describe('POST /api/search-jobs', () => {
  beforeEach(() => { resetSearchGuards(); process.env.TAVILY_API_KEY = 'tv'; delete process.env.NEBIUS_API_KEY; });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.TAVILY_API_KEY; delete process.env.NEBIUS_API_KEY; });

  it('requires a valid time window: no missing value and no "all time"', async () => {
    mockFetch([]);
    for (const timeWindow of [undefined, '', 'all', 'infinite', '5w', '1m']) {
      expect((await POST(request({ ...base, timeWindow }))).status).toBe(400);
    }
  });

  it('requires at least one valid source', async () => {
    mockFetch([]);
    expect((await POST(request({ ...base, sources: [] }))).status).toBe(400);
    expect((await POST(request({ ...base, sources: ['not-a-real-site'] }))).status).toBe(400);
    expect((await POST(request({ ...base, sources: undefined }))).status).toBe(400);
  });

  it('searches only the ticked portals and passes the date window to Tavily', async () => {
    const sent = mockFetch([]);
    await POST(request(base));
    expect(sent.length).toBeGreaterThan(0);
    const domains = new Set(sent.flatMap((call) => call.include_domains));
    expect([...domains].sort()).toEqual(['indeed.com', 'naukri.com']);
    const start = new Date(sent[0].start_date).getTime();
    const end = new Date(sent[0].end_date).getTime();
    expect(Math.round((end - start) / 86_400_000)).toBe(7);
  });

  it('keeps only dated, in-window listings from the ticked portals', async () => {
    mockFetch([
      { title: 'Planner - Acme - Mumbai - Indeed.com', url: 'https://in.indeed.com/viewjob?jk=1', content: 'Mumbai, India', published_date: daysAgo(2) },
      { title: 'Buyer - Beta - Mumbai - Indeed.com', url: 'https://in.indeed.com/viewjob?jk=2', content: 'Mumbai, India', published_date: daysAgo(20) },
      { title: 'Analyst - Gamma - Mumbai | Naukri.com', url: 'https://www.naukri.com/job-listings-analyst-gamma-mumbai-123456', content: 'Mumbai. No date here' },
      { title: 'Manager - Delta - Mumbai | Naukri.com', url: 'https://www.naukri.com/job-listings-manager-delta-mumbai-234567', content: 'Mumbai. Posted 3 days ago' },
      { title: 'Lead - Eps - Mumbai | Naukri.com', url: 'https://www.naukri.com/job-listings-lead-eps-mumbai-345678', content: 'Mumbai. Posted 3 weeks ago' },
      { title: 'Eta hiring Planner in Mumbai | LinkedIn', url: 'https://www.linkedin.com/jobs/view/planner-at-eta-3812345678', content: 'Mumbai', published_date: daysAgo(1) },
    ]);
    const data = await (await POST(request(base))).json() as { results: { title: string }[]; excluded: Record<string, number> };
    expect(data.results.map((job) => job.title).sort()).toEqual(['Manager — Delta', 'Planner — Acme']);
    expect(data.excluded).toMatchObject({ otherSource: 1, undated: 1, tooOld: 2 });
  });

  it('applies the chosen window strictly (1 day)', async () => {
    mockFetch([
      { title: 'Planner - Acme - Mumbai | Naukri.com', url: 'https://www.naukri.com/job-listings-planner-acme-mumbai-111111', content: 'Mumbai. Posted 5 hours ago' },
      { title: 'Buyer - Beta - Mumbai | Naukri.com', url: 'https://www.naukri.com/job-listings-buyer-beta-mumbai-222222', content: 'Mumbai. Posted 2 days ago' },
    ]);
    const data = await (await POST(request({ ...base, timeWindow: '1d', sources: ['naukri'] }))).json() as { results: { title: string }[] };
    expect(data.results.map((job) => job.title)).toEqual(['Planner — Acme']);
  });

  it('uses Nemotron-planned queries when available and falls back otherwise', async () => {
    process.env.NEBIUS_API_KEY = 'nb';
    const planned = mockFetch([], () => new Response(JSON.stringify({ choices: [{ message: { content: '{"queries":["supply chain manager openings {location}","logistics head vacancy {location}","greenhouse supply chain {location}"]}' } }] }), { status: 200 }));
    const data = await (await POST(request(base))).json() as { planner: string };
    expect(data.planner).toBe('nemotron');
    expect(planned.map((call) => call.query)).toContain('logistics head vacancy "Mumbai"');
    expect(planned.every((call) => !call.query.includes('{location}'))).toBe(true);
    vi.restoreAllMocks();
    resetSearchGuards(); // the same request again must reach the (now failing) planner, not the cache
    mockFetch([], () => new Response('down', { status: 503 }));
    expect(((await (await POST(request(base))).json()) as { planner: string }).planner).toBe('rules');
  });

  it('bounds the number of Tavily calls', async () => {
    const sent = mockFetch([]);
    await POST(request({ ...base, sources: ['linkedin', 'indeed', 'glassdoor', 'naukri', 'ats'] }));
    expect(sent.length).toBeLessThanOrEqual(5);
  });

  it('answers an identical search from the cache without calling the provider again', async () => {
    const sent = mockFetch([]);
    const first = await POST(request(base));
    const calls = sent.length;
    expect(calls).toBeGreaterThan(0);
    const second = await POST(request(base));
    expect(sent.length).toBe(calls);
    expect(second.headers.get('X-Cache')).toBe('HIT');
    expect(((await second.json()) as { cached?: boolean }).cached).toBe(true);
    expect(first.headers.get('X-Cache')).toBeNull();
    // A different profile is a different search.
    await POST(request({ ...base, targetRoles: 'Procurement Manager' }));
    expect(sent.length).toBeGreaterThan(calls);
  });

  it('limits searches per client and tells them when to retry', async () => {
    mockFetch([]);
    const from = (ip: string, roles: string) => new Request('http://x/api/search-jobs', {
      method: 'POST',
      headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` },
      body: JSON.stringify({ ...base, targetRoles: roles }),
    });
    for (let index = 0; index < 6; index += 1) expect((await POST(from('203.0.113.7', `Role ${index}`))).status).toBe(200);
    const limited = await POST(from('203.0.113.7', 'Role 7'));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(((await limited.json()) as { error: string }).error).toMatch(/Too many searches/);
    // Another client is not affected, and a cached repeat does not count.
    expect((await POST(from('198.51.100.9', 'Role 0'))).status).toBe(200);
    expect((await POST(from('203.0.113.7', 'Role 0'))).status).toBe(200);
  });

  it('reports failed provider searches and does not cache an incomplete search', async () => {
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('nebius')) return new Response('', { status: 500 });
      calls += 1;
      return calls === 1 ? new Response('boom', { status: 500 }) : new Response(JSON.stringify({ results: [] }), { status: 200 });
    });
    const data = await (await POST(request({ ...base, sources: ['linkedin', 'indeed', 'glassdoor', 'naukri', 'ats'] }))).json() as { queriesRun: number; queriesFailed: number };
    expect(data.queriesFailed).toBe(1);
    expect(data.queriesRun).toBeGreaterThan(0);
    const before = calls;
    await POST(request({ ...base, sources: ['linkedin', 'indeed', 'glassdoor', 'naukri', 'ats'] }));
    expect(calls).toBeGreaterThan(before);
  });

  it('turns a provider 429 into a "try again" answer', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => (String(input).includes('nebius')
      ? new Response('', { status: 500 })
      : new Response('slow down', { status: 429 })));
    const response = await POST(request(base));
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(((await response.json()) as { error: string }).error).toMatch(/busy/);
  });
});
