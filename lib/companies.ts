// "Followed companies": employers whose public job boards CareerPilot reads directly, instead of finding their
// listings through a web search. Greenhouse and Lever publish each company's openings, with the date they were
// posted, as structured data. Pure and dependency-free, shared by the browser and the search function.

export type AtsProvider = 'greenhouse' | 'lever';

export interface CompanyBoard {
  provider: AtsProvider;
  /** The company's board name, for example "stripe" in boards.greenhouse.io/stripe. */
  token: string;
  /** Lever only: the company's board is in the EU data region (jobs.eu.lever.co). */
  eu?: boolean;
}

/** Companies a user can follow, and how many are read in one search. */
export const MAX_FOLLOWED = 20;
export const MAX_BOARDS_PER_SEARCH = 8;

// Lower-case letters, digits, "-" and "_". This is what keeps a pasted value from reaching anywhere but a board name.
const TOKEN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** The text form stored in the profile and sent to the server: "greenhouse:stripe", "lever:netflix", "lever-eu:acme". */
export function companyId(board: CompanyBoard): string {
  return `${board.provider === 'lever' && board.eu ? 'lever-eu' : board.provider}:${board.token}`;
}

function fromId(value: string): CompanyBoard | null {
  const match = /^(greenhouse|lever|lever-eu):([a-z0-9][a-z0-9_-]{0,63})$/.exec(value.trim().toLowerCase());
  if (!match) return null;
  return match[1] === 'greenhouse'
    ? { provider: 'greenhouse', token: match[2] }
    : { provider: 'lever', token: match[2], ...(match[1] === 'lever-eu' ? { eu: true } : {}) };
}

function fromUrl(value: string): CompanyBoard | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean).map((part) => part.toLowerCase());

  if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io' || host === 'boards.eu.greenhouse.io' || host === 'job-boards.eu.greenhouse.io') {
    // boards.greenhouse.io/stripe, /stripe/jobs/123, or the old embed form /embed/job_board?for=stripe
    const token = segments[0] === 'embed' ? url.searchParams.get('for')?.toLowerCase() : segments[0];
    return token && TOKEN.test(token) ? { provider: 'greenhouse', token } : null;
  }
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') {
    const token = segments[0];
    return token && TOKEN.test(token) ? { provider: 'lever', token, ...(host === 'jobs.eu.lever.co' ? { eu: true } : {}) } : null;
  }
  return null;
}

/**
 * Understands what a person is likely to paste: "greenhouse:stripe", "lever:netflix", or the address of a company's
 * job board or of one of its listings. Returns null for anything else, including every other website.
 */
export function parseCompany(input: unknown): CompanyBoard | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!value || value.length > 300) return null;
  return fromId(value) ?? fromUrl(value);
}

/** The company behind a listing's link, when the link is a Greenhouse or Lever posting. */
export const companyFromUrl = (url: string): CompanyBoard | null => fromUrl(url);

/** Valid, unique company ids in their original order. Anything that is not a company is dropped. */
export function sanitizeCompanies(value: unknown, max = MAX_FOLLOWED): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const board = parseCompany(item);
    if (!board) continue;
    const id = companyId(board);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length === max) break;
  }
  return result;
}

/** "greenhouse:stripe" -> "stripe (Greenhouse)". For labels. */
export function companyLabel(id: string): string {
  const board = fromId(id);
  if (!board) return id;
  return `${board.token} (${board.provider === 'greenhouse' ? 'Greenhouse' : 'Lever'})`;
}

/** "acme-logistics" -> "Acme Logistics". Used when a board does not say the company's name. */
export function prettifyToken(token: string): string {
  return token.split(/[-_]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

export const boardFromId = fromId;
