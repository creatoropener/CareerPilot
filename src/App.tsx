import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight, ArrowRight, Bookmark, BriefcaseBusiness, CalendarClock, Check, CheckCircle2,
  Building2, ChevronDown, CircleHelp, ExternalLink, FileDown, FileText, FileUp, Filter, Globe2,
  RefreshCw, Search, Send, ShieldCheck,
  SlidersHorizontal, Sparkles, Target, Trash2, TrendingUp, X, Zap,
} from 'lucide-react';
import { buildSearchFallbackLinks, canonicalizeUrl, domainOf, makeJobId, rankJobs, suggestProfileFromResume } from './lib/matcher';
import { DEFAULT_PROFILE, STATUS_OPTIONS } from './lib/types';
import type { AiAnalysis, ApplicationStatus, CareerProfile, JobResult, JobSearchResponse, RawJobResult, SearchExclusions, WorkMode } from './lib/types';
import { CvError, extractCvText } from './lib/cv';
import { DEFAULT_SOURCES, DEFAULT_TIME_WINDOW, isPostedWithin, isSourceId, isTimeWindowId, TIME_WINDOWS, windowLabel } from './lib/window';
import type { TimeWindowId } from './lib/window';
import { cleanCustomLocation, MAX_LOCATIONS, splitLegacyLocation } from './lib/locations';
import { isIndividualVacancy } from '../lib/listings';
import { canSearchMore as canOfferMore, describeExclusions, describeFailures, describeFeeds, MAX_BATCHES, PAGE_SIZE, plural, revealNext, visibleAfterFetch, windowAge } from './lib/paging';
import { ageLabel, downloadText, isNarrowScreen, scrollToElement } from './lib/format';
import { countByStatus, countDue, filterSaved, hasApplied, localDateString, markApplied, orderSaved, sanitizeTracking, setStatus, toCsv } from './lib/tracker';
import type { SavedFilter } from './lib/tracker';
import { companyFromUrl, companyId, companyLabel, MAX_FOLLOWED, sanitizeCompanies } from '../lib/companies';
import { addSearch, afterCheck, afterRun, applySnapshot, createSearch, keyOf, newSince, removeSearch, sameSearch, sanitizeSavedSearches, searchSignature, snapshotOf } from './lib/savedSearches';
import type { SavedSearch, SearchSnapshot } from './lib/savedSearches';
import { sanitizeLetters, saveLetter } from './lib/coverLetter';
import type { GeneratedLetter, LetterRequest, LetterStore } from './lib/coverLetter';
import { CompanyFollow } from './components/CompanyFollow';
import { CoverLetterDialog } from './components/CoverLetterDialog';
import { SavedSearches } from './components/SavedSearches';
import { LocationPicker } from './components/LocationPicker';
import { SourcePicker } from './components/SourcePicker';
import { FollowUpChip, TrackerFields } from './components/TrackerFields';
import { useReturnPrompt } from './components/useReturnPrompt';
import './styles.css';

const PROFILE_KEY = 'careerpilot.job-radar.profile.v1';
const JOBS_KEY = 'careerpilot.job-radar.saved-jobs.v1';
const SEARCHES_KEY = 'careerpilot.job-radar.saved-searches.v1';
const LETTERS_KEY = 'careerpilot.job-radar.cover-letters.v1';
const LETTER_NAME_KEY = 'careerpilot.job-radar.letter-name.v1';

type Tab = 'radar' | 'saved';
type FilterKey = 'all' | 'strong' | 'medium' | 'new';

function readLocal<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? { ...fallback as object, ...JSON.parse(value) } as T : fallback;
  } catch {
    return fallback;
  }
}

// Stored or imported profiles may predate the time-window, source and multi-location settings, or be malformed.
function sanitizeProfile(value: CareerProfile): CareerProfile {
  const sources = Array.isArray(value.sources) ? [...new Set(value.sources.filter(isSourceId))] : [];
  const saved = Array.isArray(value.locations) ? value.locations.filter((item): item is string => typeof item === 'string').map(cleanCustomLocation).filter(Boolean) : [];
  // Older profiles only have the single "location" text: split it into entries.
  const locations = [...new Set(saved.length ? saved : splitLegacyLocation(typeof value.location === 'string' ? value.location : ''))].slice(0, MAX_LOCATIONS);
  return {
    ...value,
    locations,
    location: locations.join('; '),
    timeWindow: isTimeWindowId(value.timeWindow) ? value.timeWindow : DEFAULT_TIME_WINDOW,
    sources: sources.length ? sources : [...DEFAULT_SOURCES],
    companies: sanitizeCompanies(value.companies, MAX_FOLLOWED),
  };
}

function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

const asStringArray = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function normalizeJob(value: unknown): JobResult | null {
  if (!value || typeof value !== 'object') return null;
  const job = value as Partial<JobResult>;
  if (typeof job.title !== 'string' || !isSafeHttpUrl(job.url)) return null;
  const url = canonicalizeUrl(job.url);
  const tracking = sanitizeTracking(job);
  return {
    ...job,
    appliedAt: tracking.appliedAt,
    followUpAt: tracking.followUpAt,
    notes: tracking.notes,
    title: job.title,
    url,
    content: typeof job.content === 'string' ? job.content : '',
    details: typeof job.details === 'string' && job.details.trim() ? job.details.slice(0, 2000) : undefined,
    fromBoard: job.fromBoard === true ? true : undefined,
    id: typeof job.id === 'string' && job.id ? job.id : makeJobId(url),
    domain: typeof job.domain === 'string' && job.domain ? job.domain : domainOf(url),
    matchScore: typeof job.matchScore === 'number' && Number.isFinite(job.matchScore) ? job.matchScore : 0,
    matchedTerms: asStringArray(job.matchedTerms),
    missingTerms: asStringArray(job.missingTerms),
    status: STATUS_OPTIONS.includes(job.status as ApplicationStatus) ? job.status as ApplicationStatus : 'Saved',
  };
}

function normalizeJobs(value: unknown): JobResult[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const jobs: JobResult[] = [];
  for (const entry of value) {
    const job = normalizeJob(entry);
    if (!job || seen.has(job.url)) continue;
    seen.add(job.url);
    jobs.push(job);
  }
  return jobs;
}

function readJobs(): JobResult[] {
  try {
    const value = localStorage.getItem(JOBS_KEY);
    return normalizeJobs(value ? JSON.parse(value) : []);
  } catch {
    return [];
  }
}

function readSearches(): SavedSearch[] {
  try {
    const value = localStorage.getItem(SEARCHES_KEY);
    return sanitizeSavedSearches(value ? JSON.parse(value) : []);
  } catch {
    return [];
  }
}

function readLetters(): LetterStore {
  try {
    const value = localStorage.getItem(LETTERS_KEY);
    return sanitizeLetters(value ? JSON.parse(value) : {});
  } catch {
    return {};
  }
}

function readLetterName(): string {
  try { return (localStorage.getItem(LETTER_NAME_KEY) ?? '').slice(0, 80); } catch { return ''; }
}

/** Sends one search to the server. `extra` carries the paging fields of "Search More Jobs". */
async function requestSearch(search: SearchSnapshot, extra: Record<string, unknown>, unavailable: string): Promise<JobSearchResponse> {
  const response = await fetch('/api/search-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetRoles: search.targetRoles,
      skills: search.skills,
      location: search.locations.join('; '),
      locations: search.locations,
      workMode: search.workMode,
      timeWindow: search.timeWindow,
      sources: search.sources,
      companies: search.companies,
      // Deliberately omit experienceSummary and the full resume from the request.
      ...extra,
    }),
  });
  const payload = await response.json().catch(() => null) as (JobSearchResponse & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error || unavailable);
  return payload;
}

