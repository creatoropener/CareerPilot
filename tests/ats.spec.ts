import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchesAnyRole, parseGreenhouse, parseLever, readBoards } from '../lib/ats';
import type { BoardJob } from '../lib/ats';
import { cleanPageText, plainText } from '../lib/text';
import type { CompanyBoard } from '../lib/companies';

const gh: CompanyBoard = { provider: 'greenhouse', token: 'acme' };
const lv: CompanyBoard = { provider: 'lever', token: 'beta-freight' };

const greenhouseList = {
  jobs: [
    { id: 4012345, title: 'Supply Chain Manager', absolute_url: 'https://boards.greenhouse.io/acme/jobs/4012345', first_published: '2026-11-24T09:00:00-05:00', updated_at: '2026-11-25T09:00:00-05:00', location: { name: 'Mumbai, India' }, company_name: 'Acme Logistics', departments: [{ name: 'Operations' }] },
    { id: 4012346, title: 'Software Engineer', absolute_url: 'https://boards.greenhouse.io/acme/jobs/4012346', first_published: '2026-11-24T09:00:00-05:00', location: { name: 'Mumbai, India' } },
    { id: 4012347, title: 'Procurement Manager, Supply Chain', absolute_url: 'https://boards.greenhouse.io/acme/jobs/4012347', updated_at: '2026-11-20T09:00:00-05:00', location: { name: 'Berlin, Germany' } },
    { id: 'x/../1', title: 'Bad id', absolute_url: 'https://boards.greenhouse.io/acme/jobs/1', location: { name: 'Mumbai' } },
    { id: 4012348, title: 'Bad link', absolute_url: 'javascript:alert(1)', location: { name: 'Mumbai' } },
    null, 'junk',
  ],
};

const leverList = [
  { id: 'aaaa-1111', text: 'Import Operations Manager', hostedUrl: 'https://jobs.lever.co/beta-freight/aaaa-1111', createdAt: Date.parse('2026-11-23T05:00:00Z'), categories: { location: 'Navi Mumbai', allLocations: ['Navi Mumbai', 'Pune'], team: 'Operations' }, descriptionPlain: 'Lead import operations and customs clearance.', additionalPlain: 'We offer great benefits.' },
  { id: 'bbbb-2222', text: 'Import Operations Manager', hostedUrl: 'https://jobs.lever.co/beta-freight/bbbb-2222', categories: { location: 'Navi Mumbai' }, descriptionPlain: '' },
  { id: 'cccc-3333', text: 'Designer', hostedUrl: 'https://jobs.lever.co/beta-freight/cccc-3333', createdAt: 5, categories: { location: 'Navi Mumbai' } },
];

describe('parseGreenhouse', () => {
  it('keeps real postings and reads the first-published date, never updated_at', () => {
    const jobs = parseGreenhouse(greenhouseList, gh);
    expect(jobs.map((job) => job.title)).toEqual(['Supply Chain Manager', 'Software Engineer', 'Procurement Manager, Supply Chain']);
    expect(jobs[0]).toMatchObject({ id: 'greenhouse:acme:4012345', company: 'Acme Logistics', location: 'Mumbai, India', team: 'Operations', postedAt: '2026-11-24T14:00:00.000Z' });
    expect(jobs[2].postedAt).toBeNull();
    expect(jobs[2].company).toBe('Acme');
  });
  it('copes with unexpected payloads', () => {
    for (const payload of [null, undefined, 5, 'x', {}, { jobs: 'no' }, []]) expect(parseGreenhouse(payload, gh)).toEqual([]);
  });
});

describe('parseLever', () => {
  it('reads title, places, description and the creation date', () => {
    const jobs = parseLever(leverList, lv);
    expect(jobs).toHaveLength(3);
    expect(jobs[0]).toMatchObject({ id: 'lever:beta-freight:aaaa-1111', title: 'Import Operations Manager', company: 'Beta Freight', location: 'Navi Mumbai; Pune', team: 'Operations', postedAt: '2026-11-23T05:00:00.000Z' });
    expect(jobs[0].details).toContain('customs clearance');
    expect(jobs[1].postedAt).toBeNull();
    expect(jobs[2].postedAt).toBeNull(); // 1970 is not a believable date
  });
  it('copes with unexpected payloads', () => {
    for (const payload of [null, {}, 'x', 5, [null, 1, {}]]) expect(parseLever(payload, lv)).toEqual([]);
  });
});

