// Posting-date logic for the search function. Pure and dependency-free so it is easy to test.
// Rule: a listing is only shown when we can verify it was posted inside the chosen window.
// If no date can be found, the listing is excluded (we never guess).

export type TimeWindowId = '1d' | '1w' | '2w' | '3w' | '4w';

export const WINDOW_DAYS: Record<TimeWindowId, number> = { '1d': 1, '1w': 7, '2w': 14, '3w': 21, '4w': 28 };

export const isTimeWindowId = (value: unknown): value is TimeWindowId =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(WINDOW_DAYS, value);

const DAY_MS = 86_400_000;
const UNIT_MS: Record<string, number> = {
  minute: 60_000, min: 60_000, hour: 3_600_000, hr: 3_600_000, day: DAY_MS, week: 7 * DAY_MS, wk: 7 * DAY_MS, month: 30 * DAY_MS,
  // compact units used by job sites: 5h, 3d, 2w, 1mo
  h: 3_600_000, d: DAY_MS, w: 7 * DAY_MS, mo: 30 * DAY_MS,
};

export interface PostedDate {
  date: Date;
  source: 'api' | 'structured-data' | 'text';
}

// Always interpret dates in UTC so results do not depend on the server's timezone.
const parseUtc = (value: string): Date => {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(text); // date-only ISO is already UTC
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(text)) return new Date(`${text}Z`); // ISO without zone: assume UTC
  if (/(?:Z|[+-]\d{2}:?\d{2}|UTC|GMT)$/i.test(text)) return new Date(text);
  return new Date(`${text} UTC`);
};

const validDate = (value: string, now: Date): Date | null => {
  const date = parseUtc(value);
  if (Number.isNaN(date.getTime())) return null;
  // A "posted" date in the future is not credible.
  if (date.getTime() > now.getTime() + DAY_MS) return null;
  return date;
};

const POSTED_ABSOLUTE = /\b(?:date\s+posted|posted|published|listed)(?:\s+on)?\s*[:\-]?\s*((?:\d{1,2}\s+)?[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4}|\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?)/gi;
// "3 days ago", "30+ days ago", "2 wks ago"
const RELATIVE = /\b(\d{1,3})(\+)?\s*(minute|min|hour|hr|day|week|wk|month)s?\s+ago\b/gi;
// "a month ago", "an hour ago", "over a month ago" / "more than a week ago" (at least that long, so read strictly)
const RELATIVE_WORD = /\b(?:(over|more\s+than)\s+)?(?:a|an|one)\s+(minute|hour|day|week|month)\s+ago\b/gi;
// Compact ages such as "3d", "5h", "2w", "1mo" and "30d+", optionally followed by "ago". They are lower-case, stand alone
// (start of a line, after "posted", or after a separator such as | or a middle dot) and end the phrase, so "3D printing
// technician", "5w-40" and "2d, 3d graphics" are not read as ages.
const COMPACT = /(?:^|[|·•(–—]\s*|\b(?:[Rr]e)?(?:[Pp]osted|[Pp]ublished|[Ll]isted|[Aa]ctive)\s*[:\-]?\s*)(\d{1,3})(mo|h|d|w)(\+)?(?:\s+ago)?(?=\s*(?:$|[|·•).;–—]))/gm;
// Only these phrases count as an explicit statement of the posting date; a bare "2 weeks ago" can be a review or a closing date.
const EXPLICIT = String.raw`\b(?:re)?(?:posted|published|listed)\s*(?:on|:|-)?\s*`;
const EXPLICIT_RELATIVE = new RegExp(`${EXPLICIT}(\\d{1,3})(\\+)?\\s*(minute|min|hour|hr|day|week|wk|month)s?\\s+ago\\b`, 'gi');
const EXPLICIT_RELATIVE_WORD = new RegExp(`${EXPLICIT}(?:(over|more\\s+than)\\s+)?(?:a|an|one)\\s+(minute|hour|day|week|month)\\s+ago\\b`, 'gi');
const EXPLICIT_COMPACT = new RegExp(`${EXPLICIT}(\\d{1,3})(mo|h|d|w)(\\+)?(?:\\s+ago)?(?=\\s*(?:$|[|·•).;–—]))`, 'gim');

const ageBefore = (now: Date, amount: number, unit: string, extraMs = 0): Date =>
  new Date(now.getTime() - amount * UNIT_MS[unit.toLowerCase()] - extraMs);

/** How much older "30d+" or "over a month" is taken to be than the stated amount: one more unit, but at most a day. */
const atLeast = (unit: string): number => Math.min(UNIT_MS[unit.toLowerCase()], DAY_MS);

/**
 * Posting dates stated as an age: "3 days ago", "a month ago", "30+ days ago", "3d", "30d+".
 * A "+" or "over" means "at least this long", so one unit is added: ambiguity can only make us stricter.
 */
