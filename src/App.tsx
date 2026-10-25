import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight, ArrowRight, Bookmark, BriefcaseBusiness, Check, CheckCircle2,
  ChevronDown, CircleHelp, ExternalLink, FileDown, FileUp, Filter, Globe2,
  RefreshCw, Search, ShieldCheck,
  SlidersHorizontal, Sparkles, Target, Trash2, TrendingUp, X, Zap,
} from 'lucide-react';
import { buildSearchFallbackLinks, canonicalizeUrl, domainOf, makeJobId, rankJobs, suggestProfileFromResume } from './lib/matcher';
import { DEFAULT_PROFILE, STATUS_OPTIONS } from './lib/types';
import type { AiAnalysis, ApplicationStatus, CareerProfile, JobResult, JobSearchResponse, RawJobResult, WorkMode } from './lib/types';
import { CvError, extractCvText } from './lib/cv';
import { DEFAULT_SOURCES, DEFAULT_TIME_WINDOW, isPostedWithin, isSourceId, isTimeWindowId, TIME_WINDOWS, windowLabel } from './lib/window';
import type { TimeWindowId } from './lib/window';
import { cleanCustomLocation, MAX_LOCATIONS, splitLegacyLocation } from './lib/locations';
import { LocationPicker } from './components/LocationPicker';
import { SourcePicker } from './components/SourcePicker';
import './styles.css';

const PROFILE_KEY = 'careerpilot.job-radar.profile.v1';
const JOBS_KEY = 'careerpilot.job-radar.saved-jobs.v1';

