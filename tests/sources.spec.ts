import { describe, expect, it } from 'vitest';
import { ATS_GROUP, SOURCE_GROUPS, SOURCES, getSource, isSourceId } from '../lib/sources';
import { hostMatches } from '../lib/recency';

describe('source catalogue', () => {
  it('has a broad, well-formed list', () => {
    expect(SOURCES.length).toBeGreaterThanOrEqual(80);
    expect(new Set(SOURCES.map((source) => source.id)).size).toBe(SOURCES.length);
    for (const source of SOURCES) {
      expect(source.id).toMatch(/^[a-z0-9-]+$/);
      expect(source.label.length).toBeGreaterThan(1);
      expect(SOURCE_GROUPS).toContain(source.group);
      expect(source.domains.length).toBeGreaterThan(0);
      for (const domain of source.domains) expect(domain).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/);
    }
  });
  it('keeps the original five source ids so saved profiles still work', () => {
    for (const id of ['linkedin', 'indeed', 'glassdoor', 'naukri', 'ats']) expect(isSourceId(id)).toBe(true);
    expect(getSource('ats')?.group).toBe(ATS_GROUP);
    expect(isSourceId('not-a-site')).toBe(false);
    expect(isSourceId(42)).toBe(false);
  });
  it('covers every region group with at least one site', () => {
    for (const group of SOURCE_GROUPS) expect(SOURCES.some((source) => source.group === group)).toBe(true);
  });
  it('does not list one domain under two different sites', () => {
    const owner = new Map<string, string>();
    for (const source of SOURCES) for (const domain of source.domains) {
      expect(owner.has(domain), `${domain} is listed twice`).toBe(false);
      owner.set(domain, source.id);
    }
  });
  it('matches subdomains of listed sites but not look-alikes', () => {
    const indeed = getSource('indeed')!;
    expect(hostMatches('https://in.indeed.com/viewjob', indeed.domains)).toBe(true);
    expect(hostMatches('https://notindeed.com/x', indeed.domains)).toBe(false);
  });
});
