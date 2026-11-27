// Reads the public job boards of followed companies (Greenhouse and Lever) and returns their openings as plain data.
// Unlike a web search, a board gives the real title, place and, for Lever, the date a job was created, so these
// listings are as accurate as the company's own data. Only fixed API hosts are ever contacted, and a company name can
// only be a validated board name (see companies.ts), so a pasted value cannot make the server fetch anything else.

import type { CompanyBoard } from './companies.js';
import { MAX_BOARDS_PER_SEARCH, companyId, prettifyToken } from './companies.js';
import { mentions, normalizeText, padded } from './geo.js';
import { plainText } from './text.js';

export interface BoardJob {
  /** Stable id from the board, with the company id: "greenhouse:acme:4012345". */
  id: string;
  title: string;
  company: string;
  url: string;
  /** Where the job is, as the board writes it. */
  location: string;
  team: string;
  /** When the job was first posted (ISO). null when the board does not give a posting date, so it cannot be verified. */
  postedAt: string | null;
  /** Plain-text description, when the board gave one. */
  details: string;
  board: CompanyBoard;
}

export interface FeedFilters {
  /** Target job titles. A job is kept only when its title matches one of them. */
  roles: string[];
  /** True when a job is in one of the places the user selected. */
  matchesPlace: (job: BoardJob) => boolean;
  /** Most jobs kept from one company. */
  maxPerBoard?: number;
  /** Most single-job requests (for a description or a missing date) in one search. */
  maxDetails?: number;
}

export interface FeedSummary {
  /** Boards asked for. */
  boards: number;
  ok: number;
  failed: number;
  /** Openings read in total, before any filter. */
  scanned: number;
  /** Openings kept after the title and place filters. */
  matched: number;
}

const LIST_TIMEOUT_MS = 8_000;
const DETAIL_TIMEOUT_MS = 6_000;
const MAX_BODY_CHARS = 6_000_000;
const DETAILS_CHARS = 2_500;

type FetchLike = typeof fetch;

const MIN_DATE = Date.UTC(2005, 0, 1);

/** An ISO date from a board, or null when it is missing, unreadable or not believable. */
function isoOrNull(value: unknown, now = Date.now()): string | null {
  const time = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(time) || time < MIN_DATE || time > now + 86_400_000) return null;
  return new Date(time).toISOString();
}

const text = (value: unknown, max = 200): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

const isHttpUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

