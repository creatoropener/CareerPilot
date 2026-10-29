import { describe, expect, it } from 'vitest';
import { listingMatchesAnyPlace, listingMatchesPlace, parsePlace } from '../lib/geo';

const listing = (title: string, snippet = '', url = 'https://example.com/job/123456') => ({ title, url, snippet });
const navi = parsePlace('Navi Mumbai, India');
const dubai = parsePlace('Dubai, United Arab Emirates');

describe('parsePlace', () => {
  it('reads "City, Country", a bare country and free text', () => {
    expect(parsePlace('Navi Mumbai, India')).toMatchObject({ kind: 'city', countryCode: 'IN' });
    expect(parsePlace('India')).toMatchObject({ kind: 'country', countryCode: 'IN' });
    expect(parsePlace('United Arab Emirates')).toMatchObject({ kind: 'country', countryCode: 'AE' });
    expect(parsePlace('Dubai')).toMatchObject({ kind: 'city', countryCode: undefined });
  });
  it('knows other spellings of a city', () => {
    expect(parsePlace('Bangalore, India').names).toContain('bengaluru');
    expect(parsePlace('Navi Mumbai, India').names).toContain('new mumbai');
  });
});

describe('listingMatchesPlace: a city', () => {
  it('accepts a listing that names the city', () => {
    expect(listingMatchesPlace(navi, listing('Import Manager - ABC Logistics - Navi Mumbai'))).toBe(true);
    expect(listingMatchesPlace(navi, listing('Import Manager', 'Vashi, Navi Mumbai, Maharashtra'))).toBe(true);
    expect(listingMatchesPlace(dubai, listing('Supply Chain Manager', 'Dubai, UAE. Full time'))).toBe(true);
  });
  it('rejects listings from other places in the same country (Kerala for Navi Mumbai)', () => {
    expect(listingMatchesPlace(navi, listing('Import Manager - Kochi, Kerala', 'Kochi, Kerala, India'))).toBe(false);
    expect(listingMatchesPlace(navi, listing('Import Manager - Pune', 'Pune, Maharashtra, India'))).toBe(false);
  });
  it('rejects listings from another country (South Africa for Dubai)', () => {
    expect(listingMatchesPlace(dubai, listing('Logistics Lead - Cape Town, South Africa', 'Cape Town'))).toBe(false);
    expect(listingMatchesPlace(dubai, listing('Logistics Lead - Johannesburg', 'South Africa'))).toBe(false);
  });
  it('rejects a foreign job that only mentions the city in passing in its title or link', () => {
    expect(listingMatchesPlace(dubai, listing('Logistics Lead - Cape Town, South Africa', 'Occasional travel to Dubai'))).toBe(false);
  });
  it('allows multi-office postings where the other country is named only in the snippet', () => {
    expect(listingMatchesPlace(dubai, listing('Sales Manager - Dubai', 'Dubai office. Reports to Riyadh, Saudi Arabia'))).toBe(true);
  });
  it('matches the city by its other spelling and ignores accents and case', () => {
    expect(listingMatchesPlace(parsePlace('Bangalore, India'), listing('Planner - BENGALURU'))).toBe(true);
    expect(listingMatchesPlace(parsePlace('Munich, Germany'), listing('Planner - München'))).toBe(true);
  });
  it('matches whole words only', () => {
    expect(listingMatchesPlace(parsePlace('Pune, India'), listing('Operations Manager - Punekar Logistics'))).toBe(false);
  });
  it('does not take the city from page navigation when the snippet already describes the listing', () => {
    const snippet = 'Import Manager role at ABC Logistics. Responsibilities include customs clearance, vendor management and freight planning.';
    expect(listingMatchesPlace(navi, { title: 'Import Manager', url: 'https://x.com/job/1', snippet, fallback: 'Jobs in Navi Mumbai, Pune, Delhi' })).toBe(false);
  });
  it('uses the start of the page only when the snippet is nearly empty', () => {
    expect(listingMatchesPlace(navi, { title: 'Import Manager', url: 'https://x.com/job/1', snippet: '', fallback: 'Location: Navi Mumbai' })).toBe(true);
  });
  it('reads the place from the link too', () => {
    expect(listingMatchesPlace(navi, listing('Import Manager', '', 'https://www.naukri.com/job-listings-import-manager-abc-navi-mumbai-123456'))).toBe(true);
  });
});

describe('listingMatchesPlace: a country', () => {
  const india = parsePlace('India');
  it('accepts a listing that names the country, or no other country', () => {
    expect(listingMatchesPlace(india, listing('Planner - Pune', 'Pune, Maharashtra'))).toBe(true);
    expect(listingMatchesPlace(india, listing('Planner', 'India'))).toBe(true);
  });
  it('rejects a listing that names a different country', () => {
    expect(listingMatchesPlace(india, listing('Planner - Johannesburg, South Africa'))).toBe(false);
  });
  it('does not treat words that are also names (Georgia, Jordan) as a different country', () => {
    expect(listingMatchesPlace(india, listing('Planner for Jordan Brands - Pune'))).toBe(true);
  });
});

describe('listingMatchesAnyPlace', () => {
  it('passes when any selected place matches, and when none is selected', () => {
    expect(listingMatchesAnyPlace([navi, dubai], listing('Planner - Dubai'))).toBe(true);
    expect(listingMatchesAnyPlace([navi, dubai], listing('Planner - Berlin'))).toBe(false);
    expect(listingMatchesAnyPlace([], listing('Planner - Berlin'))).toBe(true);
  });
  it('lets remote listings through only when remote work was asked for', () => {
    expect(listingMatchesAnyPlace([navi], listing('Planner - Remote'), false)).toBe(false);
    expect(listingMatchesAnyPlace([navi], listing('Planner - Remote'), true)).toBe(true);
  });
});
