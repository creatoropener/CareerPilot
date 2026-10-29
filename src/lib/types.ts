import type { SourceId, TimeWindowId } from './window';
import { DEFAULT_SOURCES, DEFAULT_TIME_WINDOW } from './window';

export type WorkMode = 'Any' | 'Remote' | 'Hybrid' | 'On-site';
export type ApplicationStatus = 'Saved' | 'Applied' | 'Interview' | 'Offer' | 'Rejected';

export interface CareerProfile {
  targetRoles: string;
  skills: string;
  /** Selected places, e.g. "Mumbai, India" or "Germany". The source of truth. */
  locations: string[];
  /** The same places joined with "; ", kept for older backups and the scoring fallback. */
  location: string;
  workMode: WorkMode;
  experienceSummary: string;
  education: string;
  timeWindow: TimeWindowId;
  sources: SourceId[];
}

export interface RawJobResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  publishedDate?: string | null;
  /** Stable identity of the posting (from the search function), used to avoid showing it twice. */
  key?: string;
}

export interface JobResult extends RawJobResult {
  id: string;
  domain: string;
  matchScore: number;
  matchedTerms: string[];
  missingTerms: string[];
  status: ApplicationStatus;
  savedAt?: string;
  searchQuery?: string;
}

export interface AiAnalysis {
  verdict: 'strong' | 'possible' | 'weak';
  summary: string;
  strengths: string[];
  gaps: string[];
  verify: string[];
}

export interface JobSearchResponse {
  results: RawJobResult[];
  queriesRun: number;
  queries?: string[];
  planner?: 'nemotron' | 'rules';
  page?: number;
  /** Valid listings beyond the pool the server returns. */
  overflow?: number;
  excluded?: SearchExclusions;
}

/** Why results from the search provider were left out of a search. */
export interface SearchExclusions {
  otherSource: number;
  undated: number;
  tooOld: number;
  invalid: number;
  /** Search pages, category pages and "N vacancies" pages. */
  notVacancy: number;
  /** Listings for a place other than the selected ones. */
  wrongLocation: number;
  alreadyShown: number;
  duplicate: number;
}

export const DEFAULT_PROFILE: CareerProfile = {
  targetRoles: '',
  skills: '',
  locations: [],
  location: '',
  workMode: 'Any',
  experienceSummary: '',
  education: '',
  timeWindow: DEFAULT_TIME_WINDOW,
  sources: [...DEFAULT_SOURCES],
};

export const STATUS_OPTIONS: ApplicationStatus[] = ['Saved', 'Applied', 'Interview', 'Offer', 'Rejected'];
