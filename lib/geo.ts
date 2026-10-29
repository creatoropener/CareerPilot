// Place checking for search results. Pure and dependency-free, shared by the search function and the tests.
//
// Why this exists: the search provider treats the place only as a hint, so it can return a listing from another
// city or country. Every result is therefore checked against the places the user selected, using the text
// that describes the listing (title, link, snippet), never the whole page, because page navigation often lists
// dozens of unrelated cities.

const CODES = ('AD AE AF AG AI AL AM AO AR AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DO DZ EC EE EG ER ES ET FI FJ FR GA GB GE GH GM GN GQ GR GT GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KP KR KW KZ LA LB LK LR LS LT LU LV LY MA MC MD ME MG MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NZ OM PA PE PG PH PK PL PR PS PT PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SN SO SR SS SV SY SZ TD TG TH TJ TL TM TN TR TT TW TZ UA UG US UY UZ VE VN YE ZA ZM ZW').split(' ');

/** Extra spellings people and listings use. Keys are ISO codes. */
const COUNTRY_ALIASES: Record<string, string[]> = {
  AE: ['uae', 'u a e', 'emirates'],
  GB: ['uk', 'u k', 'britain', 'great britain', 'england', 'scotland', 'wales', 'northern ireland'],
  US: ['usa', 'u s a', 'u s', 'united states of america'],
  KR: ['korea', 'south korea'],
  RU: ['russia'],
  VN: ['vietnam'],
  TR: ['turkey', 'turkiye'],
  CZ: ['czech republic'],
  NL: ['holland', 'the netherlands'],
  CD: ['drc', 'dr congo'],
  CI: ['ivory coast'],
  MM: ['burma'],
  SZ: ['swaziland'],
  HK: ['hong kong sar'],
};

// Names that are also common words, first names or US states: never used to decide that a listing is "elsewhere".
const AMBIGUOUS = new Set(['georgia', 'jersey', 'chad', 'jordan', 'mali', 'niger', 'guinea', 'lebanon']);

/** Lower-case, accent-free text in which every run of other characters is a single space. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Text prepared for whole-word phrase checks with {@link mentions}. */
export const padded = (value: string): string => ` ${normalizeText(value)} `;

export const mentions = (paddedText: string, phrase: string): boolean => {
  const normalized = normalizeText(phrase);
  return normalized.length > 0 && paddedText.includes(` ${normalized} `);
};

// Groups of spellings of the same city.
const CITY_GROUPS: string[][] = [
  ['bengaluru', 'bangalore'], ['mumbai', 'bombay'], ['navi mumbai', 'new mumbai'], ['kolkata', 'calcutta'],
  ['chennai', 'madras'], ['gurgaon', 'gurugram'], ['pune', 'poona'], ['kochi', 'cochin'],
  ['thiruvananthapuram', 'trivandrum'], ['delhi', 'new delhi'], ['vadodara', 'baroda'], ['mysore', 'mysuru'],
  ['new york city', 'new york', 'nyc'], ['ho chi minh city', 'saigon'], ['kyiv', 'kiev'], ['beijing', 'peking'],
  ['munich', 'munchen'], ['vienna', 'wien'], ['cologne', 'koln'], ['prague', 'praha'], ['warsaw', 'warszawa'],
  ['rome', 'roma'], ['milan', 'milano'], ['lisbon', 'lisboa'], ['brussels', 'bruxelles'], ['copenhagen', 'kobenhavn'],
  ['gothenburg', 'goteborg'], ['yangon', 'rangoon'], ['mexico city', 'ciudad de mexico'], ['abu dhabi', 'abudhabi'],
];

interface CountryEntry { code: string; names: string[] }
let countries: CountryEntry[] | null = null;

