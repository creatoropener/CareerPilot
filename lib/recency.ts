// Posting-date logic for the search function. Pure and dependency-free so it is easy to test.
// Rule: a listing is only shown when we can verify it was posted inside the chosen window.
// If no date can be found, the listing is excluded (we never guess).

export type TimeWindowId = '1d' | '1w' | '2w' | '3w' | '4w';

export const WINDOW_DAYS: Record<TimeWindowId, number> = { '1d': 1, '1w': 7, '2w': 14, '3w': 21, '4w': 28 };

export const isTimeWindowId = (value: unknown): value is TimeWindowId =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(WINDOW_DAYS, value);

const DAY_MS = 86_400_000;
const UNIT_MS: Record<string, number> = { minute: 60_000, hour: 3_600_000, day: DAY_MS, week: 7 * DAY_MS, month: 30 * DAY_MS };

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
const RELATIVE = /\b(\d{1,3})(\+)?\s*(minute|hour|day|week|month)s?\s+ago\b/gi;

/**
 * Finds the posting date of a search result. Order of trust:
 * 1. the search provider's published_date, 2. schema.org JobPosting "datePosted" in page content,
 * 3. explicit text such as "Posted 3 days ago" or "Posted on 21 Oct 2026".
 * For relative phrases the OLDEST match wins, so ambiguity can only make us stricter.
 */
export function findPostedDate(input: { publishedDate?: string | null; text: string }, now = new Date()): PostedDate | null {
  if (input.publishedDate) {
    const date = validDate(input.publishedDate, now);
    if (date) return { date, source: 'api' };
  }

  const structured = /"datePosted"\s*:\s*"([^"]{6,40})"/i.exec(input.text);
  if (structured) {
    const date = validDate(structured[1], now);
    if (date) return { date, source: 'structured-data' };
  }

  const candidates: Date[] = [];
  const text = input.text;
  for (const match of text.matchAll(POSTED_ABSOLUTE)) {
    const date = validDate(match[1].replace(/(\d)(st|nd|rd|th)\b/i, '$1'), now);
    if (date) candidates.push(date);
  }
  for (const match of text.matchAll(RELATIVE)) {
    const amount = Number(match[1]) + (match[2] ? 1 : 0); // "30+ days ago" means at least 30 days: be strict
    candidates.push(new Date(now.getTime() - amount * UNIT_MS[match[3].toLowerCase()]));
  }
  if (/\b(posted|published)\s+(just\s+now|today)\b|\bjust\s+posted\b/i.test(text)) candidates.push(now);
  if (/\b(posted|published)\s+yesterday\b/i.test(text)) candidates.push(new Date(now.getTime() - DAY_MS));

  if (candidates.length === 0) return null;
  const oldest = candidates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
  return { date: oldest, source: 'text' };
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
