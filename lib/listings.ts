// Tells a single job vacancy apart from search pages, category pages and "15,000 vacancies" pages, and turns a page
// title into "Role — Company". Pure and dependency-free, shared by the search function, the browser and the tests.

// Titles that describe many jobs, or something that is not a vacancy.
const BULK_TITLE: RegExp[] = [
  // "15,000 vacancies", "1,200+ jobs", "500 Import Manager jobs". Small numbers are left alone ("2 openings" can be one posting).
  /\b(?:\d{1,3}(?:,\d{3})+|\d{3,}|\d{2,}\+)\+?\s*k?\s*(?:open\s+|new\s+|latest\s+|current\s+|active\s+)?(?:[\w&/+-]+\s+){0,3}(?:jobs?|vacanc(?:y|ies)|openings?|positions|opportunities|roles|listings)\b/i,
  /\b(?:jobs|vacancies|openings|positions|opportunities)\s+(?:in|near|at|for|available)\b/i,
  /\b(?:job|career)\s+(?:vacancies|openings|listings|search|alerts?|opportunities)\b/i,
  /\bsearch\s+results?\b/i,
  /\b(?:browse|explore|find|search)\s+(?:all\s+|the\s+latest\s+|latest\s+)?(?:\d+\s+)?jobs?\b/i,
  /\b(?:latest|top|best|new)\s+(?:\d+\s+)?(?:[\w&/+-]+\s+){0,2}(?:jobs|vacancies)\b/i,
  /\b(?:salary|salaries|interview questions|employee reviews|company reviews|company profile|career advice|resume (?:samples?|examples?))\b/i,
  /^\W*(?:jobs|vacancies|careers?|search jobs?|job search)\b/i,
  /\bcareers?\s+(?:at|with)\b/i,
  /^\W*working\s+(?:at|for)\b/i,
];

// Link shapes of index pages.
const INDEX_URL: RegExp[] = [
  /-jobs?-in-/i,
  /\/jobs?-in-/i,
  /-jobs?\.html?$/i,
  /-(?:jobs|vacancies)\/?$/i,
  /\/(?:jobs|vacancies|careers|openings)\/?$/i,
  /\/(?:jobs?|vacancies)\/(?:search|category|categories|collections?|location|locations|city|cities|browse|alerts?)(?:\/|$|\?)/i,
  /\/(?:search|results|browse|salar(?:y|ies)|reviews?|interviews?|companies|company|cmp|employers?|career-advice|blog|articles?|tags?|alerts?)(?:\/|$|\?)/i,
  /[?&](?:q|query|keywords?|searchtext|what|where|l)=/i,
];

// Link shapes that name one specific posting. These win over the index shapes below.
const STRONG_DETAIL_URL: RegExp[] = [
  /\/jobs\/view\//i,
  /\/viewjob\b/i,
  /\/rc\/clk\b/i,
  /[?&](?:jk|jobid|job_id|jid|gh_jid|jvid|jl)=/i,
  /\/job-listings?[-/]/i,
];

