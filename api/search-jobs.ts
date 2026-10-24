// Vercel Function: POST /api/search-jobs
// Searches ONLY the portals the user ticked and returns ONLY listings whose posting date can be verified
// to fall inside the chosen time window.
// Proxies a small set of search terms to Tavily so the API key never reaches the browser.

import { findPostedDate, hostMatches, isSourceId, isTimeWindowId, isWithinWindow, SOURCE_DOMAINS, toDateOnly, WINDOW_DAYS } from '../lib/recency.js';
import type { SourceId, TimeWindowId } from '../lib/recency.js';

interface SearchRequest {
  timeWindow?: string;
  sources?: string[];
  targetRoles?: string;
  skills?: string;
  location?: string;
  workMode?: string;
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
  raw_content?: string | null;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

const MAX_FIELD_LENGTH = 500;
const SEARCH_TIMEOUT_MS = 15_000;

const NEBIUS_DEFAULT_BASE_URL = 'https://api.tokenfactory.nebius.com/v1';
const NEBIUS_DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
const PLANNER_TIMEOUT_MS = 15_000;

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const json = (body: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });

const cleanField = (value: unknown): string => typeof value === 'string'
  // eslint-disable-next-line no-control-regex
  ? value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, MAX_FIELD_LENGTH)
  : '';

function makeQueries(profile: SearchRequest): string[] {
  const roles = cleanField(profile.targetRoles).split(/[\n,;|]/).map((part) => part.trim()).filter(Boolean).slice(0, 2);
  const skills = cleanField(profile.skills).split(/[\n,;|]/).map((part) => part.trim()).filter(Boolean).slice(0, 5);
  const location = cleanField(profile.location);
  const mode = cleanField(profile.workMode);
  const primaryRole = roles[0] || 'professional';
  const rolePhrase = roles.length > 1 ? `"${roles[0]}" OR "${roles[1]}"` : `"${primaryRole}"`;
  const locationPart = location ? `"${location}"` : '';
  const modePart = mode && mode !== 'Any' ? mode : '';
  const skillPart = skills.slice(0, 3).map((skill) => `"${skill}"`).join(' ');
  return [
    `${rolePhrase} jobs ${locationPart} ${modePart} apply`.replace(/\s+/g, ' ').trim(),
    `${rolePhrase} careers ${locationPart} ${skillPart} vacancy`.replace(/\s+/g, ' ').trim(),
    `site:jobs.lever.co OR site:boards.greenhouse.io OR site:myworkdayjobs.com ${rolePhrase} ${locationPart} ${skillPart}`.replace(/\s+/g, ' ').trim(),
  ];
}

const PLANNER_PROMPT = `You plan web searches that find CURRENT job vacancies for a candidate.
Given target roles, skills, preferred location and work mode, write exactly 3 short search queries (each under 200 characters):
1. a plain query for open positions using the main target title and location;
2. a query using realistic alternative or adjacent job titles (synonyms, seniority variants) plus the location;
3. a query aimed at employer career pages or applicant-tracking sites (Greenhouse, Lever, Workday) combining title, key skills and location.
Do not invent employers. Do not add personal data. Respond with a single JSON object and nothing else: {"queries":["...","...","..."]}`;

// Asks an NVIDIA Nemotron model (Nebius Token Factory) to plan the searches. Returns [] on any problem,
// in which case the caller falls back to the rule-based queries.
async function planQueries(profile: SearchRequest): Promise<string[]> {
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) return [];
  const baseUrl = (process.env.NEBIUS_BASE_URL || NEBIUS_DEFAULT_BASE_URL).replace(/\/+$/, '');
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(PLANNER_TIMEOUT_MS),
      body: JSON.stringify({
        model: process.env.NEBIUS_MODEL || NEBIUS_DEFAULT_MODEL,
        temperature: 0.3,
        max_tokens: 700,
        messages: [
          { role: 'system', content: PLANNER_PROMPT },
          { role: 'user', content: [
            `Target roles: ${cleanField(profile.targetRoles)}`,
            `Skills: ${cleanField(profile.skills) || 'not provided'}`,
            `Preferred location: ${cleanField(profile.location) || 'not provided'}`,
            `Work mode: ${cleanField(profile.workMode) || 'Any'}`,
          ].join('\n') },
        ],
      }),
    });
    if (!response.ok) return [];
    const data = await response.json() as { choices?: { message?: { content?: string | null } }[] };
    const raw = (data.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) return [];
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { queries?: unknown };
    if (!Array.isArray(parsed.queries)) return [];
    const seen = new Set<string>();
    const queries: string[] = [];
    for (const item of parsed.queries) {
      if (typeof item !== 'string') continue;
      const query = cleanField(item).replace(/\s+/g, ' ').slice(0, 200);
      if (query.length < 5 || seen.has(query.toLowerCase())) continue;
      seen.add(query.toLowerCase());
      queries.push(query);
      if (queries.length === 3) break;
    }
    return queries;
  } catch {
    return [];
  }
}

interface SearchOptions {
  window: TimeWindowId;
  now: Date;
  domains: string[];
}