type Tab = 'radar' | 'saved';
type FilterKey = 'all' | 'strong' | 'medium';

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
  return {
    ...job,
    title: job.title,
    url,
    content: typeof job.content === 'string' ? job.content : '',
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
  const [tab, setTab] = useState<Tab>('radar');
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
  const [lastQueries, setLastQueries] = useState<{ queries: string[]; planner: 'nemotron' | 'rules' } | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const cvInput = useRef<HTMLInputElement>(null);
  const [cvName, setCvName] = useState('');
  const [cvLoading, setCvLoading] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch { /* storage can be disabled */ }
  }, [profile]);

  useEffect(() => {
    try { localStorage.setItem(JOBS_KEY, JSON.stringify(savedJobs)); } catch { /* storage can be disabled */ }
  }, [savedJobs]);

  const fallbackLinks = useMemo(() => buildSearchFallbackLinks({ ...profile, location: profile.locations[0] ?? '' }), [profile]);
  const visibleResults = useMemo(() => {
    if (filter === 'strong') return results.filter((job) => job.matchScore >= 70);
    if (filter === 'medium') return results.filter((job) => job.matchScore >= 40 && job.matchScore < 70);
    return results;
  }, [filter, results]);
  const savedUrlSet = useMemo(() => new Set(savedJobs.map((job) => job.url)), [savedJobs]);
  const strongCount = results.filter((job) => job.matchScore >= 70).length;

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

  async function runSearch() {
    if (!profile.targetRoles.trim()) {
      setSearchError('Add at least one target role to start searching.');
      setShowProfileForm(true);
      return;
    }
    if (profile.sources.length === 0) {
      setSearchError('Select at least one job source to search.');
      setShowProfileForm(true);
      return;
    }
    const windowId: TimeWindowId = profile.timeWindow;
    setLoading(true);
    setSearchError('');
    setSearchNote('Searching public web results and ranking the available snippets…');
    setQueryLabel([profile.targetRoles.split(/[\n,;|]/)[0], profile.locations.join(', ')].filter(Boolean).join(' · '));
    setFilter('all');
    try {
      const response = await fetch('/api/search-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetRoles: profile.targetRoles,
          skills: profile.skills,
          location: profile.locations.join('; '),
          locations: profile.locations,
          workMode: profile.workMode,
          timeWindow: windowId,
          sources: profile.sources,
          // Deliberately omit experienceSummary and the full resume from the request.
        }),
      });
      const payload = await response.json().catch(() => null) as (JobSearchResponse & { error?: string }) | null;
      if (!response.ok || !payload) throw new Error(payload?.error || 'Search service is not available. Use the direct-search links or add a job URL manually.');
      // Defence in depth: the server already filters, but nothing outside the window is ever displayed.
      const inWindow = (Array.isArray(payload.results) ? payload.results : []).filter((job) => isPostedWithin(job.publishedDate, windowId));
      const ranked = rankJobs(inWindow, profile);
      setResults(ranked);
      setLastQueries(Array.isArray(payload.queries) && payload.queries.length ? { queries: payload.queries, planner: payload.planner === 'nemotron' ? 'nemotron' : 'rules' } : null);
      const hidden = payload.excluded;
      const hiddenNote = hidden && (hidden.undated || hidden.tooOld)
        ? ` Hidden: ${hidden.undated} without a verifiable posting date, ${hidden.tooOld} older than ${windowLabel(windowId).replace('last ', '')}.`
        : '';
      setSearchNote(ranked.length
        ? `Showing listings posted within the ${windowLabel(windowId).replace('last ', 'last ')}. Searched ${payload.queriesRun ?? 1} targeted ${(payload.queriesRun ?? 1) === 1 ? 'query' : 'queries'}${payload.planner === 'nemotron' ? ' planned by NVIDIA Nemotron' : ''}. Results are ranked using visible listing text and your selected skills.${hiddenNote}`
        : `No listings with a verifiable posting date in the ${windowLabel(windowId)} were found on the selected sources.${hiddenNote} Try a longer window, more sources or broader titles.`);
      setTab('radar');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to search right now.';
      setSearchError(message);
      setResults([]);
      setLastQueries(null);
      setSearchNote('You can still search directly on public job-search pages or add a posting URL manually.');
    } finally {
      setLoading(false);
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
        job: { title: job.title, domain: job.domain, content: job.content },
      }),
    });
    const payload = await response.json().catch(() => null) as { analysis?: AiAnalysis; error?: string } | null;
    if (!response.ok || !payload?.analysis) throw new Error(payload?.error || 'AI analysis is not available right now.');
    return payload.analysis;
  }

  function saveJob(job: JobResult) {
    if (savedUrlSet.has(job.url)) return;
    setSavedJobs((current) => [{ ...job, status: 'Saved', savedAt: new Date().toISOString() }, ...current]);
  }

  function updateStatus(id: string, status: ApplicationStatus) {
    setSavedJobs((current) => current.map((job) => job.id === id ? { ...job, status } : job));
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
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `careerpilot-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
          <button className={tab === 'saved' ? 'nav-item active' : 'nav-item'} onClick={() => setTab('saved')}><Bookmark size={16} /> Saved jobs <span className="nav-count">{savedJobs.length}</span></button>
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
          <div className="metric-card"><div className="metric-icon blue"><Search size={18} /></div><div><span>Results found</span><strong>{results.length}</strong><small>Latest search</small></div></div>
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
                </div>
                <div className="local-note"><ShieldCheck size={16} /><span><strong>Private by default</strong>Your pasted resume and education stay in this browser. Search sends only target roles, skills, location and work preference. The optional Nemotron features send more: query planning uses the same roles, skills and location; “Extract profile with Nemotron AI” sends the resume text when you click it; job explanations send your education and the snippet — plus resume text only if you tick the box above.</span></div>
                <button className="primary-button full-width" onClick={runSearch} disabled={loading}><Search size={17} /> {loading ? 'Searching the web…' : 'Find matching jobs'} <ArrowRight size={17} /></button>
                <button className="text-button full-width" onClick={() => { setProfile(sanitizeProfile(DEFAULT_PROFILE)); setCvName(''); setSearchError(''); setSearchNote('Profile cleared on this device.'); }}>Clear profile</button>
              </div>}
            </section>

            <section className="panel quick-panel">
              <div className="quick-title"><span className="heading-icon"><Zap size={17} /></span><strong>Quick actions</strong></div>
              <button className="quick-action" onClick={() => setShowManualForm(true)}><span className="quick-action-icon"><ExternalLink size={16} /></span><span><strong>Add a job URL</strong><small>Save a listing you found elsewhere</small></span><ArrowDownRight size={16} /></button>
              <button className="quick-action" onClick={exportBackup}><span className="quick-action-icon"><FileDown size={16} /></span><span><strong>Export backup</strong><small>Download profile and saved jobs</small></span><ArrowDownRight size={16} /></button>
              <button className="quick-action" onClick={() => importInput.current?.click()}><span className="quick-action-icon"><RefreshCw size={16} /></span><span><strong>Restore backup</strong><small>Import a CareerPilot JSON backup</small></span><ArrowDownRight size={16} /></button>
              <input ref={importInput} type="file" accept="application/json,.json" className="hidden-input" onChange={(event) => void importBackup(event.target.files?.[0])} />
            </section>

            <section className="tips-card"><div className="tips-icon"><CircleHelp size={18} /></div><div><strong>Get better matches</strong><p>Use 3–8 specific skills and more than one realistic target title. Broad profiles usually return noisier results.</p></div></section>
          </aside>

          <section className="results-column">
            <div className="results-header">
              <div className="results-tabs"><button className={tab === 'radar' ? 'results-tab active' : 'results-tab'} onClick={() => setTab('radar')}>Job radar <span>{results.length}</span></button><button className={tab === 'saved' ? 'results-tab active' : 'results-tab'} onClick={() => setTab('saved')}>Saved jobs <span>{savedJobs.length}</span></button></div>
              <button className="secondary-button" onClick={() => setShowManualForm(true)}><ExternalLink size={15} /> Add URL</button>
            </div>

            {searchError && <div className="alert error-alert"><X size={17} /><span>{searchError}</span><button aria-label="Dismiss message" onClick={() => setSearchError('')}><X size={15} /></button></div>}
            {searchNote && !searchError && <div className="alert info-alert"><CheckCircle2 size={17} /><span>{searchNote}</span></div>}

            {tab === 'radar' ? <>
              <div className="list-intro"><div><h2>{results.length ? 'Recommended for you' : 'Ready when you are'}</h2><p>{results.length ? (queryLabel ? `Search · ${queryLabel}` : 'Ranked by visible job details and your skills') : 'Run a job search to discover roles from across the public web.'}</p></div>{results.length > 0 && <button className="refresh-button" onClick={runSearch} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh</button>}</div>

              {lastQueries && results.length > 0 && <details className="query-list"><summary>{lastQueries.planner === 'nemotron' ? 'Searches planned by NVIDIA Nemotron' : 'Searches used (rule-based)'}</summary><ul>{lastQueries.queries.map((query) => <li key={query}>{query}</li>)}</ul></details>}

              {results.length > 0 && <div className="filter-row"><div className="filter-label"><Filter size={15} /> Match filter</div><div className="filter-pills"><button className={filter === 'all' ? 'filter-pill selected' : 'filter-pill'} onClick={() => setFilter('all')}>All <span>{results.length}</span></button><button className={filter === 'strong' ? 'filter-pill selected' : 'filter-pill'} onClick={() => setFilter('strong')}>Strong <span>{results.filter((job) => job.matchScore >= 70).length}</span></button><button className={filter === 'medium' ? 'filter-pill selected' : 'filter-pill'} onClick={() => setFilter('medium')}>Possible <span>{results.filter((job) => job.matchScore >= 40 && job.matchScore < 70).length}</span></button></div></div>}

              {loading && <div className="loading-state"><span className="loader" /><strong>Searching public job listings</strong><p>Checking several targeted searches and comparing the results.</p></div>}

              {!loading && results.length === 0 && <div className="empty-state"><div className="empty-art"><div className="empty-orbit orbit-one" /><div className="empty-orbit orbit-two" /><div className="empty-icon"><Search size={29} /></div><span className="sparkle sparkle-one">✦</span><span className="sparkle sparkle-two">✧</span></div><h3>Make your next move</h3><p>Add a target role and preferred location, then search. CareerPilot will gather public results, rank them, and show the original URLs where available.</p><button className="primary-button" onClick={() => { setShowProfileForm(true); void runSearch(); }} disabled={!profile.targetRoles.trim()}><Search size={17} /> Search for jobs</button>
                  <div className="divider-or"><span>or search directly</span></div><div className="fallback-links">{fallbackLinks.map((link) => <a key={link.label} href={link.url} target="_blank" rel="noreferrer"><Globe2 size={15} /> {link.label} <ExternalLink size={13} /></a>)}</div>
                </div>}

              {!loading && results.length > 0 && visibleResults.length === 0 && <div className="small-empty"><Filter size={20} /><strong>No results in this range</strong><span>Choose another filter to see more listings.</span></div>}
              {!loading && visibleResults.map((job) => <JobCard key={job.id} job={job} saved={savedUrlSet.has(job.url)} onSave={() => saveJob(job)} onAnalyze={analyzeJob} canAnalyze={Boolean(profile.targetRoles.trim())} />)}

              {!loading && results.length > 0 && <div className="results-footnote"><ShieldCheck size={16} /><span>Preliminary matches are based on available search-result text, not a complete evaluation of every job description. Open the original listing to verify requirements, posting status and application details.</span></div>}
              {!loading && results.length === 0 && <div className="direct-search-note"><span className="direct-search-dot" /><span>If web search is unavailable or finds too few results, use a direct search link or broaden your query.</span></div>}
            </> : <>
              <div className="list-intro"><div><h2>Your saved opportunities</h2><p>Keep track of listings and update each application stage.</p></div><span className="saved-total"><Bookmark size={15} /> {savedJobs.length} saved</span></div>
              {savedJobs.length === 0 ? <div className="small-empty saved-empty"><Bookmark size={23} /><strong>No saved jobs yet</strong><span>Search for openings and save the ones worth pursuing, or add a URL manually.</span><button className="secondary-button" onClick={() => setTab('radar')}>Go to Job Radar <ArrowRight size={15} /></button></div> : savedJobs.map((job) => <JobCard key={job.id} job={job} saved onSave={() => undefined} statusControl onStatusChange={(status) => updateStatus(job.id, status)} onRemove={() => removeSavedJob(job.id)} onAnalyze={analyzeJob} canAnalyze={Boolean(profile.targetRoles.trim())} />)}
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
    </div>
  );
}

interface JobCardProps {
  job: JobResult;
  saved: boolean;
  onSave: () => void;
  statusControl?: boolean;
  onStatusChange?: (status: ApplicationStatus) => void;
  onRemove?: () => void;
  onAnalyze?: (job: JobResult) => Promise<AiAnalysis>;
  canAnalyze?: boolean;
}

function JobCard({ job, saved, onSave, statusControl = false, onStatusChange, onRemove, onAnalyze, canAnalyze = false }: JobCardProps) {
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
    <div className="job-card-top"><div className="company-symbol">{job.domain.slice(0, 1).toUpperCase()}</div><div className="job-main"><div className="job-kicker"><span>{job.domain}</span>{niceDate(job.publishedDate) && <><span className="dot-sep">·</span><span>{niceDate(job.publishedDate)}</span></>}</div><h3>{job.title}</h3><div className="job-meta"><span><Globe2 size={13} /> Public web result</span><span className="job-type"><BriefcaseBusiness size={13} /> {resultHint ? 'Potential listing' : 'Related result'}</span></div></div><div className={`match-badge ${scoreTone}`}><strong>{job.matchScore}%</strong><span>match</span></div></div>
    <p className="job-snippet">{job.content || 'The search result did not provide a detailed snippet. Open the original page to verify the role.'}</p>
    <div className="evidence-line">{job.matchedTerms.length ? <><CheckCircle2 size={14} /><span>Found: {job.matchedTerms.slice(0, 5).join(', ')}</span></> : <><CircleHelp size={14} /><span>Limited matching evidence in the visible result</span></>}</div>
    {job.missingTerms.length > 0 && <div className="gap-line"><span>Not visible in snippet:</span> {job.missingTerms.slice(0, 4).join(', ')}{job.missingTerms.length > 4 ? '…' : ''}</div>}
    {(analysis || analysisError) && <div className="ai-panel">{analysisError ? <div className="ai-error"><X size={14} /><span>{analysisError}</span></div> : analysis && <>
      <div className="ai-head"><Sparkles size={14} /><strong>AI explanation</strong><span className={`ai-verdict ${analysis.verdict}`}>{analysis.verdict}</span></div>
      <p>{analysis.summary}</p>
      {analysis.strengths.length > 0 && <div className="ai-list"><b>Matches</b><ul>{analysis.strengths.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      {analysis.gaps.length > 0 && <div className="ai-list"><b>Possible gaps</b><ul>{analysis.gaps.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      {analysis.verify.length > 0 && <div className="ai-list"><b>Verify on the original listing</b><ul>{analysis.verify.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      <small>Generated by NVIDIA Nemotron from the search snippet only. It can be wrong; the percentage above is unchanged.</small></>}</div>}
    {showDetails && <div className="job-details"><div><strong>Original source</strong><a href={job.url} target="_blank" rel="noreferrer">{job.url} <ExternalLink size={12} /></a></div><div><strong>Match interpretation</strong><p>The percentage is a keyword-based preliminary ranking of the available title, URL and snippet. It is not a hiring probability and may change after the full job description is reviewed.</p></div></div>}
    <div className="job-card-footer"><button className="details-button" onClick={() => setShowDetails((current) => !current)}>{showDetails ? 'Hide details' : 'Why this match?'} <ChevronDown className={showDetails ? 'chevron open' : 'chevron'} size={14} /></button><div className="job-actions">{statusControl && <select className={`status-select status-${job.status.toLowerCase()}`} value={job.status} onChange={(event) => onStatusChange?.(event.target.value as ApplicationStatus)} aria-label={`Application status for ${job.title}`}>{STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select>}{statusControl && <button className="icon-button danger" title="Remove saved job" aria-label="Remove saved job" onClick={onRemove}><Trash2 size={16} /></button>}{!statusControl && <button className={saved ? 'save-button saved' : 'save-button'} onClick={onSave} disabled={saved}>{saved ? <><Check size={15} /> Saved</> : <><Bookmark size={15} /> Save job</>}</button>}{onAnalyze && <button className="secondary-button ai-button" onClick={() => void runAnalysis()} disabled={!canAnalyze || analysisLoading} title={canAnalyze ? 'Explain this match with an AI model' : 'Add a target job title first'}><Sparkles size={14} /> {analysisLoading ? 'Analyzing…' : analysis ? 'Re-run AI' : 'Explain with Nemotron'}</button>}<a className="apply-button" href={job.url} target="_blank" rel="noreferrer">Open listing <ExternalLink size={14} /></a></div></div>
  </article>;
}

export default App;
