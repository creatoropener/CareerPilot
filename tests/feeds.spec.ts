import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST, resetSearchGuards } from '../api/search-jobs';

const request = (payload: unknown) => new Request('http://x/api/search-jobs', { method: 'POST', body: JSON.stringify(payload) });
const base = { targetRoles: 'Supply Chain Manager', skills: 'SAP', location: 'Mumbai', workMode: 'Any', timeWindow: '1w', sources: ['indeed'] };
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

interface Mock { calls: string[]; tavily: number }

/**
 * Answers Tavily, Greenhouse and Lever from fixtures. `boards` maps a URL fragment to a response, for example
 * "boards-api.greenhouse.io/v1/boards/acme/jobs?" -> a Response. Any other host is an error: the search function
 * must never contact anything else.
 */
function mockFetch(options: { tavily?: unknown[] | 'fail'; boards?: Record<string, () => Response> }): Mock {
  const mock: Mock = { calls: [], tavily: 0 };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    mock.calls.push(url);
    if (url.includes('nebius')) return new Response('', { status: 500 });
    if (url.includes('api.tavily.com')) {
      mock.tavily += 1;
      if (options.tavily === 'fail') return new Response('down', { status: 500 });
      return new Response(JSON.stringify({ results: options.tavily ?? [] }), { status: 200 });
    }
    for (const [fragment, make] of Object.entries(options.boards ?? {})) if (url.includes(fragment)) return make();
    throw new Error(`unexpected request to ${url}`);
  });
  return mock;
}

const json = (value: unknown) => () => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });

const greenhouse = (extra: unknown[] = []) => ({
  jobs: [
    { id: 101, title: 'Supply Chain Manager', absolute_url: 'https://boards.greenhouse.io/acme/jobs/101', first_published: daysAgo(2), location: { name: 'Mumbai, India' }, company_name: 'Acme Logistics', content: '&lt;p&gt;Own SAP planning for our west-India network.&lt;/p&gt;' },
    { id: 102, title: 'Supply Chain Manager', absolute_url: 'https://boards.greenhouse.io/acme/jobs/102', first_published: daysAgo(30), location: { name: 'Mumbai, India' }, company_name: 'Acme Logistics' },
    { id: 103, title: 'Software Engineer', absolute_url: 'https://boards.greenhouse.io/acme/jobs/103', first_published: daysAgo(1), location: { name: 'Mumbai, India' }, company_name: 'Acme Logistics' },
    { id: 104, title: 'Supply Chain Manager', absolute_url: 'https://boards.greenhouse.io/acme/jobs/104', first_published: daysAgo(1), location: { name: 'Berlin, Germany' }, company_name: 'Acme Logistics' },
    ...extra,
  ],
});

const lever = [
  { id: 'aaaa-1111', text: 'Import Operations Manager', hostedUrl: 'https://jobs.lever.co/beta-freight/aaaa-1111', createdAt: Date.now() - 3 * 86_400_000, categories: { location: 'Navi Mumbai', team: 'Operations' }, descriptionPlain: 'Lead customs clearance and SAP rollouts.' },
];

type Result = { fromBoard?: boolean; title: string; url: string; details?: string; content: string; dateSource: string; publishedDate: string };
type Body = { results: Result[]; feeds?: { boards: number; ok: number; failed: number; scanned: number; matched: number }; excluded: Record<string, number> };

