// Vercel Function: POST /api/search-jobs
// Proxies a small set of search terms to Tavily so the API key never reaches the browser.

interface SearchRequest {
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

async function runSearch(query: string, apiKey: string): Promise<TavilyResult[]> {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    body: JSON.stringify({
      query,
      topic: 'general',
      search_depth: 'basic',
      max_results: 7,
      include_answer: false,
      include_raw_content: false,
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

  // Three bounded basic searches per click; the resume text itself is never sent here.
  // allSettled so one slow or failing query does not throw away the others.
  const settled = await Promise.allSettled(queries.map((query) => runSearch(query, apiKey)));
  const fulfilled = settled.filter((entry): entry is PromiseFulfilledResult<TavilyResult[]> => entry.status === 'fulfilled');
  if (fulfilled.length === 0) {
    const first = settled.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected');
    const message = first?.reason instanceof Error ? first.reason.message : 'Unknown search error';
    return json({ error: `Job search failed. ${message}` }, 502);
  }

  const seen = new Set<string>();
  const results = fulfilled.flatMap((entry) => entry.value).filter((result) => {
    if (!result.url) return false;
    try {
      const parsed = new URL(result.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    } catch {
      return false;
    }
    const key = canonicalKey(result.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((result) => ({
    title: cleanField(result.title) || 'Untitled job search result',
    url: result.url as string,
    content: cleanField(result.content),
    score: typeof result.score === 'number' ? result.score : undefined,
    publishedDate: result.published_date || null,
  }));

  return json({ results, queriesRun: fulfilled.length, queries, planner }, 200, { 'Cache-Control': 'no-store' });
}

export function GET(): Response {
  return json({ error: 'Use POST for job searches.' }, 405, { Allow: 'POST' });
}
