import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../api/extract-profile';

const RESUME = 'Senior Import Operations Manager at Example Co, Mumbai. Led freight invoice auditing in SAP S/4HANA. MBA Logistics, 2014.';
const request = (payload: unknown, ip: string) => new Request('http://x/api/extract-profile', { method: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify(payload) });
const completion = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

describe('POST /api/extract-profile', () => {
  beforeEach(() => { process.env.NEBIUS_API_KEY = 'test-key'; });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.NEBIUS_API_KEY; });

  it('returns 503 without a key and 400 for short text', async () => {
    delete process.env.NEBIUS_API_KEY;
    expect((await POST(request({ resumeText: RESUME }, 'a1'))).status).toBe(503);
    process.env.NEBIUS_API_KEY = 'k';
    expect((await POST(request({ resumeText: 'too short' }, 'a2'))).status).toBe(400);
  });

  it('parses a Nemotron answer, de-duplicates and caps lists', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(completion('<think>x</think>{"targetRoles":["Import Operations Manager","import operations manager","Supply Chain Manager"],"skills":["SAP S/4HANA","freight auditing"],"education":["MBA Logistics"],"location":"Mumbai","headline":"Logistics leader."}'));
    const response = await POST(request({ resumeText: RESUME }, 'a3'));
    const data = await response.json() as { profile: { targetRoles: string[]; location: string } };
    expect(response.status).toBe(200);
    expect(data.profile.targetRoles).toEqual(['Import Operations Manager', 'Supply Chain Manager']);
    expect(data.profile.location).toBe('Mumbai');
    const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as { model: string; messages: { content: string }[] };
    expect(sent.model).toBe('nvidia/nemotron-3-super-120b-a12b');
    expect(sent.messages[1].content).toContain('SAP S/4HANA');
  });

  it('returns 502 for unusable model output', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(completion('{"targetRoles":[],"skills":[],"education":[]}'));
    expect((await POST(request({ resumeText: RESUME }, 'a4'))).status).toBe(502);
  });
});
