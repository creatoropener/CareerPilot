import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../api/search-jobs';

const request = (payload: unknown) => new Request('http://x/api/search-jobs', { method: 'POST', body: JSON.stringify(payload) });
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const base = { targetRoles: 'Import Manager', skills: 'SAP', workMode: 'Any', timeWindow: '2w', sources: ['naukri', 'indeed', 'linkedin', 'bayt'] };

interface Sent { query: string; include_domains: string[] }
function mockTavily(results: unknown[]) {
  const sent: Sent[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).includes('nebius')) return new Response('', { status: 500 });
    sent.push(JSON.parse(String(init?.body)) as Sent);
    return new Response(JSON.stringify({ results }), { status: 200 });
  });
  return sent;
}
interface Out { results: { title: string; url: string; key: string }[]; excluded: Record<string, number>; page: number; overflow: number }
const post = async (payload: unknown) => (await (await POST(request(payload))).json()) as Out;

const naviMumbai = { title: 'Import Manager - ABC Logistics - Navi Mumbai | Naukri.com', url: 'https://www.naukri.com/job-listings-import-manager-abc-logistics-navi-mumbai-123456', content: 'Navi Mumbai, Maharashtra, India', published_date: daysAgo(2) };
const kerala = { title: 'Import Manager - Beta Exports - Kochi | Naukri.com', url: 'https://www.naukri.com/job-listings-import-manager-beta-exports-kochi-234567', content: 'Kochi, Kerala, India', published_date: daysAgo(2) };
const southAfrica = { title: 'Import Manager - Gamma Freight - Cape Town, South Africa - Indeed.com', url: 'https://za.indeed.com/viewjob?jk=sa123', content: 'Cape Town, South Africa. Posted 2 days ago', published_date: daysAgo(2) };
const dubai = { title: 'Import Manager - Delta Trading - Dubai - Bayt.com', url: 'https://www.bayt.com/en/uae/jobs/import-manager-4567890/', content: 'Dubai, United Arab Emirates', published_date: daysAgo(3) };
const bulk = { title: '15,000 Import Manager Jobs in Navi Mumbai - Naukri.com', url: 'https://www.naukri.com/import-manager-jobs-in-navi-mumbai', content: 'Navi Mumbai. Apply to 15,000 vacancies', published_date: daysAgo(1) };

describe('location accuracy', () => {
  beforeEach(() => { process.env.TAVILY_API_KEY = 'tv'; delete process.env.NEBIUS_API_KEY; });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.TAVILY_API_KEY; });

  it('keeps only listings for the selected places', async () => {
    mockTavily([naviMumbai, kerala, southAfrica, dubai]);
    const data = await post({ ...base, locations: ['Navi Mumbai, India', 'Dubai, United Arab Emirates'] });
    expect(data.results.map((job) => job.title).sort()).toEqual(['Import Manager — ABC Logistics', 'Import Manager — Delta Trading']);
    expect(data.excluded.wrongLocation).toBe(2);
  });

  it('returns nothing from other places when one city is selected', async () => {
    mockTavily([naviMumbai, kerala, southAfrica, dubai]);
    const data = await post({ ...base, locations: ['Dubai, United Arab Emirates'] });
    expect(data.results.map((job) => job.title)).toEqual(['Import Manager — Delta Trading']);
  });

  it('puts both the city and the country, quoted, in every query', async () => {
    const sent = mockTavily([]);
    await post({ ...base, locations: ['Navi Mumbai, India'] });
    expect(sent.length).toBeGreaterThan(0);
    for (const call of sent) expect(call.query).toContain('"Navi Mumbai" "India"');
  });

  it('does not filter by place when none is selected', async () => {
    mockTavily([kerala, dubai]);
    const data = await post(base);
    expect(data.results).toHaveLength(2);
  });
});

describe('individual vacancies only', () => {
  beforeEach(() => { process.env.TAVILY_API_KEY = 'tv'; delete process.env.NEBIUS_API_KEY; });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.TAVILY_API_KEY; });

  it('drops bulk and search pages and shows Role — Company', async () => {
    mockTavily([bulk, naviMumbai, { title: 'Import Manager Jobs in Navi Mumbai | Indeed', url: 'https://in.indeed.com/jobs?q=import+manager&l=Navi+Mumbai', content: 'Navi Mumbai', published_date: daysAgo(1) }]);
    const data = await post({ ...base, locations: ['Navi Mumbai, India'] });
    expect(data.results.map((job) => job.title)).toEqual(['Import Manager — ABC Logistics']);
    expect(data.excluded.notVacancy).toBe(2);
  });

  it('shows the same job posted on two sites once', async () => {
    const copy = { ...naviMumbai, title: 'ABC Logistics hiring Import Manager in Navi Mumbai, India | LinkedIn', url: 'https://in.linkedin.com/jobs/view/import-manager-at-abc-logistics-3812345678' };
    mockTavily([naviMumbai, copy]);
    const data = await post({ ...base, locations: ['Navi Mumbai, India'] });
    expect(data.results).toHaveLength(1);
  });
});

describe('batches and cost', () => {
  beforeEach(() => { process.env.TAVILY_API_KEY = 'tv'; delete process.env.NEBIUS_API_KEY; });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.TAVILY_API_KEY; });

  const many = (count: number) => Array.from({ length: count }, (_, index) => ({
    title: `Import Manager ${index} - Company ${index} - Navi Mumbai | Naukri.com`,
    url: `https://www.naukri.com/job-listings-import-manager-${index}-company-navi-mumbai-${100000 + index}`,
    content: 'Navi Mumbai, India', published_date: daysAgo(1), score: 1 - index / 100,
  }));

  it('returns a ranked pool of at most 30 and reports the overflow', async () => {
    mockTavily(many(45));
    const data = await post({ ...base, locations: ['Navi Mumbai, India'] });
    expect(data.results).toHaveLength(30);
    expect(data.overflow).toBe(15);
  });

  it('never searches more than 8 times for the first search, even when nothing valid is found', async () => {
    const sent = mockTavily([bulk, kerala]);
    const data = await post({ ...base, sources: ['linkedin', 'indeed', 'glassdoor', 'naukri', 'bayt', 'reed', 'ats'], locations: ['Navi Mumbai, India', 'Dubai, United Arab Emirates'] });
    expect(data.results).toHaveLength(0);
    expect(sent.length).toBeLessThanOrEqual(8);
  });

  it('"more" requests use a smaller budget and different queries, and skip listings already shown', async () => {
    const first = mockTavily(many(12));
    const one = await post({ ...base, locations: ['Navi Mumbai, India'] });
    vi.restoreAllMocks();
    const second = mockTavily(many(12));
    const seen = one.results.slice(0, 5).map((job) => job.key);
    const more = await post({ ...base, locations: ['Navi Mumbai, India'], page: 2, seen });
    expect(more.page).toBe(2);
    expect(second.length).toBeLessThanOrEqual(5);
    expect(new Set(second.map((call) => call.query))).not.toEqual(new Set(first.map((call) => call.query)));
    expect(more.results.some((job) => seen.includes(job.key))).toBe(false);
    expect(more.excluded.alreadyShown).toBe(5);
  });

  it('keeps the page number within bounds', async () => {
    mockTavily([]);
    expect((await post({ ...base, page: 99 })).page).toBe(4);
    expect((await post({ ...base, page: -3 })).page).toBe(1);
    expect((await post({ ...base, page: 'x' })).page).toBe(1);
  });
});
