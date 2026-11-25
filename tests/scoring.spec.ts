import { describe, expect, it } from 'vitest';
import { rankJobs, scoreJob } from '../src/lib/matcher';
import { DEFAULT_PROFILE } from '../src/lib/types';
import type { CareerProfile } from '../src/lib/types';

const profile: CareerProfile = { ...DEFAULT_PROFILE, targetRoles: 'Supply Chain Manager', skills: 'SAP, Excel' };
const job = (title: string, content = '', url = 'https://jobs.example.com/a-long-posting-id-123456') => ({ title, content, url });

describe('role matching', () => {
  it('scores a role in the job title above a role that only appears in the description', () => {
    const inTitle = scoreJob(job('Supply Chain Manager — Acme'), profile).matchScore;
    const inBody = scoreJob(job('Operations Lead — Acme', 'You will report to the Supply Chain Manager.'), profile).matchScore;
    expect(inTitle).toBeGreaterThan(inBody);
    expect(inBody).toBeGreaterThan(scoreJob(job('Marketing Coordinator — Acme'), profile).matchScore);
  });

  it('matches the words of a role in any order', () => {
    for (const title of ['Manager, Supply Chain — Acme', 'Supply Chain & Logistics Manager — Acme', 'Manager of Supply Chain Planning']) {
      expect(scoreJob(job(title), profile).matchedTerms).toContain('Supply Chain Manager');
    }
  });

  it('does not match a role when a word is missing', () => {
    expect(scoreJob(job('Supply Planner — Acme'), profile).matchedTerms).not.toContain('Supply Chain Manager');
    expect(scoreJob(job('Chain Store Manager — Acme'), profile).matchedTerms).not.toContain('Supply Chain Manager');
  });
});

describe('rankJobs ordering', () => {
  it('puts the newer posting first among equal scores, and keeps search order for undated ones', () => {
    const same = (n: number, publishedDate?: string) => ({ ...job('Supply Chain Manager — Acme', '', `https://jobs.example.com/posting-id-${n}00000`), publishedDate });
    const ranked = rankJobs([
      same(1, '2026-11-20T00:00:00Z'), same(2, '2026-11-24T00:00:00Z'), same(3), same(4),
    ], profile);
    expect(ranked.map((entry) => entry.url.match(/id-(\d)/)?.[1])).toEqual(['2', '1', '3', '4']);
  });

  it('still ranks a better match above a newer one', () => {
    const ranked = rankJobs([
      { ...job('Marketing Coordinator', '', 'https://jobs.example.com/posting-id-500000'), publishedDate: '2026-11-25T00:00:00Z' },
      { ...job('Supply Chain Manager — Acme SAP Excel', '', 'https://jobs.example.com/posting-id-600000'), publishedDate: '2026-11-01T00:00:00Z' },
    ], profile);
    expect(ranked[0].title).toContain('Supply Chain Manager');
  });
});