function relativeDates(text: string, now: Date, patterns: { numeric: RegExp; word: RegExp; compact: RegExp }): Date[] {
  const dates: Date[] = [];
  for (const match of text.matchAll(patterns.numeric)) {
    dates.push(ageBefore(now, Number(match[1]) + (match[2] ? 1 : 0), match[3]));
  }
  for (const match of text.matchAll(patterns.word)) {
    dates.push(ageBefore(now, 1, match[2], match[1] ? atLeast(match[2]) : 0)); // "over a month ago": a little older than a month
  }
  for (const match of text.matchAll(patterns.compact)) {
    dates.push(ageBefore(now, Number(match[1]), match[2], match[3] ? atLeast(match[2]) : 0)); // groups: amount, unit, optional "+"
  }
  return dates;
}

const oldest = (dates: Date[]): Date | null =>
  dates.length ? dates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b)) : null;

/** Dates the page text states outright ("Posted 20 days ago", "Posted on 21 Oct 2026", "Posted 3d"): never a review or closing date. */
function explicitTextDates(text: string, now: Date): Date[] {
  const dates = relativeDates(text, now, { numeric: EXPLICIT_RELATIVE, word: EXPLICIT_RELATIVE_WORD, compact: EXPLICIT_COMPACT });
  for (const match of text.matchAll(POSTED_ABSOLUTE)) {
    const date = validDate(match[1].replace(/(\d)(st|nd|rd|th)\b/i, '$1'), now);
    if (date) dates.push(date);
  }
  if (/\b(posted|published)\s+(just\s+now|today)\b|\bjust\s+posted\b/i.test(text)) dates.push(now);
  if (/\b(posted|published)\s+yesterday\b/i.test(text)) dates.push(new Date(now.getTime() - DAY_MS));
  return dates;
}

/**
 * Finds the posting date of a search result. Order of trust:
 * 1. the search provider's published_date, 2. schema.org JobPosting "datePosted" in page content,
 * 3. explicit text such as "Posted 3 days ago", "Posted a month ago", "Posted 30d+" or "Posted on 21 Oct 2026".
 * For relative phrases the OLDEST match wins, so ambiguity can only make us stricter.
 * A provider date is not final: providers often report when a page was crawled or refreshed. When the page itself says
 * it was posted earlier (more than a day before the provider date), the page's own statement wins, so an old listing
 * is never shown as new.
 */
export function findPostedDate(input: { publishedDate?: string | null; text: string }, now = new Date()): PostedDate | null {
  const text = input.text;
  const provider = input.publishedDate ? validDate(input.publishedDate, now) : null;

  const structuredMatch = /"datePosted"\s*:\s*"([^"]{6,40})"/i.exec(text);
  const structured = structuredMatch ? validDate(structuredMatch[1], now) : null;

  if (provider) {
    const statedByPage: PostedDate[] = [];
    if (structured) statedByPage.push({ date: structured, source: 'structured-data' });
    const explicit = oldest(explicitTextDates(text, now));
    if (explicit) statedByPage.push({ date: explicit, source: 'text' });
    const earliest = statedByPage.reduce<PostedDate | null>((a, b) => (!a || b.date.getTime() < a.date.getTime() ? b : a), null);
    if (earliest && provider.getTime() - earliest.date.getTime() > DAY_MS) return earliest;
    return { date: provider, source: 'api' };
  }

  if (structured) return { date: structured, source: 'structured-data' };

  const candidates: Date[] = [];
  for (const match of text.matchAll(POSTED_ABSOLUTE)) {
    const date = validDate(match[1].replace(/(\d)(st|nd|rd|th)\b/i, '$1'), now);
    if (date) candidates.push(date);
  }
  candidates.push(...relativeDates(text, now, { numeric: RELATIVE, word: RELATIVE_WORD, compact: COMPACT }));
  if (/\b(posted|published)\s+(just\s+now|today)\b|\bjust\s+posted\b/i.test(text)) candidates.push(now);
  if (/\b(posted|published)\s+yesterday\b/i.test(text)) candidates.push(new Date(now.getTime() - DAY_MS));

  const found = oldest(candidates);
  return found ? { date: found, source: 'text' } : null;
}

export function isWithinWindow(date: Date, window: TimeWindowId, now = new Date()): boolean {
  const age = now.getTime() - date.getTime();
  return age <= WINDOW_DAYS[window] * DAY_MS && age >= -DAY_MS;
}

export const toDateOnly = (date: Date): string => date.toISOString().slice(0, 10);

// ---- portal selection -------------------------------------------------------------------------

export type SourceId = 'linkedin' | 'indeed' | 'glassdoor' | 'naukri' | 'ats';

export const SOURCE_DOMAINS: Record<SourceId, string[]> = {
  linkedin: ['linkedin.com'],
  indeed: ['indeed.com'],
  glassdoor: ['glassdoor.com', 'glassdoor.co.in'],
  naukri: ['naukri.com'],
  ats: ['greenhouse.io', 'lever.co', 'myworkdayjobs.com', 'ashbyhq.com', 'smartrecruiters.com'],
};

export const isSourceId = (value: unknown): value is SourceId =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(SOURCE_DOMAINS, value);

export function hostMatches(url: string, domains: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}