/**
 * Defence in depth: the server already filters, but nothing outside the window, and no search or category page, is
 * ever displayed. An opening read from a company's own job board is always one vacancy.
 */
const usableListings = (payload: JobSearchResponse, windowId: TimeWindowId): RawJobResult[] =>
  (Array.isArray(payload.results) ? payload.results : [])
    .filter((job) => isPostedWithin(job.publishedDate, windowId) && (job.fromBoard === true || isIndividualVacancy(job)));

function niceDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function App() {
  const [profile, setProfile] = useState<CareerProfile>(() => sanitizeProfile(readLocal(PROFILE_KEY, DEFAULT_PROFILE)));
  const [savedJobs, setSavedJobs] = useState<JobResult[]>(readJobs);
  const [results, setResults] = useState<JobResult[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [batch, setBatch] = useState(1);
  const [noMore, setNoMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tab, setTab] = useState<Tab>('radar');
  const [savedFilter, setSavedFilter] = useState<SavedFilter>('all');
  const [returnJob, setReturnJob] = useState<JobResult | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchNote, setSearchNote] = useState('');
  const [queryLabel, setQueryLabel] = useState('');
  const [showProfileForm, setShowProfileForm] = useState(true);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualCompany, setManualCompany] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [manualLocation, setManualLocation] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [aiIncludeResume, setAiIncludeResume] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(readSearches);
  const [activeSearchId, setActiveSearchId] = useState<string | null>(null);
  // Listings on screen that were not there the last time this saved search was run.
  const [newKeys, setNewKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [checking, setChecking] = useState<string | null>(null);
  // Which search the results on screen belong to, so saving the search can mark them as already seen.
  const [resultsSignature, setResultsSignature] = useState('');
  const [letters, setLetters] = useState<LetterStore>(readLetters);
  const [letterName, setLetterName] = useState(readLetterName);
  const [letterJob, setLetterJob] = useState<JobResult | null>(null);
  const [lastQueries, setLastQueries] = useState<{ queries: string[]; planner: 'nemotron' | 'rules' } | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const cvInput = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const [cvName, setCvName] = useState('');
  const [cvLoading, setCvLoading] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch { /* storage can be disabled */ }
  }, [profile]);

  useEffect(() => {
    try { localStorage.setItem(JOBS_KEY, JSON.stringify(savedJobs)); } catch { /* storage can be disabled */ }
  }, [savedJobs]);

  useEffect(() => {
    try { localStorage.setItem(SEARCHES_KEY, JSON.stringify(savedSearches)); } catch { /* storage can be disabled */ }
  }, [savedSearches]);

  useEffect(() => {
    try { localStorage.setItem(LETTERS_KEY, JSON.stringify(letters)); } catch { /* storage can be disabled */ }
  }, [letters]);

  useEffect(() => {
    try { localStorage.setItem(LETTER_NAME_KEY, letterName); } catch { /* storage can be disabled */ }
  }, [letterName]);

  const fallbackLinks = useMemo(() => buildSearchFallbackLinks({ ...profile, location: profile.locations[0] ?? '' }), [profile]);
  // Only the first `visibleCount` of the ranked pool is shown; the rest stays hidden until "Search More Jobs".
  const shownResults = useMemo(() => results.slice(0, visibleCount), [results, visibleCount]);
  const visibleResults = useMemo(() => {
    if (filter === 'strong') return shownResults.filter((job) => job.matchScore >= 70);
    if (filter === 'medium') return shownResults.filter((job) => job.matchScore >= 40 && job.matchScore < 70);
    if (filter === 'new') return shownResults.filter((job) => newKeys.has(keyOf(job)));
    return shownResults;
  }, [filter, newKeys, shownResults]);
  const newShown = useMemo(() => shownResults.filter((job) => newKeys.has(keyOf(job))).length, [newKeys, shownResults]);
  const followedIds = useMemo(() => new Set(profile.companies), [profile.companies]);
  const canSearchMore = canOfferMore({ total: results.length, visible: visibleCount, batch, exhausted: noMore });
  const savedUrlSet = useMemo(() => new Set(savedJobs.map((job) => job.url)), [savedJobs]);
  const savedStatusByUrl = useMemo(() => new Map(savedJobs.map((job) => [job.url, job.status] as const)), [savedJobs]);
  const today = localDateString();
  const dueCount = countDue(savedJobs, today);
  const statusCounts = useMemo(() => countByStatus(savedJobs), [savedJobs]);
  const visibleSaved = useMemo(() => orderSaved(filterSaved(savedJobs, savedFilter), today), [savedJobs, savedFilter, today]);

  // After a listing is opened and the user comes back, ask whether they applied (unless the job is already marked).
  const savedStatusRef = useRef(savedStatusByUrl);
  useEffect(() => { savedStatusRef.current = savedStatusByUrl; });
  const returnPrompt = useReturnPrompt<JobResult>((opened) => {
    if (!hasApplied(savedStatusRef.current.get(opened.url))) setReturnJob(opened);
  });

  // On a phone the saved list sits below the profile form, so bring it into view when the tab is opened.
  useEffect(() => {
    if (tab === 'saved' && isNarrowScreen()) window.setTimeout(() => scrollToElement(resultsRef.current), 60);
  }, [tab]);

  useEffect(() => {
    if (!returnJob) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setReturnJob(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [returnJob]);
  const strongCount = shownResults.filter((job) => job.matchScore >= 70).length;

  function updateProfile<K extends keyof CareerProfile>(key: K, value: CareerProfile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  function extractResumeDetails(text: string = profile.experienceSummary) {
    if (!text.trim()) {
      setSearchError('Paste resume text or an experience summary before extracting details.');
      return;
    }
    const suggestions = suggestProfileFromResume(text);
    setProfile((current) => ({
      ...current,
      targetRoles: current.targetRoles.trim() || suggestions.roles.join(', '),
      skills: [...new Set([...current.skills.split(/[,;\n|]/).map((item) => item.trim()).filter(Boolean), ...suggestions.skills])].join(', '),
      education: current.education.trim() || suggestions.education.join(' · '),
    }));
    setSearchError('');
    setSearchNote(`Local extraction found ${suggestions.skills.length} possible skills, ${suggestions.roles.length} possible role titles and ${suggestions.education.length} education/certification lines. Review the profile before searching.`);
  }

  async function uploadCv(file?: File) {
    if (!file) return;
    setCvLoading(true);
    setSearchError('');
    setSearchNote(`Reading ${file.name} in your browser…`);
    try {
      const text = await extractCvText(file);
      setCvName(file.name);
      setProfile((current) => ({ ...current, experienceSummary: text }));
      extractResumeDetails(text);
      setSearchNote(`Loaded ${text.length.toLocaleString()} characters from ${file.name}. The file stayed on your device. Review the suggested profile, or use “Extract profile with Nemotron AI” for a deeper read.`);
    } catch (error) {
      setSearchError(error instanceof CvError ? error.message : 'Could not read that file. Paste the text instead.');
    } finally {
      setCvLoading(false);
      if (cvInput.current) cvInput.current.value = '';
    }
  }

  function updateLocations(locations: string[]) {
    setProfile((current) => ({ ...current, locations, location: locations.join('; ') }));
  }

  async function extractWithNemotron() {
    if (!profile.experienceSummary.trim()) {
      setSearchError('Paste resume text or an experience summary before extracting details.');
      return;
    }
    setExtracting(true);
    setSearchError('');
    setSearchNote('Asking NVIDIA Nemotron to read your resume text…');
    try {
      const response = await fetch('/api/extract-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText: profile.experienceSummary }),
      });
      const payload = await response.json().catch(() => null) as { profile?: { targetRoles: string[]; skills: string[]; education: string[]; location: string; headline: string }; error?: string } | null;
      if (!response.ok || !payload?.profile) throw new Error(payload?.error || 'AI extraction is not available right now.');
      const found = payload.profile;
      setProfile((current) => ({
        ...current,
        targetRoles: current.targetRoles.trim() || found.targetRoles.join(', '),
        skills: [...new Set([...current.skills.split(/[,;\n|]/).map((item) => item.trim()).filter(Boolean), ...found.skills])].join(', '),
        education: current.education.trim() || found.education.join(' · '),
        ...(current.locations.length === 0 && found.location.trim()
          ? { locations: [cleanCustomLocation(found.location)], location: cleanCustomLocation(found.location) }
          : {}),
      }));
      setSearchNote(`Nemotron found ${found.targetRoles.length} role title(s), ${found.skills.length} skill(s) and ${found.education.length} education line(s)${found.headline ? ` — “${found.headline}”` : ''}. Review the profile before searching.`);
    } catch (error) {
      // Fall back to the local rule-based extraction so the button always helps.
      extractResumeDetails();
      const reason = error instanceof Error ? error.message : 'AI extraction failed.';
      setSearchNote(`${reason} Used the local rule-based extraction instead; review the profile before searching.`);
    } finally {
      setExtracting(false);
    }
  }

  /**
   * Runs a search. Without arguments it searches what is in the form. With a saved search it loads that search into
   * the form first, so what is on screen is always what was searched.
   */
  async function runSearch(saved?: SavedSearch) {
    const active: CareerProfile = saved ? applySnapshot(profile, saved.search) : profile;
    if (!active.targetRoles.trim()) {
      setSearchError('Add at least one target role to start searching.');
      setShowProfileForm(true);
      return;
    }
    if (active.sources.length === 0) {
      setSearchError('Select at least one job source to search.');
      setShowProfileForm(true);
      return;
    }
    if (saved) setProfile(active);
    const windowId: TimeWindowId = active.timeWindow;
    const snapshot = snapshotOf(active);
    setLoading(true);
    setSearchError('');
    setSearchNote('Searching public web results and ranking the available text…');
    setQueryLabel([active.targetRoles.split(/[\n,;|]/)[0], active.locations.join(', ')].filter(Boolean).join(' · '));
    setFilter('all');
    try {
      const payload = await requestSearch(snapshot, {}, 'Search service is not available. Use the direct-search links or add a job URL manually.');
      const ranked = rankJobs(usableListings(payload, windowId), active);
      setResults(ranked);
      setVisibleCount(PAGE_SIZE);
      setBatch(1);
      setNoMore(false);
      setResultsSignature(searchSignature(snapshot));
      setLastQueries(Array.isArray(payload.queries) && payload.queries.length ? { queries: payload.queries, planner: payload.planner === 'nemotron' ? 'nemotron' : 'rules' } : null);

      // A search that is saved remembers what it showed, so the next run can say what is new.
      const keys = ranked.map(keyOf);
      const match = saved ?? savedSearches.find((entry) => sameSearch(entry.search, snapshot));
      const fresh = match ? newSince(match, keys) : [];
      setNewKeys(new Set(fresh));
      setActiveSearchId(match?.id ?? null);
      if (match) setSavedSearches((current) => current.map((entry) => entry.id === match.id ? afterRun(entry, keys) : entry));

      const windowText = windowLabel(windowId);
      const shown = Math.min(ranked.length, PAGE_SIZE);
      const left = describeExclusions(payload.excluded, windowAge(windowId));
      const queryCount = payload.queriesRun ?? 1;
      const failed = describeFailures(payload.queriesFailed, queryCount + (payload.queriesFailed ?? 0));
      const boards = describeFeeds(payload.feeds);
      const searched = `Searched ${plural(queryCount, 'targeted query', 'targeted queries')}${payload.planner === 'nemotron' ? ' planned by NVIDIA Nemotron' : ''}.`;
      const news = match?.lastCheckedAt ? (fresh.length > 0 ? ` ${plural(fresh.length, 'listing')} new since you last ran “${match.name}”.` : ` Nothing new since you last ran “${match.name}”.`) : '';
      setSearchNote(ranked.length
        ? `Showing ${shown}${ranked.length > shown ? ` of ${ranked.length}` : ''} individual job ${shown === 1 ? 'listing' : 'listings'} posted within the ${windowText}${ranked.length < PAGE_SIZE ? `. Fewer than ${PAGE_SIZE} passed our checks` : ''}.${news} ${searched}${boards}${left}${failed}`
        : `No individual job listings for your places, sources and the ${windowText} passed our checks. ${searched}${boards}${left}${failed} Try a longer window, more sources or places, or broader titles.`);
      setTab('radar');
      // On a phone the long profile form would sit above the results, so fold it away once there are some.
      if (ranked.length > 0 && isNarrowScreen()) {
        setShowProfileForm(false);
        window.setTimeout(() => scrollToElement(resultsRef.current), 60); // after the form has folded away
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to search right now.';
      setSearchError(message);
      setResults([]);
      setNewKeys(new Set());
      setLastQueries(null);
      setSearchNote('You can still search directly on public job-search pages or add a posting URL manually.');
    } finally {
      setLoading(false);
    }
  }

  /** Reveals the next 10 listings already found, or runs one more bounded search when none are left. */
  async function searchMore() {
    if (loading || loadingMore) return;
    if (results.length > visibleCount) {
      const next = revealNext(results.length, visibleCount);
      setVisibleCount(next);
      setSearchNote(`Showing ${next} of ${results.length} individual job listings found so far.`);
      return;
    }
    if (noMore || batch >= MAX_BATCHES || results.length === 0) return;
    const windowId: TimeWindowId = profile.timeWindow;
    const windowText = windowLabel(windowId);
    setLoadingMore(true);
    setSearchError('');
    try {
      const payload = await requestSearch(snapshotOf(profile), {
        page: batch + 1,
        seen: results.map((job) => job.key).filter((key): key is string => Boolean(key)).slice(0, 300),
      }, 'Search service is not available right now.');
      const known = new Set(results.flatMap((job) => [job.url, job.key].filter(Boolean) as string[]));
      const inWindow = usableListings(payload, windowId)
        .filter((job) => !known.has(job.key ?? '') && !known.has(canonicalizeUrl(job.url)));
      const fresh = rankJobs(inWindow, profile);
      // Extra listings found for a saved search are also remembered, and are new if the search had not shown them.
      const active = savedSearches.find((entry) => entry.id === activeSearchId && sameSearch(entry.search, snapshotOf(profile)));
      if (active && fresh.length > 0) {
        const freshKeys = fresh.map(keyOf);
        const unseen = newSince(active, freshKeys);
        setNewKeys((current) => new Set([...current, ...unseen]));
        setSavedSearches((current) => current.map((entry) => entry.id === active.id ? afterRun(entry, freshKeys) : entry));
      }
      setBatch(batch + 1);
      if (fresh.length === 0) {
        setNoMore(true);
        setSearchNote(`No more new individual listings were found for your places and sources in the ${windowText}.${describeExclusions(payload.excluded, windowAge(windowId))} Try a longer window or more sources.`);
      } else {
        setResults([...results, ...fresh]);
        setVisibleCount(visibleAfterFetch(results.length, fresh.length));
        setSearchNote(`Added ${plural(Math.min(fresh.length, PAGE_SIZE), 'new listing')} from a different search.${describeExclusions(payload.excluded, windowAge(windowId))}${describeFailures(payload.queriesFailed, (payload.queriesRun ?? 0) + (payload.queriesFailed ?? 0))}`);
      }
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Unable to search for more jobs right now.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function analyzeJob(job: JobResult): Promise<AiAnalysis> {
    const response = await fetch('/api/analyze-job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: {
          targetRoles: profile.targetRoles,
          skills: profile.skills,
          location: profile.locations.join('; '),
          education: profile.education,
          // The resume/experience text is only included when the user ticks the opt-in box.
          resumeText: aiIncludeResume ? profile.experienceSummary : '',
        },
        // The longer listing text is sent when the search found it, so the explanation rests on more than a snippet.
        job: { title: job.title, domain: job.domain, content: job.details || job.content },
      }),
    });
    const payload = await response.json().catch(() => null) as { analysis?: AiAnalysis; error?: string } | null;
    if (!response.ok || !payload?.analysis) throw new Error(payload?.error || 'AI analysis is not available right now.');
    return payload.analysis;
  }

  async function generateLetter(job: JobResult, request: LetterRequest): Promise<GeneratedLetter> {
    const response = await fetch('/api/cover-letter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: {
          targetRoles: profile.targetRoles,
          skills: profile.skills,
          education: profile.education,
          // The resume text is only included when the user ticks the box for this letter.
          resumeText: request.includeResume ? profile.experienceSummary : '',
        },
        job: { title: job.title, domain: job.domain, content: job.details || job.content },
        options: { tone: request.tone, emphasis: request.emphasis, name: request.name },
      }),
    });
    const payload = await response.json().catch(() => null) as (Partial<GeneratedLetter> & { error?: string }) | null;
    if (!response.ok || !payload || typeof payload.letter !== 'string') throw new Error(payload?.error || 'AI cover letters are not available right now. You can use the template instead.');
    return {
      letter: payload.letter,
      model: typeof payload.model === 'string' ? payload.model : '',
      placeholders: Array.isArray(payload.placeholders) ? payload.placeholders.filter((item): item is string => typeof item === 'string') : [],
      unsupportedNumbers: Array.isArray(payload.unsupportedNumbers) ? payload.unsupportedNumbers.filter((item): item is string => typeof item === 'string') : [],
    };
  }

  function keepLetter(job: JobResult, text: string) {
    setLetters((current) => saveLetter(current, job.url, { text, title: job.title }));
  }

  function saveCurrentSearch(name: string) {
    const snapshot = snapshotOf(profile);
    if (!snapshot.targetRoles.trim() || snapshot.sources.length === 0) {
      setSearchError('Add a target role and choose at least one source before saving a search.');
      return;
    }
    // The results on screen count as already seen only when they came from this very search.
    const keys = resultsSignature === searchSignature(snapshot) ? results.map(keyOf) : [];
    const outcome = addSearch(savedSearches, createSearch(snapshot, keys, new Date(), name));
    if (outcome.outcome === 'full') {
      setSearchError('You can keep up to 10 saved searches. Delete one first.');
      return;
    }
    setSavedSearches(outcome.list);
    if (keys.length > 0) setActiveSearchId(outcome.id);
    setSearchError('');
    setSearchNote(outcome.outcome === 'updated'
      ? 'That search was already saved, so its history was kept.'
      : keys.length > 0 ? 'Search saved. Listings now on screen count as seen; later runs will show what is new.' : 'Search saved. Run it once to set the starting point for “new” listings.');
  }

  function removeSavedSearch(id: string) {
    setSavedSearches((current) => removeSearch(current, id));
    if (activeSearchId === id) { setActiveSearchId(null); setNewKeys(new Set()); }
  }

  /** Looks for new listings without touching the results on screen. Returns false when the search failed. */
  async function checkOne(entry: SavedSearch): Promise<boolean> {
    try {
      const payload = await requestSearch(entry.search, {}, 'Search service is not available right now.');
      const ranked = rankJobs(usableListings(payload, entry.search.timeWindow), applySnapshot(profile, entry.search));
      setSavedSearches((current) => current.map((item) => item.id === entry.id ? afterCheck(item, ranked.map(keyOf)) : item));
      return true;
    } catch (error) {
      setSearchError(`Could not check “${entry.name}”: ${error instanceof Error ? error.message : 'search failed.'}`);
      return false;
    }
  }

  async function checkSearch(entry: SavedSearch) {
    if (checking || loading) return;
    setChecking(entry.id);
    setSearchError('');
    if (await checkOne(entry)) setSearchNote(`Checked “${entry.name}”. Run it to see the listings.`);
    setChecking(null);
  }

  async function checkAllSearches() {
    if (checking || loading) return;
    setChecking('all');
    setSearchError('');
    let done = 0;
    for (const entry of savedSearches) {
      if (!(await checkOne(entry))) break; // stop at the first failure, such as the request limit
      done += 1;
    }
    if (done === savedSearches.length) setSearchNote(`Checked ${plural(done, 'saved search', 'saved searches')}.`);
    setChecking(null);
  }

  function followCompany(id: string) {
    setProfile((current) => ({ ...current, companies: sanitizeCompanies([...current.companies, id], MAX_FOLLOWED) }));
    setSearchNote(`Following ${companyLabel(id)}. Its openings are read on your next search.`);
  }

  function saveJob(job: JobResult) {
    if (savedUrlSet.has(job.url)) return;
    setSavedJobs((current) => [{ ...job, status: 'Saved', savedAt: new Date().toISOString() }, ...current]);
  }

  function updateStatus(id: string, status: ApplicationStatus) {
    setSavedJobs((current) => current.map((job) => job.id === id ? setStatus(job, status) : job));
  }

  function updateTracking(id: string, patch: Pick<JobResult, 'notes' | 'followUpAt'>) {
    setSavedJobs((current) => current.map((job) => job.id === id ? { ...job, ...patch } : job));
  }

  /** One click: saves the job if needed and marks it applied, with the date and a follow-up reminder. */
  function applyTo(job: JobResult) {
    setSavedJobs((current) => current.some((entry) => entry.url === job.url)
      ? current.map((entry) => entry.url === job.url ? markApplied(entry) : entry)
      : [markApplied({ ...job, savedAt: new Date().toISOString() }), ...current]);
  }

  function openListing(job: JobResult) {
    if (!hasApplied(savedStatusByUrl.get(job.url))) returnPrompt.watch(job);
  }

  function confirmApplied() {
    if (returnJob) applyTo(returnJob);
    setReturnJob(null);
  }

  function exportCsv() {
    downloadText(`careerpilot-saved-jobs-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(visibleSaved), 'text/csv;charset=utf-8');
  }

  function removeSavedJob(id: string) {
    setSavedJobs((current) => current.filter((job) => job.id !== id));
  }

  function exportBackup() {
    const payload = {
      product: 'CareerPilot Job Radar',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      profile,
      savedJobs,
      savedSearches,
      coverLetters: letters,
    };
    downloadText(`careerpilot-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
  }

  async function importBackup(file?: File) {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object' || !('profile' in parsed) || !('savedJobs' in parsed)) {
        throw new Error('This file does not look like a CareerPilot backup.');
      }
      const backup = parsed as { profile: CareerProfile; savedJobs: JobResult[] };
      if (!Array.isArray(backup.savedJobs)) throw new Error('Saved jobs in this backup are invalid.');
      setProfile(sanitizeProfile({ ...DEFAULT_PROFILE, ...(backup.profile && typeof backup.profile === 'object' ? backup.profile : {}) }));
      setSavedJobs(normalizeJobs(backup.savedJobs));
      // Backups made before saved searches existed simply leave the saved searches as they are.
      if ('savedSearches' in backup) setSavedSearches(sanitizeSavedSearches((backup as { savedSearches: unknown }).savedSearches));
      if ('coverLetters' in backup) setLetters(sanitizeLetters((backup as { coverLetters: unknown }).coverLetters));
      setSearchNote('Backup imported on this device.');
      setSearchError('');
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Could not import this backup.');
    } finally {
      if (importInput.current) importInput.current.value = '';
    }
  }

  function addManualJob() {
    if (!manualTitle.trim() || !manualUrl.trim()) {
      setSearchError('A job title and valid application URL are required.');
      return;
    }
    let url: URL;
    try {
      url = new URL(manualUrl.trim());
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS links are supported.');
    } catch {
      setSearchError('Enter a valid URL beginning with https:// or http://.');
      return;
    }
    const raw: RawJobResult = {
      title: `${manualTitle.trim()}${manualCompany.trim() ? ` — ${manualCompany.trim()}` : ''}`,
      url: url.toString(),
      content: [manualLocation.trim(), manualDescription.trim()].filter(Boolean).join('. '),
    };
    const job = rankJobs([raw], profile)[0];
    if (!job) return;
    if (!savedJobs.some((existing) => existing.url === job.url)) {
      setSavedJobs((current) => [{ ...job, status: 'Saved', savedAt: new Date().toISOString() }, ...current]);
    }
    setManualTitle(''); setManualCompany(''); setManualUrl(''); setManualLocation(''); setManualDescription('');
    setShowManualForm(false); setSearchError(''); setTab('saved');
  }

  /** A "Follow company" offer for a listing on a Greenhouse or Lever board that is not followed yet. */
  const followFor = (job: JobResult): FollowOffer | undefined => {
    const board = companyFromUrl(job.url);
    if (!board) return undefined;
    const id = companyId(board);
    return { label: companyLabel(id), following: followedIds.has(id), onFollow: () => followCompany(id) };
  };

  const field = (label: string, hint: string, value: string, onChange: (value: string) => void, placeholder: string, rows = 1) => (
    <label className="field">
      <span className="field-label">{label}</span>
      {rows === 1 ? <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /> : <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={rows} />}
      <span className="field-hint">{hint}</span>
    </label>
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="CareerPilot home">
          <span className="brand-mark"><Target size={21} strokeWidth={2.4} /></span>
          <span>Career<span className="brand-accent">Pilot</span><small>JOB RADAR</small></span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <button className={tab === 'radar' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('radar')}><Search size={16} /> Find jobs</button>
          <button className={tab === 'saved' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('saved')}><Bookmark size={16} /> Saved jobs <span className="nav-count">{savedJobs.length}</span>{dueCount > 0 && <span className="nav-due" title={`${dueCount} follow-up${dueCount === 1 ? '' : 's'} due`} aria-label={`${dueCount} follow-ups due`}>{dueCount}</span>}</button>
        </nav>
        <div className="topbar-right">
          <span className="privacy-indicator"><ShieldCheck size={15} /> Local-first</span>
          <button className="icon-button" title="Export backup" aria-label="Export backup" onClick={exportBackup}><FileDown size={18} /></button>
          <button className="avatar" title="Career profile" onClick={() => { setShowProfileForm(true); setTab('radar'); }}>CP</button>
        </div>
      </header>

      <main id="top" className="page-wrap">
        <section className="welcome-row">
          <div>
            <div className="eyebrow"><span className="eyebrow-dot" /> YOUR NEXT OPPORTUNITY STARTS HERE</div>
            <h1>Find work that <span>fits your story.</span></h1>
            <p className="hero-copy">Search public job listings, see why they may match your experience, and keep every opportunity organized.</p>
          </div>
          <div className="hero-badge"><div className="hero-badge-icon"><Sparkles size={19} /></div><div><strong>Your career. Your data.</strong><span>Your profile stays on this device.</span></div></div>
        </section>

        <section className="metrics-row" aria-label="Your job search overview">
          <div className="metric-card"><div className="metric-icon blue"><Search size={18} /></div><div><span>Results shown</span><strong>{shownResults.length}</strong><small>Latest search</small></div></div>
          <div className="metric-card"><div className="metric-icon green"><Target size={18} /></div><div><span>Strong matches</span><strong>{strongCount}</strong><small>70%+ preliminary fit</small></div></div>
          <div className="metric-card"><div className="metric-icon purple"><Bookmark size={18} /></div><div><span>Saved opportunities</span><strong>{savedJobs.length}</strong><small>Tracked on this device</small></div></div>
          <div className="metric-card"><div className="metric-icon amber"><TrendingUp size={18} /></div><div><span>In progress</span><strong>{savedJobs.filter((job) => ['Applied', 'Interview', 'Offer'].includes(job.status)).length}</strong><small>Applied, interview or offer</small></div></div>
        </section>

        <div className="content-grid">
          <aside className="sidebar">
            <section className="panel profile-panel">
              <button className="panel-heading collapsible-heading" onClick={() => setShowProfileForm((current) => !current)} aria-expanded={showProfileForm}>
                <span className="heading-icon"><SlidersHorizontal size={18} /></span><span className="heading-copy"><strong>Career profile</strong><small>Personalize your matches</small></span><ChevronDown className={showProfileForm ? 'chevron open' : 'chevron'} size={17} />
              </button>
              {showProfileForm && <div className="profile-form">
                {field('Target job titles', 'Separate multiple titles with commas.', profile.targetRoles, (value) => updateProfile('targetRoles', value), 'e.g. Operations Manager, Supply Chain Analyst', 2)}
                {field('Skills & tools', 'Use the skills you can demonstrate.', profile.skills, (value) => updateProfile('skills', value), 'e.g. SAP S/4HANA, Excel, freight auditing', 3)}
                <LocationPicker value={profile.locations} onChange={updateLocations} />
                <label className="field"><span className="field-label">Work preference</span><select value={profile.workMode} onChange={(event) => updateProfile('workMode', event.target.value as WorkMode)}><option>Any</option><option>Remote</option><option>Hybrid</option><option>On-site</option></select></label>
                <div className="cv-upload">
                  <button type="button" className="secondary-button full-width" onClick={() => cvInput.current?.click()} disabled={cvLoading}><FileUp size={15} /> {cvLoading ? 'Reading CV…' : cvName ? `Replace CV (${cvName})` : 'Upload CV (PDF, DOCX or TXT)'}</button>
                  <input ref={cvInput} type="file" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" className="hidden-input" onChange={(event) => void uploadCv(event.target.files?.[0])} />
                  <small className="ai-extract-note">The file is read in your browser and never uploaded. Only its text is used.</small>
                </div>
                {field('Resume text / experience summary', 'Paste text from your resume. Extraction runs in your browser.', profile.experienceSummary, (value) => updateProfile('experienceSummary', value), 'Paste your resume text here. You can remove your phone, email and address first…', 5)}
                <label className="ai-optin"><input type="checkbox" checked={aiIncludeResume} onChange={(event) => setAiIncludeResume(event.target.checked)} /><span>Share this resume text with the AI model when I click “Explain with Nemotron”. Off by default.</span></label>
                <button className="primary-button full-width ai-extract-button" onClick={() => void extractWithNemotron()} disabled={extracting}><Sparkles size={15} /> {extracting ? 'Reading your resume…' : 'Extract profile with Nemotron AI'}</button>
                <small className="ai-extract-note">Sends the resume text above to NVIDIA Nemotron on Nebius. Nothing is sent until you click.</small>
                <button className="secondary-button full-width extract-button" onClick={() => extractResumeDetails()}><Sparkles size={15} /> Extract locally (private, rule-based)</button>
                {field('Education & qualifications', 'Add or correct degrees and certifications.', profile.education, (value) => updateProfile('education', value), 'e.g. BBA, PMP, relevant certifications', 2)}
                <div className="search-settings">
                  <label className="field"><span className="field-label">Posted within *</span>
                    <select value={profile.timeWindow} onChange={(event) => updateProfile('timeWindow', event.target.value as TimeWindowId)} aria-label="Posted within">
                      {TIME_WINDOWS.map((window) => <option key={window.id} value={window.id}>{window.label}</option>)}
                    </select>
                    <span className="field-hint">Required. Listings older than this, or without a verifiable posting date, are never shown.</span>
                  </label>
                  <SourcePicker value={profile.sources} onChange={(sources) => setProfile((current) => ({ ...current, sources }))} />
                  <CompanyFollow value={profile.companies} onChange={(companies) => updateProfile('companies', companies)} />
                </div>
                <div className="local-note"><ShieldCheck size={16} /><span><strong>Private by default</strong>Your pasted resume and education stay in this browser. Search sends only target roles, skills, locations, work preference, time window, sources and any companies you follow. The optional Nemotron features send more: query planning uses the same roles, skills and location; “Extract profile with Nemotron AI” sends the resume text when you click it; job explanations send your education and the snippet — plus resume text only if you tick the box above; cover letters send the listing text, your roles, skills, education and the name you type, plus resume text only if you tick the box in the letter window.</span></div>
                <button className="primary-button full-width" onClick={() => void runSearch()} disabled={loading}><Search size={17} /> {loading ? 'Searching the web…' : 'Find matching jobs'} <ArrowRight size={17} /></button>
                <button className="text-button full-width" onClick={() => { setProfile(sanitizeProfile(DEFAULT_PROFILE)); setCvName(''); setSearchError(''); setSearchNote('Profile cleared on this device.'); }}>Clear profile</button>
              </div>}
            </section>

            <SavedSearches
              searches={savedSearches}
              activeId={activeSearchId}
              canSave={Boolean(profile.targetRoles.trim()) && profile.sources.length > 0}
              busy={loading || checking !== null}
              checking={checking}
              onSave={saveCurrentSearch}
              onRun={(entry) => void runSearch(entry)}
              onCheck={(entry) => void checkSearch(entry)}
              onCheckAll={() => void checkAllSearches()}
              onRemove={removeSavedSearch}
            />

            <section className="panel quick-panel">
              <div className="quick-title"><span className="heading-icon"><Zap size={17} /></span><strong>Quick actions</strong></div>
              <button className="quick-action" onClick={() => setShowManualForm(true)}><span className="quick-action-icon"><ExternalLink size={16} /></span><span><strong>Add a job URL</strong><small>Save a listing you found elsewhere</small></span><ArrowDownRight size={16} /></button>
              <button className="quick-action" onClick={exportBackup}><span className="quick-action-icon"><FileDown size={16} /></span><span><strong>Export backup</strong><small>Download profile, saved jobs, searches and letters</small></span><ArrowDownRight size={16} /></button>
              <button className="quick-action" onClick={() => importInput.current?.click()}><span className="quick-action-icon"><RefreshCw size={16} /></span><span><strong>Restore backup</strong><small>Import a CareerPilot JSON backup</small></span><ArrowDownRight size={16} /></button>
              <input ref={importInput} type="file" accept="application/json,.json" className="hidden-input" onChange={(event) => void importBackup(event.target.files?.[0])} />
            </section>

            <section className="tips-card"><div className="tips-icon"><CircleHelp size={18} /></div><div><strong>Get better matches</strong><p>Use 3–8 specific skills and more than one realistic target title. Broad profiles usually return noisier results.</p></div></section>
          </aside>

          <section className="results-column" ref={resultsRef}>
            <div className="results-header">
              <div className="results-tabs"><button className={tab === 'radar' ? 'results-tab active' : 'results-tab'} onClick={() => setTab('radar')}>Job radar <span>{shownResults.length}</span></button><button className={tab === 'saved' ? 'results-tab active' : 'results-tab'} onClick={() => setTab('saved')}>Saved jobs <span>{savedJobs.length}</span></button></div>
              <button className="secondary-button" onClick={() => setShowManualForm(true)}><ExternalLink size={15} /> Add URL</button>
            </div>

            {searchError && <div className="alert error-alert"><X size={17} /><span>{searchError}</span><button aria-label="Dismiss message" onClick={() => setSearchError('')}><X size={15} /></button></div>}
            {searchNote && !searchError && <div className="alert info-alert"><CheckCircle2 size={17} /><span>{searchNote}</span></div>}

            {tab === 'radar' ? <>
              <div className="list-intro"><div><h2>{shownResults.length ? 'Recommended for you' : 'Ready when you are'}</h2><p>{results.length ? (queryLabel ? `Search · ${queryLabel}` : 'Ranked by visible job details and your skills') : 'Run a job search to discover roles from across the public web.'}</p></div>{results.length > 0 && <button className="refresh-button" onClick={() => void runSearch()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh</button>}</div>

              {lastQueries && results.length > 0 && <details className="query-list"><summary>{lastQueries.planner === 'nemotron' ? 'Searches planned by NVIDIA Nemotron' : 'Searches used (rule-based)'}</summary><ul>{lastQueries.queries.map((query) => <li key={query}>{query}</li>)}</ul></details>}

              {results.length > 0 && <div className="filter-row"><div className="filter-label"><Filter size={15} /> Match filter</div><div className="filter-pills"><button className={filter === 'all' ? 'filter-pill selected' : 'filter-pill'} onClick={() => setFilter('all')}>All <span>{shownResults.length}</span></button><button className={filter === 'strong' ? 'filter-pill selected' : 'filter-pill'} onClick={() => setFilter('strong')}>Strong <span>{shownResults.filter((job) => job.matchScore >= 70).length}</span></button><button className={filter === 'medium' ? 'filter-pill selected' : 'filter-pill'} onClick={() => setFilter('medium')}>Possible <span>{shownResults.filter((job) => job.matchScore >= 40 && job.matchScore < 70).length}</span></button>{newKeys.size > 0 && <button className={filter === 'new' ? 'filter-pill selected' : 'filter-pill'} aria-pressed={filter === 'new'} onClick={() => setFilter('new')}>New <span>{newShown}</span></button>}</div></div>}

              {loading && <div className="loading-state" role="status" aria-live="polite"><span className="loader" /><strong>Searching public job listings</strong><p>Checking several targeted searches and comparing the results.</p></div>}
              {loading && <div className="skeleton-list" aria-hidden="true">{[0, 1, 2].map((index) => <div className="skeleton-card" key={index}><span className="skeleton-line wide" /><span className="skeleton-line" /><span className="skeleton-line short" /></div>)}</div>}

              {!loading && results.length === 0 && <div className="empty-state"><div className="empty-art"><div className="empty-orbit orbit-one" /><div className="empty-orbit orbit-two" /><div className="empty-icon"><Search size={29} /></div><span className="sparkle sparkle-one">✦</span><span className="sparkle sparkle-two">✧</span></div><h3>Make your next move</h3><p>Add a target role and preferred location, then search. CareerPilot will gather public results, rank them, and show the original URLs where available.</p><button className="primary-button" onClick={() => { setShowProfileForm(true); void runSearch(); }} disabled={!profile.targetRoles.trim()}><Search size={17} /> Search for jobs</button>
                  <div className="divider-or"><span>or search directly</span></div><div className="fallback-links">{fallbackLinks.map((link) => <a key={link.label} href={link.url} target="_blank" rel="noreferrer"><Globe2 size={15} /> {link.label} <ExternalLink size={13} /></a>)}</div>
                </div>}

              {!loading && results.length > 0 && visibleResults.length === 0 && <div className="small-empty"><Filter size={20} /><strong>No results in this range</strong><span>Choose another filter to see more listings.</span></div>}
              {!loading && visibleResults.map((job) => <JobCard key={job.id} job={job} saved={savedUrlSet.has(job.url)} onSave={() => saveJob(job)} savedStatus={savedStatusByUrl.get(job.url)} onApplied={() => applyTo(job)} onOpen={() => openListing(job)} isNew={newKeys.has(keyOf(job))} follow={followFor(job)} hasLetter={Boolean(letters[job.url])} onCoverLetter={() => setLetterJob(job)} onAnalyze={analyzeJob} canAnalyze={Boolean(profile.targetRoles.trim())} />)}

              {!loading && results.length > 0 && (canSearchMore || loadingMore) && <div className="more-row"><button className="secondary-button more-button" onClick={() => void searchMore()} disabled={loadingMore} aria-busy={loadingMore}>{loadingMore && <RefreshCw size={15} className="spin" />}Search More Jobs</button></div>}

              {!loading && results.length > 0 && <div className="results-footnote"><ShieldCheck size={16} /><span>Preliminary matches are based on available search-result text, not a complete evaluation of every job description. Open the original listing to verify requirements, posting status and application details.</span></div>}
              {!loading && results.length === 0 && <div className="direct-search-note"><span className="direct-search-dot" /><span>If web search is unavailable or finds too few results, use a direct search link or broaden your query.</span></div>}
            </> : <>
              <div className="list-intro"><div><h2>Your saved opportunities</h2><p>Keep track of listings and update each application stage.</p></div><span className="saved-total"><Bookmark size={15} /> {savedJobs.length} saved</span></div>
              {savedJobs.length > 0 && <div className="saved-tools">
                <div className="filter-pills" role="group" aria-label="Show saved jobs by stage">
                  {(['all', ...STATUS_OPTIONS] as SavedFilter[]).map((option) => <button key={option} className={savedFilter === option ? 'filter-pill selected' : 'filter-pill'} aria-pressed={savedFilter === option} onClick={() => setSavedFilter(option)}>{option === 'all' ? 'All' : option} <span>{statusCounts[option]}</span></button>)}
                </div>
                <button className="secondary-button" onClick={exportCsv} disabled={visibleSaved.length === 0}><FileDown size={15} /> Export CSV</button>
              </div>}
              {dueCount > 0 && <div className="alert info-alert due-alert"><CalendarClock size={17} /><span>{dueCount} follow-up{dueCount === 1 ? ' is' : 's are'} due. They are listed first.</span></div>}
              {savedJobs.length === 0 ? <div className="small-empty saved-empty"><Bookmark size={23} /><strong>No saved jobs yet</strong><span>Search for openings and save the ones worth pursuing, or add a URL manually.</span><button className="secondary-button" onClick={() => setTab('radar')}>Go to Job Radar <ArrowRight size={15} /></button></div> 
                : visibleSaved.length === 0 ? <div className="small-empty"><Filter size={20} /><strong>No jobs at this stage</strong><span>Pick another stage, or move a job here from its status menu.</span></div>
                : visibleSaved.map((job) => <JobCard key={job.id} job={job} saved onSave={() => undefined} today={today} onTrackingChange={(patch) => updateTracking(job.id, patch)} onOpen={() => openListing(job)} statusControl onStatusChange={(status) => updateStatus(job.id, status)} onRemove={() => removeSavedJob(job.id)} hasLetter={Boolean(letters[job.url])} onCoverLetter={() => setLetterJob(job)} onAnalyze={analyzeJob} canAnalyze={Boolean(profile.targetRoles.trim())} />)}
            </>}
          </section>
        </div>

        <footer className="footer"><span>© 2026 CareerPilot · Job Radar MVP</span><span><ShieldCheck size={14} /> Local-first by design</span><span>Built for clearer career decisions.</span></footer>
      </main>

      {showManualForm && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowManualForm(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="manual-modal-title"><div className="modal-heading"><div><span className="eyebrow">SAVE AN OPPORTUNITY</span><h2 id="manual-modal-title">Add a job URL</h2><p>Save a listing from any portal or company career page.</p></div><button className="icon-button" onClick={() => setShowManualForm(false)} aria-label="Close dialog"><X size={19} /></button></div><div className="modal-fields">
        <label className="field"><span className="field-label">Job title *</span><input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} placeholder="e.g. Supply Chain Manager" /></label>
        <label className="field"><span className="field-label">Company</span><input value={manualCompany} onChange={(event) => setManualCompany(event.target.value)} placeholder="Company name" /></label>
        <label className="field"><span className="field-label">Application URL *</span><input type="url" value={manualUrl} onChange={(event) => setManualUrl(event.target.value)} placeholder="https://company.com/careers/job-id" /></label>
        <label className="field"><span className="field-label">Location</span><input value={manualLocation} onChange={(event) => setManualLocation(event.target.value)} placeholder="City or remote" /></label>
        <label className="field"><span className="field-label">Job description or notes</span><textarea value={manualDescription} onChange={(event) => setManualDescription(event.target.value)} placeholder="Paste key requirements or notes for your own reference…" rows={4} /></label>
      </div><div className="modal-footer"><button className="secondary-button" onClick={() => setShowManualForm(false)}>Cancel</button><button className="primary-button" onClick={addManualJob}><Bookmark size={16} /> Save opportunity</button></div></section></div>}
      {letterJob && <CoverLetterDialog
        key={letterJob.url}
        job={letterJob}
        initialText={letters[letterJob.url]?.text ?? ''}
        name={letterName}
        onNameChange={setLetterName}
        skills={profile.skills}
        education={profile.education}
        hasResume={Boolean(profile.experienceSummary.trim())}
        canGenerate={Boolean(profile.targetRoles.trim())}
        onGenerate={(request) => generateLetter(letterJob, request)}
        onSave={(text) => keepLetter(letterJob, text)}
        onClose={() => setLetterJob(null)}
      />}
      {returnJob && <div className="return-prompt" role="dialog" aria-label="Did you apply?">
        <div className="return-prompt-text"><strong>Did you apply?</strong><span>{returnJob.title}</span></div>
        <div className="return-prompt-actions">
          <button className="primary-button" onClick={confirmApplied}><Check size={15} /> Yes, mark applied</button>
          <button className="secondary-button" onClick={() => setReturnJob(null)}>Not yet</button>
        </div>
      </div>}
    </div>
  );
}

