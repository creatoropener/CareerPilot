import { describe, expect, it } from 'vitest';
import { boardFromId, companyFromUrl, companyId, companyLabel, parseCompany, prettifyToken, sanitizeCompanies } from '../lib/companies';

describe('parseCompany', () => {
  it('reads the id form', () => {
    expect(parseCompany('greenhouse:stripe')).toEqual({ provider: 'greenhouse', token: 'stripe' });
    expect(parseCompany(' Lever:Netflix ')).toEqual({ provider: 'lever', token: 'netflix' });
    expect(parseCompany('lever-eu:acme')).toEqual({ provider: 'lever', token: 'acme', eu: true });
  });
  it('reads a company job board address or a listing address', () => {
    expect(parseCompany('https://boards.greenhouse.io/stripe')).toEqual({ provider: 'greenhouse', token: 'stripe' });
    expect(parseCompany('boards.greenhouse.io/stripe/jobs/123456')).toEqual({ provider: 'greenhouse', token: 'stripe' });
    expect(parseCompany('https://job-boards.greenhouse.io/acme-logistics')).toEqual({ provider: 'greenhouse', token: 'acme-logistics' });
    expect(parseCompany('https://boards.greenhouse.io/embed/job_board?for=Stripe')).toEqual({ provider: 'greenhouse', token: 'stripe' });
    expect(parseCompany('https://jobs.lever.co/netflix/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab')).toEqual({ provider: 'lever', token: 'netflix' });
    expect(parseCompany('https://jobs.eu.lever.co/acme')).toEqual({ provider: 'lever', token: 'acme', eu: true });
  });
  it('rejects every other website and anything that is not a board name', () => {
    for (const bad of [
      'https://example.com/stripe', 'https://boards.greenhouse.io.evil.io/stripe', 'https://evil.io/boards.greenhouse.io/stripe',
      'https://boards.greenhouse.io/', 'https://boards.greenhouse.io/embed/job_board', 'greenhouse:', 'greenhouse:../etc',
      'greenhouse:a/b', 'workday:acme', 'stripe', '', '   ', 'http://169.254.169.254/', 'greenhouse:' + 'a'.repeat(65),
    ]) expect(parseCompany(bad), bad).toBeNull();
    for (const bad of [null, undefined, 5, {}, []]) expect(parseCompany(bad)).toBeNull();
  });
});

describe('ids, labels and lists', () => {
  it('round-trips an id', () => {
    for (const id of ['greenhouse:stripe', 'lever:netflix', 'lever-eu:acme']) expect(companyId(boardFromId(id)!)).toBe(id);
    expect(boardFromId('nonsense')).toBeNull();
  });
  it('finds the company behind a listing link', () => {
    expect(companyFromUrl('https://boards.greenhouse.io/stripe/jobs/5551234')).toEqual({ provider: 'greenhouse', token: 'stripe' });
    expect(companyFromUrl('https://www.naukri.com/job-listings-x-123456')).toBeNull();
  });
  it('keeps valid, unique companies and respects the maximum', () => {
    expect(sanitizeCompanies(['greenhouse:stripe', 'https://boards.greenhouse.io/Stripe', 'lever:netflix', 'junk', 5, null])).toEqual(['greenhouse:stripe', 'lever:netflix']);
    expect(sanitizeCompanies('greenhouse:stripe')).toEqual([]);
    expect(sanitizeCompanies(Array.from({ length: 30 }, (_, index) => `greenhouse:company${index}`))).toHaveLength(20);
    expect(sanitizeCompanies(['greenhouse:a', 'greenhouse:b', 'greenhouse:c'], 2)).toEqual(['greenhouse:a', 'greenhouse:b']);
  });
  it('writes readable labels', () => {
    expect(companyLabel('greenhouse:stripe')).toBe('stripe (Greenhouse)');
    expect(companyLabel('lever:netflix')).toBe('netflix (Lever)');
    expect(prettifyToken('acme-logistics_india')).toBe('Acme Logistics India');
  });
});