async function runSearch(query: string, apiKey: string, options: SearchOptions): Promise<TavilyResult[]> {
  const start = new Date(options.now.getTime() - WINDOW_DAYS[options.window] * 86_400_000);
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    body: JSON.stringify({
      query,
      topic: 'general',
      search_depth: 'basic',
      max_results: 10,
      include_answer: false,
      // raw content is only read on the server to find a posting date; it is never sent to the browser.
      include_raw_content: 'text',
      include_published_date: true,
      start_date: toDateOnly(start),
      end_date: toDateOnly(options.now),
      include_domains: options.domains,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Search provider returned ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ''}`);
  }
  const data = await response.json() as TavilyResponse;
  return Array.isArray(data.results) ? data.results : [];
}

function canonicalKey(url: string): string {
  return url.split('#')[0].replace(/\/$/, '').toLowerCase();
}

interface SearchJob {
  query: string;
  domains: string[];
}

// One call per (portal, query). Portals use the two general queries; ATS pages use the third.
// The total is bounded to 5 calls so one click cannot burn many API credits.
function buildJobs(sources: SourceId[], queries: string[]): SearchJob[] {
  const portals = sources.filter((source) => source !== 'ats');
  const jobs: SearchJob[] = [];
  const perPortal = portals.length <= 2 ? 2 : 1;
  for (const portal of portals) {
    for (const query of queries.slice(0, perPortal)) jobs.push({ query, domains: [SOURCE_DOMAINS[portal][0]] });
    if (SOURCE_DOMAINS[portal].length > 1 && perPortal === 1) jobs.push({ query: queries[0], domains: [SOURCE_DOMAINS[portal][1]] });
  }
  if (sources.includes('ats')) jobs.push({ query: queries[2] ?? queries[0], domains: SOURCE_DOMAINS.ats });
  return jobs.slice(0, 5);
}

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return json({ error: 'Web search is not configured yet. Add TAVILY_API_KEY to your Vercel environment variables, or use the direct-search links.' }, 503);
  }

  let profile: SearchRequest;
  try {
    profile = await request.json() as SearchRequest;
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400);
  }
  if (!profile || typeof profile !== 'object') {
    return json({ error: 'Request body must be a JSON object.' }, 400);
  }

  // The time window is mandatory and there is deliberately no "all time" value.
  if (!isTimeWindowId(profile.timeWindow)) {
    return json({ error: 'Choose a time window: last 1 day, 1 week, 2 weeks, 3 weeks or 4 weeks.' }, 400);
  }
  const window: TimeWindowId = profile.timeWindow;

  const sources = Array.isArray(profile.sources)
    ? [...new Set(profile.sources.filter((source): source is SourceId => isSourceId(source)))]
    : [];
  if (sources.length === 0) {
    return json({ error: 'Select at least one job source to search.' }, 400);
  }

  const targetRoles = cleanField(profile.targetRoles);
  if (!targetRoles) {
    return json({ error: 'Add at least one target job title before searching.' }, 400);
  }

  const cleanProfile: SearchRequest = {
    targetRoles,
    skills: cleanField(profile.skills),
    location: cleanField(profile.location),
    workMode: cleanField(profile.workMode),
  };
  const ruleQueries = makeQueries(cleanProfile);
  const planned = await planQueries(cleanProfile);
  // Nemotron-planned queries first; any missing slots are filled by the rule-based ones.
  const queries = [...planned, ...ruleQueries.slice(planned.length)].slice(0, 3);
  const planner = planned.length > 0 ? 'nemotron' : 'rules';

  const now = new Date();
  const jobs = buildJobs(sources, queries);
  // allSettled so one slow or failing query does not throw away the others.
  const settled = await Promise.allSettled(jobs.map((job) => runSearch(job.query, apiKey, { window, now, domains: job.domains })));
  const fulfilled = settled.filter((entry): entry is PromiseFulfilledResult<TavilyResult[]> => entry.status === 'fulfilled');
  if (fulfilled.length === 0) {
    const first = settled.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected');
    const message = first?.reason instanceof Error ? first.reason.message : 'Unknown search error';
    return json({ error: `Job search failed. ${message}` }, 502);
  }

  const allowedDomains = sources.flatMap((source) => SOURCE_DOMAINS[source]);
  const excluded = { otherSource: 0, undated: 0, tooOld: 0, invalid: 0 };
  const seen = new Set<string>();
  const results = [];
  for (const result of fulfilled.flatMap((entry) => entry.value)) {
    if (!result.url) { excluded.invalid += 1; continue; }
    try {
      if (!['http:', 'https:'].includes(new URL(result.url).protocol)) { excluded.invalid += 1; continue; }
    } catch { excluded.invalid += 1; continue; }
    const key = canonicalKey(result.url);
    if (seen.has(key)) continue;
    seen.add(key);

    // User-selected portals only.
    if (!hostMatches(result.url, allowedDomains)) { excluded.otherSource += 1; continue; }

    // Strict time window: no verifiable date, or a date outside the window, means the listing is dropped.
    const posted = findPostedDate({
      publishedDate: result.published_date,
      text: `${result.title ?? ''}\n${result.content ?? ''}\n${(result.raw_content ?? '').slice(0, 20_000)}`,
    }, now);
    if (!posted) { excluded.undated += 1; continue; }
    if (!isWithinWindow(posted.date, window, now)) { excluded.tooOld += 1; continue; }

    results.push({
      title: cleanField(result.title) || 'Untitled job search result',
      url: result.url,
      content: cleanField(result.content),
      score: typeof result.score === 'number' ? result.score : undefined,
      publishedDate: posted.date.toISOString(),
      dateSource: posted.source,
    });
  }

  return json({ results, queriesRun: fulfilled.length, queries, planner, timeWindow: window, sources, excluded }, 200, { 'Cache-Control': 'no-store' });
}

export function GET(): Response {
  return json({ error: 'Use POST for job searches.' }, 405, { Allow: 'POST' });
}