interface FollowOffer { label: string; following: boolean; onFollow: () => void }

interface JobCardProps {
  job: JobResult;
  saved: boolean;
  onSave: () => void;
  statusControl?: boolean;
  onStatusChange?: (status: ApplicationStatus) => void;
  onRemove?: () => void;
  onAnalyze?: (job: JobResult) => Promise<AiAnalysis>;
  canAnalyze?: boolean;
  /** Stage of the saved copy of this job, when there is one (search results only). */
  savedStatus?: ApplicationStatus;
  onApplied?: () => void;
  onOpen?: () => void;
  today?: string;
  onTrackingChange?: (patch: Pick<JobResult, 'notes' | 'followUpAt'>) => void;
  /** The listing was not shown the last time this saved search was run. */
  isNew?: boolean;
  follow?: FollowOffer;
  /** Opens the cover letter dialog. */
  onCoverLetter?: () => void;
  hasLetter?: boolean;
}

function JobCard({ job, saved, onSave, statusControl = false, onStatusChange, onRemove, onAnalyze, canAnalyze = false, savedStatus, onApplied, onOpen, today, onTrackingChange, isNew = false, follow, onCoverLetter, hasLetter = false }: JobCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState('');

  async function runAnalysis() {
    if (!onAnalyze || analysisLoading) return;
    setAnalysisLoading(true);
    setAnalysisError('');
    try {
      setAnalysis(await onAnalyze(job));
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'AI analysis failed.');
    } finally {
      setAnalysisLoading(false);
    }
  }

  const scoreTone = job.matchScore >= 70 ? 'strong' : job.matchScore >= 40 ? 'possible' : 'low';
  const resultHint = /\b(job|jobs|career|careers|apply|application|vacancy|vacancies|hiring|position|opening|recruitment)\b/i.test(`${job.title} ${job.content} ${job.url}`);
  return <article className="job-card">
    <div className="job-card-top"><div className="company-symbol">{job.domain.slice(0, 1).toUpperCase()}</div><div className="job-main"><div className="job-kicker">{isNew && <span className="new-chip">New</span>}<span>{job.domain}</span>{ageLabel(job.publishedDate) && <><span className="dot-sep">·</span><span className="age-chip" title={niceDate(job.publishedDate) ?? undefined}>{ageLabel(job.publishedDate)}</span></>}</div><h3>{job.title}</h3><div className="job-meta"><span>{job.fromBoard ? <><Building2 size={13} /> Company job board</> : <><Globe2 size={13} /> Public web result</>}</span><span className="job-type"><BriefcaseBusiness size={13} /> {resultHint ? 'Potential listing' : 'Related result'}</span>{statusControl && today && <FollowUpChip job={job} today={today} />}</div></div><div className={`match-badge ${scoreTone}`}><strong>{job.matchScore}%</strong><span>match</span></div></div>
    <p className="job-snippet">{job.content || 'The search result did not provide a detailed snippet. Open the original page to verify the role.'}</p>
    {job.matchedTerms.length > 0 || job.missingTerms.length > 0
      ? <div className="chips" aria-label="How this listing matches your profile">
        {job.matchedTerms.slice(0, 5).map((term) => <span className="chip chip-match" key={`m-${term}`}><CheckCircle2 size={12} aria-hidden="true" /><span className="sr-only">Found: </span>{term}</span>)}
        {job.missingTerms.slice(0, 4).map((term) => <span className="chip chip-gap" key={`g-${term}`}><span className="sr-only">{job.details ? 'Not found in listing text: ' : 'Not visible in snippet: '}</span>{term}</span>)}
        {job.missingTerms.length > 4 && <span className="chip chip-gap" aria-label={`${job.missingTerms.length - 4} more skills not visible`}>+{job.missingTerms.length - 4}</span>}
      </div>
      : <div className="evidence-line"><CircleHelp size={14} /><span>Limited matching evidence in the visible result</span></div>}
    {(analysis || analysisError) && <div className="ai-panel">{analysisError ? <div className="ai-error"><X size={14} /><span>{analysisError}</span></div> : analysis && <>
      <div className="ai-head"><Sparkles size={14} /><strong>AI explanation</strong><span className={`ai-verdict ${analysis.verdict}`}>{analysis.verdict}</span></div>
      <p>{analysis.summary}</p>
      {analysis.strengths.length > 0 && <div className="ai-list"><b>Matches</b><ul>{analysis.strengths.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      {analysis.gaps.length > 0 && <div className="ai-list"><b>Possible gaps</b><ul>{analysis.gaps.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      {analysis.verify.length > 0 && <div className="ai-list"><b>Verify on the original listing</b><ul>{analysis.verify.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      <small>Generated by NVIDIA Nemotron from {job.details ? 'the listing text the search found' : 'the search snippet only'}. It can be wrong; the percentage above is unchanged.</small></>}</div>}
    {showDetails && <div className="job-details"><div><strong>Original source</strong><a href={job.url} target="_blank" rel="noreferrer">{job.url} <ExternalLink size={12} /></a></div><div><strong>Match interpretation</strong><p>The percentage is a keyword-based preliminary ranking of the available title, URL and {job.details ? 'listing text' : 'snippet'}. It is not a hiring probability and may change after the full job description is reviewed.</p></div>{job.details && <div><strong>Listing text the search found</strong><p className="listing-text">{job.details}</p></div>}</div>}
    {statusControl && today && onTrackingChange && <TrackerFields job={job} today={today} onChange={onTrackingChange} />}
    <div className="job-card-footer"><button className="details-button" onClick={() => setShowDetails((current) => !current)}>{showDetails ? 'Hide details' : 'Why this match?'} <ChevronDown className={showDetails ? 'chevron open' : 'chevron'} size={14} /></button><div className="job-actions">{statusControl && <select className={`status-select status-${job.status.toLowerCase()}`} value={job.status} onChange={(event) => onStatusChange?.(event.target.value as ApplicationStatus)} aria-label={`Application status for ${job.title}`}>{STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select>}{statusControl && <button className="icon-button danger" title="Remove saved job" aria-label="Remove saved job" onClick={onRemove}><Trash2 size={16} /></button>}{!statusControl && <button className={saved ? 'save-button saved' : 'save-button'} onClick={onSave} disabled={saved}>{saved ? <><Check size={15} /> Saved</> : <><Bookmark size={15} /> Save job</>}</button>}{!statusControl && onApplied && <button className={hasApplied(savedStatus) ? 'applied-button done' : 'applied-button'} onClick={onApplied} disabled={hasApplied(savedStatus)}>{hasApplied(savedStatus) ? <><Check size={15} /> Applied</> : <><Send size={14} /> Mark applied</>}</button>}{onCoverLetter && <button className="secondary-button letter-button" onClick={onCoverLetter} title={hasLetter ? 'Open the cover letter kept for this job' : 'Draft a cover letter for this job'}><FileText size={14} /> {hasLetter ? 'Edit cover letter' : 'Cover letter'}</button>}{onAnalyze && <button className="secondary-button ai-button" onClick={() => void runAnalysis()} disabled={!canAnalyze || analysisLoading} title={canAnalyze ? 'Explain this match with an AI model' : 'Add a target job title first'}><Sparkles size={14} /> {analysisLoading ? 'Analyzing…' : analysis ? 'Re-run AI' : 'Explain with Nemotron'}</button>}{follow && !statusControl && <button className="text-button follow-button" onClick={follow.onFollow} disabled={follow.following} title={follow.following ? `${follow.label} is followed` : `Read ${follow.label}'s job board on every search`}>{follow.following ? <><Check size={13} /> Following</> : <><Building2 size={13} /> Follow company</>}</button>}<a className="apply-button" href={job.url} target="_blank" rel="noreferrer" onClick={onOpen}>Open listing <ExternalLink size={14} /></a></div></div>
  </article>;
}

export default App;
