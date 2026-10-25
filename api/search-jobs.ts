// Vercel Function: POST /api/search-jobs
// Searches ONLY the sites the user ticked, once per selected place, and returns ONLY listings whose posting
// date can be verified to fall inside the chosen time window.
// Proxies a small set of search terms to Tavily so the API key never reaches the browser.

import { findPostedDate, hostMatches, isTimeWindowId, isWithinWindow, toDateOnly, WINDOW_DAYS } from '../lib/recency.js';
import type { TimeWindowId } from '../lib/recency.js';
import { ATS_GROUP, getSource, isSourceId } from '../lib/sources.js';
import type { SourceDef } from '../lib/sources.js';

interface SearchRequest {
  timeWindow?: string;
  sources?: string[];
  targetRoles?: string;
  skills?: string;
  location?: string;
  locations?: unknown;
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

// One click runs at most MAX_CALLS Tavily searches in total, however many places and sites are selected.
const MAX_CALLS = 8;
const MAX_PLACES = 5;
const SOURCES_PER_CALL = 4;
const LOCATION_TOKEN = '{location}';

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
  const mode = cleanField(profile.workMode);
  const primaryRole = roles[0] || 'professional';
  const rolePhrase = roles.length > 1 ? `"${roles[0]}" OR "${roles[1]}"` : `"${primaryRole}"`;
  const locationPart = LOCATION_TOKEN; // replaced by each selected place when the searches are built
  const modePart = mode && mode !== 'Any' ? mode : '';
  const skillPart = skills.slice(0, 3).map((skill) => `"${skill}"`).join(' ');
  return [
    `${rolePhrase} jobs ${locationPart} ${modePart} apply`.replace(/\s+/g, ' ').trim(),
    `${rolePhrase} careers ${locationPart} ${skillPart} vacancy`.replace(/\s+/g, ' ').trim(),
    `site:jobs.lever.co OR site:boards.greenhouse.io OR site:myworkdayjobs.com ${rolePhrase} ${locationPart} ${skillPart}`.replace(/\s+/g, ' ').trim(),
  ];
}

const PLANNER_PROMPT = `You plan web searches that find CURRENT job vacancies for a candidate.
Given target roles, skills and work mode, write exactly 3 short search queries (each under 200 characters).
Write the literal text {location} where the place name belongs; the system replaces it with each place the candidate selected. Never write real place names yourself.
1. a plain query for open positions using the main target title and {location};
2. a query using realistic alternative or adjacent job titles (synonyms, seniority variants) plus {location};
3. a query aimed at employer career pages or applicant-tracking sites (Greenhouse, Lever, Workday) combining title, key skills and {location}.
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
  maxResults: number;
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
      max_results: options.maxResults,
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
  maxResults: number;
}

/** Reads the selected places: the new list, or the older single "location" text. */
function parseLocations(profile: SearchRequest): string[] {
  const raw: unknown[] = Array.isArray(profile.locations) ? profile.locations : cleanField(profile.location).split(/[;\n|]/);
  const seen = new Set<string>();
  const places: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    // Quotes and braces are removed so a place name cannot alter the query syntax or the {location} token.
    const label = cleanField(item).replace(/["{}]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (label.length < 2 || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    places.push(label);
    if (places.length === MAX_PLACES) break;
  }
  return places;
}

// "Mumbai, India" -> "Mumbai" India (city quoted, country loose); "India" -> "India".
function locationTerm(label: string): string {
  if (!label) return '';
  const [city, ...rest] = label.split(',');
  return rest.length ? `"${city.trim()}" ${rest.join(' ').trim()}` : `"${label}"`;
}

function fillLocation(query: string, term: string): string {
  const filled = query.includes(LOCATION_TOKEN) ? query.split(LOCATION_TOKEN).join(term) : `${query} ${term}`;
  return filled.replace(/\s+/g, ' ').trim();
}

/**
 * Plans the Tavily calls. Sources are grouped (about four per call) and each group is searched once per place.
 * The total never exceeds MAX_CALLS: when many places are selected, groups are merged so every place and every
 * ticked site is still covered, just with fewer result slots per site.
 */
function buildJobs(sources: SourceDef[], queries: string[], places: string[]): SearchJob[] {
  const targets = places.length ? places : [''];
  const perPlace = Math.max(1, Math.floor(MAX_CALLS / targets.length));
  const ats = sources.filter((source) => source.group === ATS_GROUP);
  const portals = sources.filter((source) => source.group !== ATS_GROUP);

  const groups: { sources: SourceDef[]; query: string }[] = [];
  if (perPlace === 1) {
    groups.push({ sources, query: queries[0] });
  } else {
    const portalCalls = portals.length ? Math.min(perPlace - (ats.length ? 1 : 0), Math.ceil(portals.length / SOURCES_PER_CALL)) : 0;
    const buckets: SourceDef[][] = Array.from({ length: portalCalls }, () => []);
    portals.forEach((source, index) => buckets[index % portalCalls].push(source));
    buckets.forEach((bucket) => groups.push({ sources: bucket, query: queries[0] }));
    if (ats.length) groups.push({ sources: ats, query: queries[2] ?? queries[0] });
    // Spare budget: repeat the portal groups with the second (alternative titles) query.
    for (const bucket of buckets) {
      if (groups.length >= perPlace || !queries[1]) break;
      groups.push({ sources: bucket, query: queries[1] });
    }
  }

  const jobs: SearchJob[] = [];
  for (const place of targets) {
    for (const group of groups) {
      jobs.push({
        query: fillLocation(group.query, locationTerm(place)),
        domains: [...new Set(group.sources.flatMap((source) => source.domains))],
        maxResults: Math.min(20, 8 + 3 * group.sources.length),
      });
    }
  }
  return jobs.slice(0, MAX_CALLS);
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

  const sourceIds = Array.isArray(profile.sources)
    ? [...new Set(profile.sources.filter((source): source is string => isSourceId(source)))]
    : [];
  const sources = sourceIds.flatMap((id) => getSource(id) ?? []);
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
    workMode: cleanField(profile.workMode),
  };
  const places = parseLocations(profile);
  const ruleQueries = makeQueries(cleanProfile);
  const planned = await planQueries(cleanProfile);
  // Nemotron-planned queries first; any missing slots are filled by the rule-based ones.
  const queries = [...planned, ...ruleQueries.slice(planned.length)].slice(0, 3);
  const planner = planned.length > 0 ? 'nemotron' : 'rules';

  const now = new Date();
  const jobs = buildJobs(sources, queries, places);
  // allSettled so one slow or failing query does not throw away the others.
  const settled = await Promise.allSettled(jobs.map((job) => runSearch(job.query, apiKey, { window, now, domains: job.domains, maxResults: job.maxResults })));
  const fulfilled = settled.filter((entry): entry is PromiseFulfilledResult<TavilyResult[]> => entry.status === 'fulfilled');
  if (fulfilled.length === 0) {
    const first = settled.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected');
    const message = first?.reason instanceof Error ? first.reason.message : 'Unknown search error';
    return json({ error: `Job search failed. ${message}` }, 502);
  }

  const allowedDomains = sources.flatMap((source) => source.domains);
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

  const queriesSent = [...new Set(jobs.map((job) => job.query))];
  return json({ results, queriesRun: fulfilled.length, queries: queriesSent, planner, timeWindow: window, sources: sourceIds, locations: places, excluded }, 200, { 'Cache-Control': 'no-store' });
}

export function GET(): Response {
  return json({ error: 'Use POST for job searches.' }, 405, { Allow: 'POST' });
}