function countryTable(): CountryEntry[] {
  if (countries) return countries;
  let display: Intl.DisplayNames | null = null;
  try { display = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { display = null; }
  countries = CODES.map((code) => {
    let name = '';
    try { name = display?.of(code) ?? ''; } catch { name = ''; }
    const names = [...new Set([name, ...(COUNTRY_ALIASES[code] ?? [])].map(normalizeText).filter((entry) => entry.length >= 2))];
    return { code, names };
  }).filter((entry) => entry.names.length > 0);
  return countries;
}

function findCountryCode(label: string): string | undefined {
  const normalized = normalizeText(label);
  return countryTable().find((entry) => entry.names.includes(normalized))?.code;
}

export interface PlaceSpec {
  label: string;
  kind: 'city' | 'country';
  /** Normalised phrases that identify the place itself (a city and its other spellings, or a country and its aliases). */
  names: string[];
  /** ISO code of the place's country, when known. */
  countryCode?: string;
}

/** Understands "Mumbai, India", "Navi Mumbai", "Dubai, United Arab Emirates", "India" and free text. */
export function parsePlace(label: string): PlaceSpec {
  const [first, ...rest] = label.split(',');
  const city = normalizeText(first);
  const countryCode = rest.length ? findCountryCode(rest[rest.length - 1]) : undefined;

  if (rest.length === 0) {
    const code = findCountryCode(first);
    if (code) {
      const entry = countryTable().find((item) => item.code === code);
      return { label, kind: 'country', names: entry?.names ?? [city], countryCode: code };
    }
  }

  const group = CITY_GROUPS.find((names) => names.includes(city));
  return { label, kind: 'city', names: group ?? [city], countryCode };
}

function mentionsCountry(text: string, code: string): boolean {
  const entry = countryTable().find((item) => item.code === code);
  return !!entry && entry.names.some((name) => text.includes(` ${name} `));
}

/** A country other than `code` named in the text. Names that are also everyday words are ignored. */
function mentionsOtherCountry(text: string, code: string | undefined): boolean {
  return countryTable().some((entry) =>
    entry.code !== code
    && entry.names.some((name) => !AMBIGUOUS.has(name) && text.includes(` ${name} `)));
}

export interface ListingText {
  /** Title and link of the listing: the strongest signal of where it is. */
  title: string;
  url: string;
  /** The search snippet. */
  snippet: string;
  /** Start of the page text. Only used when the snippet is too short to say anything. */
  fallback?: string;
}

/**
 * True when the listing is for the given place.
 * - A city must be named in the listing text (title, link or snippet).
 * - If the city's country is known and the listing names a different country in its title or link without ever naming
 *   the city's own country, it is rejected (a South African job that mentions Dubai). A different country named only
 *   in the snippet is allowed, because many real postings list several offices.
 * - A country is accepted when it is named, or when no other country is.
 */
export function listingMatchesPlace(spec: PlaceSpec, listing: ListingText): boolean {
  const strong = padded(`${listing.title} ${listing.url}`);
  const snippet = padded(listing.snippet);
  let text = `${strong}${snippet}`;
  if (snippet.trim().length < 80 && listing.fallback) text += padded(listing.fallback);
  const ownCountry = spec.countryCode ? mentionsCountry(text, spec.countryCode) : false;

  if (spec.kind === 'country') {
    if (ownCountry) return true;
    return !mentionsOtherCountry(text, spec.countryCode);
  }

  if (!spec.names.some((name) => text.includes(` ${name} `))) return false;
  if (spec.countryCode && !ownCountry && mentionsOtherCountry(strong, spec.countryCode)) return false;
  return true;
}

/** True when the listing fits at least one of the selected places. No selected places means no restriction. */
export function listingMatchesAnyPlace(specs: PlaceSpec[], listing: ListingText, allowRemote = false): boolean {
  if (specs.length === 0) return true;
  if (specs.some((spec) => listingMatchesPlace(spec, listing))) return true;
  return allowRemote && /\b(remote|work from home|wfh|anywhere)\b/i.test(`${listing.title} ${listing.snippet}`);
}
