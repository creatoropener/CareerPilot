// Worldwide place search for the location picker.
// Data: about 23,600 places with 15,000+ inhabitants plus every country, from GeoNames (CC BY 4.0).
// Smaller towns, regions or anything else can still be added as a custom entry.

export const MAX_LOCATIONS = 5;
export const MAX_LOCATION_LENGTH = 100;

export interface PlaceData {
  countries: string[];
  names: string[];
  country: number[];
}

export interface PlaceSuggestion {
  label: string;
  kind: 'city' | 'country' | 'custom';
  hint: string;
}

export interface PlaceIndex {
  countries: { code: string; name: string; norm: string }[];
  cities: { name: string; norm: string; country: number }[];
}

export const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[’'`.]/g, '')
  .replace(/[-_/]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Common alternative spellings, mapped to the name used in the data. Keys are normalised.
const CITY_ALIASES: Record<string, string> = {
  bangalore: 'bengaluru', bombay: 'mumbai', madras: 'chennai', calcutta: 'kolkata', gurugram: 'gurgaon',
  poona: 'pune', cochin: 'kochi', trivandrum: 'thiruvananthapuram', banaras: 'varanasi', benares: 'varanasi',
  baroda: 'vadodara', mysuru: 'mysore', kiev: 'kyiv', peking: 'beijing', saigon: 'ho chi minh city',
  rangoon: 'yangon', nyc: 'new york city', sf: 'san francisco', 'new york': 'new york city',
  'washington dc': 'washington, dc', 'mexico df': 'mexico city', 'ciudad de mexico': 'mexico city',
  cologne: 'koln', 'munchen': 'munich', 'wien': 'vienna', 'praha': 'prague',
  'roma': 'rome', 'milano': 'milan', 'napoli': 'naples', 'firenze': 'florence', 'lisboa': 'lisbon',
  'moskva': 'moscow', 'warszawa': 'warsaw', 'bruxelles': 'brussels', 'kobenhavn': 'copenhagen', gothenburg: 'goteborg',
};

// Country aliases keyed by normalised text, mapped to ISO codes.
const COUNTRY_ALIASES: Record<string, string> = {
  uk: 'GB', 'u k': 'GB', britain: 'GB', 'great britain': 'GB', england: 'GB', scotland: 'GB', wales: 'GB',
  usa: 'US', 'u s a': 'US', us: 'US', america: 'US', 'united states of america': 'US',
  uae: 'AE', emirates: 'AE', holland: 'NL', korea: 'KR', 'south korea': 'KR', russia: 'RU', vietnam: 'VN', turkey: 'TR', czechia: 'CZ',
};

let displayNames: Intl.DisplayNames | null | undefined;
export function countryName(code: string): string {
  if (displayNames === undefined) {
    try { displayNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { displayNames = null; }
  }
  try { return displayNames?.of(code) ?? code; } catch { return code; }
}

export function buildIndex(data: PlaceData): PlaceIndex {
  const countries = data.countries.map((code) => {
    const name = countryName(code);
    return { code, name, norm: normalize(name) };
  });
  const cities = data.names.map((name, index) => ({ name, norm: normalize(name), country: data.country[index] }));
  return { countries, cities };
}

let cached: Promise<PlaceIndex> | null = null;
/** Loads the place data on first use (it is a separate chunk, about 170 KB compressed). */
export function loadPlaces(): Promise<PlaceIndex> {
  cached ??= import('../data/places.json').then((module) => buildIndex(module.default as PlaceData));
  return cached;
}

export const cleanCustomLocation = (value: string): string => value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LOCATION_LENGTH);

function rank(norm: string, query: string): number {
  if (norm === query) return 0;
  if (norm.startsWith(query)) return 1;
  if (norm.split(' ').some((word) => word.startsWith(query))) return 2;
  return norm.includes(query) ? 3 : 99;
}

/**
 * Finds places matching what the user typed. Understands "city", "country" and "city, country"
 * (the country part may be a name prefix or an ISO code). Larger cities come first within a rank.
 */
export function searchPlaces(index: PlaceIndex, input: string, limit = 30): PlaceSuggestion[] {
  const text = cleanCustomLocation(input);
  if (text.length < 2) return [];
  const [cityPart, ...rest] = text.split(',');
  const countryPart = normalize(rest.join(' '));
  const query = normalize(cityPart);
  if (!query) return [];
  const aliasTarget = CITY_ALIASES[query];
  const cityQuery = aliasTarget ? normalize(aliasTarget) : query;

  const results: PlaceSuggestion[] = [];

  // Countries (only when the user did not type a "city, country" pair).
  if (!countryPart) {
    const aliasCode = COUNTRY_ALIASES[query];
    const matches = index.countries
      .map((country) => ({ country, score: country.code === aliasCode ? 0 : country.code.toLowerCase() === query ? 0 : rank(country.norm, query) }))
      .filter((entry) => entry.score < 99)
      .sort((a, b) => a.score - b.score || a.country.name.localeCompare(b.country.name))
      .slice(0, 5);
    for (const { country } of matches) results.push({ label: country.name, kind: 'country', hint: 'Whole country' });
  }

  const buckets: PlaceSuggestion[][] = [[], [], [], []];
  for (const city of index.cities) {
    const country = index.countries[city.country];
    if (countryPart && !(country.norm.startsWith(countryPart) || country.code.toLowerCase() === countryPart)) continue;
    const score = rank(city.norm, cityQuery);
    if (score === 99) continue;
    buckets[score].push({ label: `${city.name}, ${country.name}`, kind: 'city', hint: 'City' });
    if (buckets[0].length + buckets[1].length >= limit * 2) break; // data is ordered by population: enough good hits
  }
  for (const bucket of buckets) for (const item of bucket) {
    if (results.length >= limit) break;
    results.push(item);
  }
  return results;
}

/** Splits a legacy single-string location ("Mumbai, India; Pune") into separate entries. */
export function splitLegacyLocation(value: string): string[] {
  return value.split(/[;\n|]/).map(cleanCustomLocation).filter(Boolean).slice(0, MAX_LOCATIONS);
}
