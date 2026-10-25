import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../api/search-jobs';
import { scoreJob } from '../src/lib/matcher';
import { DEFAULT_PROFILE } from '../src/lib/types';

const job = (place: string) => ({ title: `Supply Chain Manager — ${place}`, url: 'https://jobs.example.com/scm', content: 'Apply now' });
const profile = (locations: string[], location = '') => ({ ...DEFAULT_PROFILE, targetRoles: 'Supply Chain Manager', locations, location });

describe('scoring with several places', () => {
  it('gives the location points when the listing mentions any selected place', () => {
    const selected = profile(['Mumbai, India', 'Pune, India', 'Dubai, United Arab Emirates']);
    expect(scoreJob(job('Mumbai'), selected).matchScore).toBe(65);
    expect(scoreJob(job('Pune'), selected).matchScore).toBe(65);
    expect(scoreJob(job('Dubai'), selected).matchScore).toBe(65);
  });
  it('gives none when the listing mentions none of them', () => {
    expect(scoreJob(job('Berlin'), profile(['Mumbai, India', 'Pune, India'])).matchScore).toBe(50);
  });
  it('supports country-level places', () => {
    expect(scoreJob({ ...job('Chennai'), content: 'Apply now, India' }, profile(['India'])).matchScore).toBe(65);
  });
  it('still works for profiles that only have the older single location text', () => {
    const legacy = { ...DEFAULT_PROFILE, targetRoles: 'Supply Chain Manager', location: 'Mumbai, India' } as typeof DEFAULT_PROFILE;
    expect(scoreJob(job('Mumbai'), legacy).matchScore).toBe(65);
    expect(scoreJob(job('Pune'), legacy).matchScore).toBe(50);
    const noPlace = profile([]);
    expect(scoreJob(job('Anywhere'), noPlace).matchScore).toBe(58);
  });
});

interface Sent { query: string; include_domains: string[]; max_results: number }
function mockTavily() {
  const sent: Sent[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).includes('nebius')) return new Response('', { status: 500 });
    sent.push(JSON.parse(String(init?.body)) as Sent);
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  });
  return sent;
}
const request = (payload: unknown) => new Request('http://x/api/search-jobs', { method: 'POST', body: JSON.stringify(payload) });
const base = { targetRoles: 'Supply Chain Manager', skills: 'SAP', workMode: 'Any', timeWindow: '1w' };

describe('POST /api/search-jobs with several places and sites', () => {
  beforeEach(() => { process.env.TAVILY_API_KEY = 'tv'; delete process.env.NEBIUS_API_KEY; });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.TAVILY_API_KEY; });

  it('searches every selected place separately', async () => {
    const sent = mockTavily();
    const data = await (await POST(request({ ...base, sources: ['indeed'], locations: ['Mumbai, India', 'Dubai, United Arab Emirates', 'Germany'] }))).json() as { locations: string[] };
    expect(data.locations).toEqual(['Mumbai, India', 'Dubai, United Arab Emirates', 'Germany']);
    const text = sent.map((call) => call.query).join('\n');
    expect(text).toContain('"Mumbai" India');
    expect(text).toContain('"Dubai" United Arab Emirates');
    expect(text).toContain('"Germany"');
    expect(sent.every((call) => !call.query.includes('{location}'))).toBe(true);
  });

  it('never exceeds the call cap, even with many places and many sites, and still covers every site', async () => {
    const sent = mockTavily();
    const sources = ['linkedin', 'indeed', 'glassdoor', 'naukri', 'reed', 'seek-au', 'bayt', 'wellfound', 'dice', 'ats'];
    await POST(request({ ...base, sources, locations: ['Mumbai, India', 'Pune, India', 'Dubai, UAE', 'London, United Kingdom', 'Sydney, Australia'] }));
    expect(sent.length).toBeLessThanOrEqual(8);
    expect(sent.length).toBeGreaterThanOrEqual(5);
    const domains = new Set(sent.flatMap((call) => call.include_domains));
    for (const domain of ['linkedin.com', 'indeed.com', 'naukri.com', 'reed.co.uk', 'seek.com.au', 'bayt.com', 'wellfound.com', 'dice.com', 'greenhouse.io']) expect(domains.has(domain)).toBe(true);
  });

  it('groups about four sites per call when the budget allows', async () => {
    const sent = mockTavily();
    await POST(request({ ...base, sources: ['linkedin', 'indeed', 'glassdoor', 'naukri', 'monster', 'jooble', 'adzuna', 'talent-com'], locations: ['Mumbai, India'] }));
    const portalCalls = sent.filter((call) => !call.include_domains.includes('greenhouse.io'));
    expect(portalCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('works with the older single "location" text and with no place at all', async () => {
    let sent = mockTavily();
    await POST(request({ ...base, sources: ['indeed'], location: 'Mumbai, India' }));
    expect(sent.map((call) => call.query).join(' ')).toContain('"Mumbai" India');
    vi.restoreAllMocks();
    sent = mockTavily();
    const data = await (await POST(request({ ...base, sources: ['indeed'] }))).json() as { locations: string[] };
    expect(data.locations).toEqual([]);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((call) => !call.query.includes('{location}'))).toBe(true);
  });

  it('caps the list at five places, de-duplicates, and strips quotes and braces', async () => {
    const sent = mockTavily();
    const data = await (await POST(request({ ...base, sources: ['indeed'], locations: ['A1', 'a1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G"7{location}'] }))).json() as { locations: string[] };
    expect(data.locations).toEqual(['A1', 'B2', 'C3', 'D4', 'E5']);
    expect(sent.length).toBeLessThanOrEqual(8);
  });
});
