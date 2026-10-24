import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../api/search-jobs';

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
  beforeEach(() => { process.env.TAVILY_API_KEY = 'tv'; delete process.env.NEBIUS_API_KEY; });
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
    expect((await POST(request({ ...base, sources: ['monster'] }))).status).toBe(400);
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
      { title: 'fresh', url: 'https://in.indeed.com/viewjob?jk=1', content: 'x', published_date: daysAgo(2) },
      { title: 'old', url: 'https://in.indeed.com/viewjob?jk=2', content: 'x', published_date: daysAgo(20) },
      { title: 'undated', url: 'https://www.naukri.com/job-3', content: 'No date here' },
      { title: 'text-dated', url: 'https://www.naukri.com/job-4', content: 'Posted 3 days ago' },
      { title: 'text-old', url: 'https://www.naukri.com/job-5', content: 'Posted 3 weeks ago' },
      { title: 'other portal', url: 'https://www.linkedin.com/jobs/view/6', content: 'x', published_date: daysAgo(1) },
    ]);
    const data = await (await POST(request(base))).json() as { results: { title: string }[]; excluded: Record<string, number> };
    expect(data.results.map((job) => job.title).sort()).toEqual(['fresh', 'text-dated']);
    expect(data.excluded).toMatchObject({ otherSource: 1, undated: 1, tooOld: 2 });
  });

  it('applies the chosen window strictly (1 day)', async () => {
    mockFetch([
      { title: 'today', url: 'https://www.naukri.com/a', content: 'Posted 5 hours ago' },
      { title: 'two days', url: 'https://www.naukri.com/b', content: 'Posted 2 days ago' },
    ]);
    const data = await (await POST(request({ ...base, timeWindow: '1d', sources: ['naukri'] }))).json() as { results: { title: string }[] };
    expect(data.results.map((job) => job.title)).toEqual(['today']);
  });

  it('uses Nemotron-planned queries when available and falls back otherwise', async () => {
    process.env.NEBIUS_API_KEY = 'nb';
    const planned = mockFetch([], () => new Response(JSON.stringify({ choices: [{ message: { content: '{"queries":["supply chain manager openings Mumbai","logistics head vacancy Mumbai","greenhouse supply chain Mumbai"]}' } }] }), { status: 200 }));
    const data = await (await POST(request(base))).json() as { planner: string };
    expect(data.planner).toBe('nemotron');
    expect(planned.map((call) => call.query)).toContain('logistics head vacancy Mumbai');
    vi.restoreAllMocks();
    mockFetch([], () => new Response('down', { status: 503 }));
    expect(((await (await POST(request(base))).json()) as { planner: string }).planner).toBe('rules');
  });

  it('bounds the number of Tavily calls', async () => {
    const sent = mockFetch([]);
    await POST(request({ ...base, sources: ['linkedin', 'indeed', 'glassdoor', 'naukri', 'ats'] }));
    expect(sent.length).toBeLessThanOrEqual(5);
  });
});