// Link shapes that usually, but not always, name one posting.
const DETAIL_URL: RegExp[] = [
  /\/job-openings?\//i,
  /\/(?:job|jobs|vacancy|vacancies|position|positions|opening|openings|posting|postings|requisition|jobdetail|job-detail|jobdetails|job-details|jobad|detail|details)\/[^/?#]+/i,
  /\/(?:j|o|p)\/[^/?#]{4,}/i,
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  /[-_/]\d{5,}(?:[-_/.?]|$)/,
];

export type ListingVerdict = { ok: true } | { ok: false; reason: 'bulk-title' | 'index-page' | 'not-a-vacancy' };

/**
 * Decides whether a search result is one specific vacancy. Conservative: a page is accepted only when its link
 * looks like a single posting, so category and "N vacancies" pages are not shown as jobs.
 */
export function classifyListing(input: { url: string; title: string }): ListingVerdict {
  let path = '';
  let search = '';
  try {
    const parsed = new URL(input.url);
    path = decodeURIComponent(parsed.pathname);
    search = parsed.search;
  } catch {
    return { ok: false, reason: 'not-a-vacancy' };
  }
  const target = `${path}${search}`;
  const title = input.title.trim();

  if (!title || BULK_TITLE.some((pattern) => pattern.test(title))) return { ok: false, reason: 'bulk-title' };
  if (/srch_/i.test(target)) return { ok: false, reason: 'index-page' };
  if (STRONG_DETAIL_URL.some((pattern) => pattern.test(target))) return { ok: true };
  if (INDEX_URL.some((pattern) => pattern.test(target))) return { ok: false, reason: 'index-page' };
  if (DETAIL_URL.some((pattern) => pattern.test(target))) return { ok: true };

  // Unknown link shape: accept only a long, specific last segment such as /senior-import-manager-mumbai-ab12cd.
  const segments = path.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  if (segments.length >= 2 && last.length >= 14 && last.includes('-') && /\d/.test(last)) return { ok: true };
  return { ok: false, reason: 'not-a-vacancy' };
}

export const isIndividualVacancy = (input: { url: string; title: string }): boolean => classifyListing(input).ok;

// ---- titles ------------------------------------------------------------------------------------------------

const SITE_SUFFIX = /\s*[|·•]\s*[^|·•]*$|\s+[-–—]\s+(?:indeed(?:\.com)?|linkedin|glassdoor|naukri(?:\.com)?|monster|ziprecruiter|bayt(?:\.com)?|foundit|simplyhired|reed(?:\.co\.uk)?|seek|totaljobs|jooble|adzuna|talent\.com|careerjet)\b.*$/i;
const YEARS = /\b\d+\s*(?:to|-|–)\s*\d+\s*(?:years?|yrs?)\b|\b\d+\+?\s*(?:years?|yrs?)\b/i;

const hostOf = (url: string): string => { try { return new URL(url).hostname; } catch { return ''; } };
const tidy = (value: string): string => value.replace(/\s+/g, ' ').replace(/^[\s\-–—|:,]+|[\s\-–—|:,]+$/g, '').trim();
const clip = (value: string, max = 110): string => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

/** True when a dash-separated part is probably a place, a salary or an experience range, not a company. */
function looksLikeNotACompany(part: string, places: string[]): boolean {
  const lower = part.toLowerCase();
  if (part.includes(',') || YEARS.test(part) || /^\d/.test(part) || /\b(?:full|part)[- ]time\b|\bcontract\b|\bremote\b|\bsalary\b/i.test(part)) return true;
  return places.some((place) => {
    const city = place.split(',')[0].trim().toLowerCase();
    return city.length > 1 && lower.includes(city);
  });
}

/**
 * Turns a page title into "Role — Company" when it can: "Acme hiring Import Manager in Mumbai | LinkedIn",
 * "Import Manager Job in Mumbai at Acme | Glassdoor", "Import Manager - Acme Logistics - Mumbai - Indeed.com".
 * Falls back to the cleaned title when no company is found.
 */
export function describeListing(rawTitle: string, places: string[] = [], url = ''): { role: string; company: string; title: string } {
  let text = tidy(rawTitle.replace(/^job application for\s+/i, '').replace(/^(?:job opening|vacancy|we are hiring|hiring)\s*[:\-–—]\s*/i, ''));
  text = tidy(text.replace(SITE_SUFFIX, ''));
  let role = text;
  let company = '';

  let match = /^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+[^|]+)?$/i.exec(text);
  if (match) {
    company = match[1];
    role = match[2];
  } else if ((match = /^(.+?)\s+jobs?\s+in\s+.+?\s+at\s+(.+)$/i.exec(text))) {
    role = match[1];
    company = match[2];
  } else if ((match = /^(.+?)\s+(?:at|@)\s+(.+)$/i.exec(text))) {
    role = match[1];
    company = match[2].replace(/\s+in\s+.+$/i, '');
  } else {
    const parts = text.split(/\s+[-–—|]\s+/).map(tidy).filter(Boolean);
    if (parts.length >= 2) {
      // Lever pages are titled "Company - Role"; most other sites put the role first.
      const companyFirst = /(?:^|\.)lever\.co$/i.test(hostOf(url));
      role = companyFirst ? parts.slice(1).join(' - ') : parts[0];
      company = companyFirst ? parts[0] : parts.slice(1).find((part) => !looksLikeNotACompany(part, places)) ?? '';
    }
  }

  role = clip(tidy(role.replace(/\s+jobs?\s+in\s+.+$/i, '').replace(/\s+in\s+[A-Z][\w\s,.-]+$/, (suffix) => (places.some((place) => suffix.toLowerCase().includes(place.split(',')[0].trim().toLowerCase())) ? '' : suffix))));
  company = clip(tidy(company.replace(/\s+[-–—|]\s+.*$/, '')), 60);
  if (!role) role = clip(text);
  if (company && company.toLowerCase() === role.toLowerCase()) company = '';
  return { role, company, title: company ? `${role} — ${company}` : role };
}

// ---- keys ---------------------------------------------------------------------------------------------------

const ID_PARAMS = ['jk', 'jobid', 'job_id', 'jid', 'gh_jid', 'jvid', 'jl', 'id'];

/** A stable key for "the same posting", used to remove duplicates and to avoid showing a job twice across batches. */
export function listingKey(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    const linkedin = /\/jobs\/view\/(?:[^/]*-)?(\d{6,})/.exec(path);
    if (host.endsWith('linkedin.com') && linkedin) return `linkedin:${linkedin[1]}`;
    const keep = ID_PARAMS.map((name) => [name, parsed.searchParams.get(name)] as const).filter(([, value]) => value);
    if (host.endsWith('indeed.com') && parsed.searchParams.get('jk')) return `indeed:${parsed.searchParams.get('jk')}`;
    const query = keep.map(([name, value]) => `${name}=${value}`).join('&');
    return `${host}${path}${query ? `?${query}` : ''}`;
  } catch {
    return url.toLowerCase();
  }
}