describe('followed company feeds', () => {
  beforeEach(() => { resetSearchGuards(); process.env.TAVILY_API_KEY = 'tv'; delete process.env.NEBIUS_API_KEY; });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.TAVILY_API_KEY; });

  it('adds matching, in-window openings from a followed Greenhouse board, with the board\'s own title and date', async () => {
    mockFetch({ boards: { 'boards-api.greenhouse.io/v1/boards/acme/jobs': json(greenhouse()) } });
    const data = await (await POST(request({ ...base, companies: ['greenhouse:acme'] }))).json() as Body;
    expect(data.results.map((job) => job.title)).toEqual(['Supply Chain Manager — Acme Logistics']);
    const job = data.results[0];
    expect(job.url).toBe('https://boards.greenhouse.io/acme/jobs/101');
    expect(job.dateSource).toBe('api');
    expect(job.fromBoard).toBe(true);
    expect(job.details).toContain('Own SAP planning');
    expect(job.details).not.toContain('<p>');
    expect(job.content).toContain('Mumbai');
    expect(data.feeds).toMatchObject({ boards: 1, ok: 1, failed: 0 });
  });

  it('reads Lever boards too, and several boards in one search', async () => {
    const mock = mockFetch({ boards: {
      'boards-api.greenhouse.io/v1/boards/acme/jobs': json(greenhouse()),
      'api.lever.co/v0/postings/beta-freight': json(lever),
    } });
    const data = await (await POST(request({ ...base, targetRoles: 'Supply Chain Manager, Import Operations Manager', companies: ['greenhouse:acme', 'lever:beta-freight'] }))).json() as Body;
    expect(data.results.map((job) => job.title).sort()).toEqual(['Import Operations Manager — Beta Freight', 'Supply Chain Manager — Acme Logistics']);
    expect(data.feeds).toMatchObject({ boards: 2, ok: 2, failed: 0 });
    // Only the fixed job-board hosts and Tavily are ever contacted.
    for (const url of mock.calls) expect(url).toMatch(/^https:\/\/(api\.tavily\.com|boards-api\.greenhouse\.io|api\.lever\.co)\//);
  });

  it('applies the time window strictly to board openings', async () => {
    mockFetch({ boards: { 'boards-api.greenhouse.io/v1/boards/acme/jobs': json(greenhouse()) } });
    const data = await (await POST(request({ ...base, timeWindow: '1d', companies: ['greenhouse:acme'] }))).json() as Body;
    expect(data.results).toHaveLength(0);
  });

  it('never shows an undated board opening as new', async () => {
    const undated = { jobs: [{ id: 201, title: 'Supply Chain Manager', absolute_url: 'https://boards.greenhouse.io/acme/jobs/201', updated_at: daysAgo(0), location: { name: 'Mumbai' }, company_name: 'Acme' }] };
    mockFetch({ boards: {
      'boards-api.greenhouse.io/v1/boards/acme/jobs/201': () => new Response('{}', { status: 200 }),
      'boards-api.greenhouse.io/v1/boards/acme/jobs': json(undated),
    } });
    const data = await (await POST(request({ ...base, companies: ['greenhouse:acme'] }))).json() as Body;
    expect(data.results).toHaveLength(0);
    expect(data.excluded.undated).toBe(1);
  });

  it('counts a broken board without failing the search, and does not cache the partial answer', async () => {
    const mock = mockFetch({ boards: {
      'boards-api.greenhouse.io/v1/boards/acme/jobs': json(greenhouse()),
      'api.lever.co/v0/postings/gone': () => new Response('not found', { status: 404 }),
    } });
    const payload = { ...base, companies: ['greenhouse:acme', 'lever:gone'] };
    const first = await (await POST(request(payload))).json() as Body;
    expect(first.results).toHaveLength(1);
    expect(first.feeds).toMatchObject({ boards: 2, ok: 1, failed: 1 });
    const before = mock.calls.length;
    await POST(request(payload));
    expect(mock.calls.length).toBeGreaterThan(before); // not served from the cache
  });

  it('still answers from the followed companies when every web search fails', async () => {
    mockFetch({ tavily: 'fail', boards: { 'boards-api.greenhouse.io/v1/boards/acme/jobs': json(greenhouse()) } });
    const response = await POST(request({ ...base, companies: ['greenhouse:acme'] }));
    expect(response.status).toBe(200);
    const data = await response.json() as Body;
    expect(data.results).toHaveLength(1);
  });

  it('still fails when both the web search and the boards fail', async () => {
    mockFetch({ tavily: 'fail', boards: { 'boards-api.greenhouse.io/v1/boards/acme/jobs': () => new Response('x', { status: 500 }) } });
    const response = await POST(request({ ...base, companies: ['greenhouse:acme'] }));
    expect(response.status).toBeGreaterThanOrEqual(429);
  });

  it('ignores anything that is not a Greenhouse or Lever board', async () => {
    const mock = mockFetch({ boards: {} });
    const data = await (await POST(request({ ...base, companies: ['https://evil.example/stripe', 'greenhouse:../../etc', 'lever:a b', 42, null, {}] }))).json() as Body;
    expect(data.feeds).toBeUndefined();
    expect(mock.calls.every((url) => url.includes('api.tavily.com'))).toBe(true);
  });

  it('reads boards on a new search only, not on "Search More Jobs"', async () => {
    const mock = mockFetch({ boards: { 'boards-api.greenhouse.io/v1/boards/acme/jobs': json(greenhouse()) } });
    await POST(request({ ...base, page: 2, companies: ['greenhouse:acme'] }));
    expect(mock.calls.some((url) => url.includes('greenhouse'))).toBe(false);
  });

  it('does not mix cached answers for different followed companies', async () => {
    mockFetch({ boards: { 'boards-api.greenhouse.io/v1/boards/acme/jobs': json(greenhouse()) } });
    const without = await (await POST(request(base))).json() as Body;
    const withCompany = await (await POST(request({ ...base, companies: ['greenhouse:acme'] }))).json() as Body;
    expect(without.results).toHaveLength(0);
    expect(withCompany.results).toHaveLength(1);
  });

  it('shows a posting found both by search and on the board once', async () => {
    mockFetch({
      tavily: [{ title: 'Supply Chain Manager - Acme Logistics - Mumbai - Indeed.com', url: 'https://in.indeed.com/viewjob?jk=9', content: 'Mumbai, India', published_date: daysAgo(2) }],
      boards: { 'boards-api.greenhouse.io/v1/boards/acme/jobs': json(greenhouse()) },
    });
    const data = await (await POST(request({ ...base, companies: ['greenhouse:acme'] }))).json() as Body;
    const titles = data.results.map((job) => job.title);
    expect(titles.filter((title) => /Supply Chain Manager/.test(title))).toHaveLength(1);
    // The search result came first, so it is the one that is kept, and it is not marked as a board opening.
    expect(data.results[0].fromBoard).toBeUndefined();
  });
});

