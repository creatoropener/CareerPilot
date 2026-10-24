import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../api/search-jobs';

const request = (payload: unknown) => new Request('http://x/api/search-jobs', { method: 'POST', body: JSON.stringify(payload) });
const profile = { targetRoles: 'Supply Chain Manager', skills: 'SAP', location: 'Mumbai', workMode: 'Any' };
const tavily = () => new Response(JSON.stringify({ results: [{ title: 'Job', url: 'https://jobs.example.com/1', content: 'c' }] }), { status: 200 });

function mockFetch(planner: () => Response) {
  const tavilyQueries: string[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes('nebius')) return planner();
    tavilyQueries.push((JSON.parse(String(init?.body)) as { query: string }).query);
    return tavily();
  });
  return { spy, tavilyQueries };
}

describe('POST /api/search-jobs query planning', () => {
  beforeEach(() => { process.env.TAVILY_API_KEY = 'tv'; delete process.env.NEBIUS_API_KEY; });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.TAVILY_API_KEY; delete process.env.NEBIUS_API_KEY; });

  it('uses rule-based queries when no Nebius key is configured', async () => {
    const { tavilyQueries } = mockFetch(() => new Response('', { status: 500 }));
    const data = await (await POST(request(profile))).json() as { planner: string; queries: string[] };
    expect(data.planner).toBe('rules');
    expect(tavilyQueries).toHaveLength(3);
  });

  it('searches with Nemotron-planned queries and reports the planner', async () => {
    process.env.NEBIUS_API_KEY = 'nb';
    const { tavilyQueries } = mockFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: '<think>..</think>```json\n{"queries":["supply chain manager openings Mumbai","logistics head vacancy Mumbai","site:boards.greenhouse.io supply chain Mumbai SAP"]}\n```' } }] }), { status: 200 }));
    const data = await (await POST(request(profile))).json() as { planner: string; queries: string[] };
    expect(data.planner).toBe('nemotron');
    expect(data.queries[1]).toBe('logistics head vacancy Mumbai');
    expect(tavilyQueries.sort()).toEqual([...data.queries].sort());
  });

  it('fills missing slots with rule queries and falls back when the planner fails', async () => {
    process.env.NEBIUS_API_KEY = 'nb';
    let { tavilyQueries } = mockFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: '{"queries":["only one good query here"]}' } }] }), { status: 200 }));
    let data = await (await POST(request(profile))).json() as { planner: string };
    expect(data.planner).toBe('nemotron');
    expect(tavilyQueries).toHaveLength(3);
    vi.restoreAllMocks();
    ({ tavilyQueries } = mockFetch(() => new Response('down', { status: 503 })));
    data = await (await POST(request(profile))).json() as { planner: string };
    expect(data.planner).toBe('rules');
    expect(tavilyQueries).toHaveLength(3);
  });
});