describe('matchesAnyRole', () => {
  it('matches the role, or all its words in any order', () => {
    expect(matchesAnyRole('Senior Supply Chain Manager', ['Supply Chain Manager'])).toBe(true);
    expect(matchesAnyRole('Manager, Supply Chain', ['Supply Chain Manager'])).toBe(true);
    expect(matchesAnyRole('Supply Chain Analyst', ['Supply Chain Manager'])).toBe(false);
    expect(matchesAnyRole('Software Engineer', ['Supply Chain Manager', 'Import Operations Manager'])).toBe(false);
    expect(matchesAnyRole('Import Operations Manager', ['Supply Chain Manager', 'Import Operations Manager'])).toBe(true);
    expect(matchesAnyRole('Data Scientist', ['Scientist'])).toBe(true);
  });
});

describe('readBoards', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const inMumbai = (job: BoardJob) => /mumbai/i.test(job.location);

  function mock(routes: Record<string, () => Response>) {
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      const route = Object.entries(routes).find(([key]) => url.includes(key));
      if (!route) throw new Error(`unexpected request ${url}`);
      return route[1]();
    });
    return urls;
  }
  const json = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });

  it('keeps matching jobs from every board, newest first, and fills in a Greenhouse description', async () => {
    const urls = mock({
      'boards-api.greenhouse.io/v1/boards/acme/jobs/4012345': json({ content: '&lt;p&gt;Run &lt;b&gt;SAP&lt;/b&gt; planning &amp;amp; freight.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Excel&lt;/li&gt;&lt;/ul&gt;' }),
      'boards-api.greenhouse.io/v1/boards/acme/jobs': json(greenhouseList),
      'api.lever.co/v0/postings/beta-freight': json(leverList),
    });
    const { jobs, summary } = await readBoards([gh, lv], { roles: ['Supply Chain Manager', 'Import Operations Manager'], matchesPlace: inMumbai });
    expect(jobs.map((job) => job.title)).toEqual(['Supply Chain Manager', 'Import Operations Manager', 'Import Operations Manager']);
    expect(jobs[0].details).toBe('Run SAP planning & freight.\n• Excel');
    expect(summary).toEqual({ boards: 2, ok: 2, failed: 0, scanned: 6, matched: 3 });
    expect(urls.every((url) => /^https:\/\/(boards-api\.greenhouse\.io|api\.lever\.co)\//.test(url))).toBe(true);
  });

  it('counts a failing board without losing the others', async () => {
    mock({
      'boards-api.greenhouse.io': () => new Response('nope', { status: 404 }),
      'api.lever.co': json(leverList),
    });
    const { jobs, summary } = await readBoards([gh, lv], { roles: ['Import Operations Manager'], matchesPlace: inMumbai });
    expect(summary).toMatchObject({ boards: 2, ok: 1, failed: 1 });
    expect(jobs).toHaveLength(2);
  });

  it('uses the EU Lever host for an EU board, limits the boards per search and the jobs per board', async () => {
    const urls = mock({ 'api.eu.lever.co': json(leverList), 'api.lever.co': json(leverList), 'boards-api': json({ jobs: [] }) });
    const boards: CompanyBoard[] = [{ provider: 'lever', token: 'eu-co', eu: true }, ...Array.from({ length: 10 }, (_, index): CompanyBoard => ({ provider: 'greenhouse', token: `c${index}` }))];
    const { summary } = await readBoards(boards, { roles: ['Manager'], matchesPlace: () => true });
    expect(urls[0]).toBe('https://api.eu.lever.co/v0/postings/eu-co?mode=json');
    expect(summary.boards).toBe(8);
    const limited = await readBoards([lv], { roles: ['Manager'], matchesPlace: () => true, maxPerBoard: 1 });
    expect(limited.jobs).toHaveLength(1);
  });
});

describe('text helpers', () => {
  it('turns escaped HTML into readable text', () => {
    expect(plainText('&lt;h2&gt;Role&lt;/h2&gt;&lt;p&gt;Plan &amp;amp; buy.&lt;br&gt;Travel &amp;lt;10%&lt;/p&gt;')).toBe('Role\nPlan & buy.\nTravel <10%');
    expect(plainText('<p>Hello&nbsp;<script>alert(1)</script>world &#8211; ok &#x41;</p>')).toBe('Hello world – ok A');
  });
  it('cuts long text at a word and cleans page text', () => {
    const long = plainText(`<p>${'word '.repeat(2000)}</p>`, 100);
    expect(long.length).toBeLessThanOrEqual(101);
    expect(long.endsWith('…')).toBe(true);
    expect(cleanPageText('Intro\nhttps://example.com/x\n[Apply now](https://example.com/apply) today\n\n\n\nEnd\u0000')).toBe('Intro\nApply now today\nEnd');
    expect(cleanPageText(null)).toBe('');
  });
});