describe('listing text from the search', () => {
  beforeEach(() => { resetSearchGuards(); process.env.TAVILY_API_KEY = 'tv'; delete process.env.NEBIUS_API_KEY; });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.TAVILY_API_KEY; });

  it('returns cleaned page text as details, without links or markup noise', async () => {
    mockFetch({ tavily: [{
      title: 'Planner - Acme - Mumbai - Indeed.com', url: 'https://in.indeed.com/viewjob?jk=1', content: 'Mumbai, India', published_date: daysAgo(2),
      raw_content: 'Planner\n[Apply now](https://in.indeed.com/apply?x=1)\n\nWe need SAP and Excel skills.\nhttps://tracker.example/pixel\n',
    }] });
    const data = await (await POST(request(base))).json() as Body;
    expect(data.results).toHaveLength(1);
    const details = data.results[0].details ?? '';
    expect(details).toContain('SAP and Excel');
    expect(details).not.toContain('https://');
    expect(details.length).toBeLessThanOrEqual(2001);
  });

  it('leaves details out when the search returned no page text', async () => {
    mockFetch({ tavily: [{ title: 'Planner - Acme - Mumbai - Indeed.com', url: 'https://in.indeed.com/viewjob?jk=1', content: 'Mumbai, India', published_date: daysAgo(2) }] });
    const data = await (await POST(request(base))).json() as Body;
    expect(data.results[0].details).toBeUndefined();
  });
});
