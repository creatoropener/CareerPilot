import { beforeAll, describe, expect, it } from 'vitest';
import { cleanCustomLocation, loadPlaces, normalize, searchPlaces, splitLegacyLocation, MAX_LOCATIONS } from '../src/lib/locations';
import type { PlaceIndex } from '../src/lib/locations';

let index: PlaceIndex;
beforeAll(async () => { index = await loadPlaces(); });
const labels = (query: string, limit?: number) => searchPlaces(index, query, limit).map((item) => item.label);

describe('place data', () => {
  it('covers the world: many places and every country', () => {
    expect(index.cities.length).toBeGreaterThan(20_000);
    expect(index.countries.length).toBeGreaterThanOrEqual(240);
    const countries = new Set(index.cities.map((city) => city.country));
    expect(countries.size).toBeGreaterThan(200);
  });
  it('has readable country names', () => {
    const names = index.countries.map((country) => country.name);
    for (const name of ['India', 'United States', 'United Kingdom', 'United Arab Emirates', 'Germany', 'Australia', 'Brazil', 'Nigeria', 'Japan']) {
      expect(names).toContain(name);
    }
  });
});

describe('searchPlaces', () => {
  it('finds major cities on every continent with their country', () => {
    expect(labels('mumbai')[0]).toBe('Mumbai, India');
    expect(labels('tokyo')).toContain('Tokyo, Japan');
    expect(labels('lagos')).toContain('Lagos, Nigeria');
    expect(labels('sao paulo')).toContain('São Paulo, Brazil');
    expect(labels('sydney')).toContain('Sydney, Australia');
    expect(labels('toronto')).toContain('Toronto, Canada');
    expect(labels('dubai')).toContain('Dubai, United Arab Emirates');
  });
  it('ignores accents and case', () => {
    expect(labels('ZURICH')).toContain('Zürich, Switzerland');
    expect(labels('munchen')[0]).toBe('Munich, Germany');
  });
  it('understands common alternative names', () => {
    expect(labels('bangalore')[0]).toBe('Bengaluru, India');
    expect(labels('bombay')[0]).toBe('Mumbai, India');
    expect(labels('gurugram')[0]).toBe('Gurgaon, India');
    expect(labels('nyc')[0]).toBe('New York City, United States');
    expect(labels('kiev')[0]).toBe('Kyiv, Ukraine');
  });
  it('lists countries, including via short names', () => {
    expect(labels('india')[0]).toBe('India');
    expect(labels('uae')[0]).toBe('United Arab Emirates');
    expect(labels('uk')[0]).toBe('United Kingdom');
    expect(labels('usa')[0]).toBe('United States');
    expect(searchPlaces(index, 'germ')[0]).toMatchObject({ label: 'Germany', kind: 'country' });
  });
  it('supports "City, Country" input and disambiguates same-named cities', () => {
    const london = labels('london');
    expect(london).toContain('London, United Kingdom');
    expect(london).toContain('London, Canada');
    expect(labels('london, canada')).toEqual(['London, Canada']);
    expect(labels('hyderabad, pak')).toEqual(['Hyderabad, Pakistan']);
    expect(labels('hyderabad, in')).toEqual(['Hyderabad, India']);
  });
  it('ranks larger cities first within a match type', () => {
    const results = labels('san');
    expect(results.length).toBeGreaterThan(5);
    expect(results.length).toBeLessThanOrEqual(30);
  });
  it('returns nothing for empty or one-letter input and respects the limit', () => {
    expect(labels('')).toEqual([]);
    expect(labels('m')).toEqual([]);
    expect(labels('san', 5).length).toBeLessThanOrEqual(5);
  });
  it('never returns duplicates', () => {
    const results = labels('new');
    expect(new Set(results).size).toBe(results.length);
  });
});

describe('helpers', () => {
  it('normalises text', () => {
    expect(normalize('  Zürich  ')).toBe('zurich');
    expect(normalize("St. John's")).toBe('st johns');
  });
  it('cleans custom entries', () => {
    expect(cleanCustomLocation('  Hybrid \n\t  Pune  ')).toBe('Hybrid Pune');
    expect(cleanCustomLocation('x'.repeat(300)).length).toBe(100);
  });
  it('splits older single-string locations and caps the count', () => {
    expect(splitLegacyLocation('Mumbai, India; Pune\nDubai')).toEqual(['Mumbai, India', 'Pune', 'Dubai']);
    expect(splitLegacyLocation('a1;b2;c3;d4;e5;f6;g7')).toHaveLength(MAX_LOCATIONS);
  });
});
