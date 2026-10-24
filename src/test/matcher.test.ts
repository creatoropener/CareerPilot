import { describe, expect, it } from 'vitest';
import { buildSearchFallbackLinks, canonicalizeUrl, rankJobs, suggestProfileFromResume } from '../lib/matcher';
import { DEFAULT_PROFILE } from '../lib/types';
import type { CareerProfile } from '../lib/types';

const profile: CareerProfile = {
  ...DEFAULT_PROFILE,
  targetRoles: 'Supply Chain Manager, Import Operations Manager',
  skills: 'SAP S/4HANA, freight auditing, Excel',
  location: 'Mumbai',
  education: 'Business Management',
  experienceSummary: 'Led logistics operations and freight invoice reconciliation',
};

describe('CareerPilot matching utilities', () => {
  it('ranks a result with several visible matching signals higher', () => {
    const [strong, weak] = rankJobs([
      { title: 'Supply Chain Manager — Mumbai', url: 'https://jobs.example.com/supply-chain-manager', content: 'SAP S/4HANA, freight auditing, Excel. Business Management degree. Apply for this opening in Mumbai.' },
      { title: 'Marketing Coordinator', url: 'https://jobs.example.com/marketing', content: 'Social media and brand marketing role.' },
    ], profile);
    expect(strong.matchScore).toBeGreaterThan(weak.matchScore);
    expect(strong.matchedTerms).toContain('SAP S/4HANA');
  });

  it('removes duplicate URLs and tracking query parameters', () => {
    const results = rankJobs([
      { title: 'One', url: 'https://www.example.com/job?id=1&utm_source=search', content: 'Supply Chain Manager' },
      { title: 'Duplicate', url: 'https://example.com/job?id=1&utm_medium=web#details', content: 'Supply Chain Manager' },
    ], profile);
    expect(canonicalizeUrl('https://www.example.com/job?id=1&utm_source=search')).toBe('https://example.com/job?id=1');
    expect(results).toHaveLength(1);
  });

  it('extracts common skills and likely role/education lines locally', () => {
    const suggestions = suggestProfileFromResume('Assistant Manager - Supply Chain\nSAP S/4HANA, Excel and freight auditing\nBachelor of Business Administration');
    expect(suggestions.skills).toContain('SAP S/4HANA');
    expect(suggestions.skills.map((skill) => skill.toLowerCase())).toContain('freight auditing');
    expect(suggestions.roles.some((role) => role.includes('Manager'))).toBe(true);
    expect(suggestions.education.some((line) => line.includes('Bachelor'))).toBe(true);
  });

  it('provides direct-search fallbacks without an API key', () => {
    const links = buildSearchFallbackLinks(profile);
    expect(links.map((link) => link.label)).toContain('Google Jobs');
    expect(links.every((link) => link.url.startsWith('https://'))).toBe(true);
  });
});