async function getJson(url: string, timeoutMs: number, fetchImpl: FetchLike): Promise<unknown> {
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned ${response.status}`);
  const body = await response.text();
  if (body.length > MAX_BODY_CHARS) throw new Error('The job board response was too large to read.');
  return JSON.parse(body) as unknown;
}

// ---- Greenhouse -----------------------------------------------------------------------------------------------------

interface GreenhouseJob {
  id?: unknown; title?: unknown; absolute_url?: unknown; first_published?: unknown; company_name?: unknown;
  location?: { name?: unknown } | null; departments?: { name?: unknown }[] | null; content?: unknown;
}

const greenhouseHost = 'https://boards-api.greenhouse.io/v1/boards';

export function parseGreenhouse(payload: unknown, board: CompanyBoard): BoardJob[] {
  const jobs = (payload as { jobs?: unknown } | null)?.jobs;
  if (!Array.isArray(jobs)) return [];
  const result: BoardJob[] = [];
  for (const entry of jobs as GreenhouseJob[]) {
    if (!entry || typeof entry !== 'object') continue;
    const id = typeof entry.id === 'number' || typeof entry.id === 'string' ? String(entry.id) : '';
    const title = text(entry.title, 160);
    if (!/^\d{1,12}$/.test(id) || !title || !isHttpUrl(entry.absolute_url)) continue;
    result.push({
      id: `${companyId(board)}:${id}`,
      title,
      company: text(entry.company_name, 80) || prettifyToken(board.token),
      url: entry.absolute_url,
      location: text(entry.location?.name),
      team: text(entry.departments?.[0]?.name, 80),
      // updated_at is when the posting was last edited, not when it appeared, so it is never used as a posting date.
      postedAt: isoOrNull(entry.first_published),
      details: entry.content ? plainText(String(entry.content), DETAILS_CHARS) : '',
      board,
    });
  }
  return result;
}

/** The description (and the first-published date, when given) of one Greenhouse job. */
async function greenhouseDetail(job: BoardJob, fetchImpl: FetchLike): Promise<Pick<BoardJob, 'details' | 'postedAt'>> {
  const jobId = job.id.split(':').pop() ?? '';
  const data = await getJson(`${greenhouseHost}/${encodeURIComponent(job.board.token)}/jobs/${encodeURIComponent(jobId)}`, DETAIL_TIMEOUT_MS, fetchImpl) as GreenhouseJob;
  return {
    details: data?.content ? plainText(String(data.content), DETAILS_CHARS) : job.details,
    postedAt: job.postedAt ?? isoOrNull(data?.first_published),
  };
}

// ---- Lever ----------------------------------------------------------------------------------------------------------

interface LeverPosting {
  id?: unknown; text?: unknown; hostedUrl?: unknown; createdAt?: unknown; descriptionPlain?: unknown; additionalPlain?: unknown;
  categories?: { location?: unknown; allLocations?: unknown; team?: unknown; department?: unknown } | null;
}

export function parseLever(payload: unknown, board: CompanyBoard): BoardJob[] {
  if (!Array.isArray(payload)) return [];
  const result: BoardJob[] = [];
  for (const entry of payload as LeverPosting[]) {
    if (!entry || typeof entry !== 'object') continue;
    const id = text(entry.id, 80);
    const title = text(entry.text, 160);
    if (!id || !title || !isHttpUrl(entry.hostedUrl)) continue;
    const categories = entry.categories ?? {};
    const places = Array.isArray(categories.allLocations) ? categories.allLocations.map((place) => text(place, 80)).filter(Boolean).join('; ') : '';
    result.push({
      id: `${companyId(board)}:${id}`,
      title,
      company: prettifyToken(board.token),
      url: entry.hostedUrl,
      location: places || text(categories.location),
      team: text(categories.team, 80) || text(categories.department, 80),
      postedAt: isoOrNull(entry.createdAt),
      details: plainText([text(entry.descriptionPlain, 6000), text(entry.additionalPlain, 2000)].filter(Boolean).join('\n'), DETAILS_CHARS),
      board,
    });
  }
  return result;
}

const leverUrl = (board: CompanyBoard): string =>
  `https://${board.eu ? 'api.eu.lever.co' : 'api.lever.co'}/v0/postings/${encodeURIComponent(board.token)}?mode=json`;

// ---- shared ---------------------------------------------------------------------------------------------------------

const postedTime = (job: BoardJob): number => (job.postedAt ? Date.parse(job.postedAt) : 0);

const FILLER = new Set(['and', 'the', 'for', 'with', 'of']);

/** True when a job title fits one of the target roles: the whole role, or all its words in any order. */
export function matchesAnyRole(title: string, roles: string[]): boolean {
  const haystack = padded(title);
  return roles.some((role) => {
    if (mentions(haystack, role)) return true;
    const words = normalizeText(role).split(' ').filter((word) => word.length >= 3 && !FILLER.has(word));
    return words.length >= 2 && words.every((word) => haystack.includes(` ${word} `));
  });
}

async function readBoard(board: CompanyBoard, fetchImpl: FetchLike): Promise<{ jobs: BoardJob[] }> {
  if (board.provider === 'greenhouse') {
    const payload = await getJson(`${greenhouseHost}/${encodeURIComponent(board.token)}/jobs`, LIST_TIMEOUT_MS, fetchImpl);
    return { jobs: parseGreenhouse(payload, board) };
  }
  return { jobs: parseLever(await getJson(leverUrl(board), LIST_TIMEOUT_MS, fetchImpl), board) };
}

/**
 * Reads the boards (at most MAX_BOARDS_PER_SEARCH at once), keeps the openings whose title fits a target role and
 * whose place is one the user chose, and fills in a missing description or posting date for a few Greenhouse jobs.
 * A board that fails is counted, not fatal.
 */
export async function readBoards(boards: CompanyBoard[], filters: FeedFilters, fetchImpl: FetchLike = fetch): Promise<{ jobs: BoardJob[]; summary: FeedSummary }> {
  const chosen = boards.slice(0, MAX_BOARDS_PER_SEARCH);
  const summary: FeedSummary = { boards: chosen.length, ok: 0, failed: 0, scanned: 0, matched: 0 };
  const settled = await Promise.allSettled(chosen.map((board) => readBoard(board, fetchImpl)));
  const maxPerBoard = filters.maxPerBoard ?? 15;
  const kept: BoardJob[] = [];

  for (const outcome of settled) {
    if (outcome.status === 'rejected') { summary.failed += 1; continue; }
    summary.ok += 1;
    summary.scanned += outcome.value.jobs.length;
    const matched = outcome.value.jobs
      .filter((job) => matchesAnyRole(job.title, filters.roles) && filters.matchesPlace(job))
      // Newest first, so the per-company limit keeps the freshest openings. Undated ones come last.
      .sort((a, b) => postedTime(b) - postedTime(a))
      .slice(0, maxPerBoard);
    kept.push(...matched);
  }

  // Greenhouse lists carry no description. Fetch it (and the posting date, if the list lacked it) for a few matches.
  const wanted = kept.filter((job) => job.board.provider === 'greenhouse' && (!job.details || !job.postedAt)).slice(0, filters.maxDetails ?? 12);
  const details = await Promise.allSettled(wanted.map((job) => greenhouseDetail(job, fetchImpl)));
  details.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') Object.assign(wanted[index], outcome.value);
  });

  summary.matched = kept.length;
  return { jobs: kept, summary };
}
