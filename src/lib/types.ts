export type WorkMode = 'Any' | 'Remote' | 'Hybrid' | 'On-site';
export type ApplicationStatus = 'Saved' | 'Applied' | 'Interview' | 'Offer' | 'Rejected';

export interface CareerProfile {
  targetRoles: string;
  skills: string;
  location: string;
  workMode: WorkMode;
  experienceSummary: string;
  education: string;
}

export interface RawJobResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  publishedDate?: string | null;
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
}

export const DEFAULT_PROFILE: CareerProfile = {
  targetRoles: '',
  skills: '',
  location: '',
  workMode: 'Any',
  experienceSummary: '',
  education: '',
};

export const STATUS_OPTIONS: ApplicationStatus[] = ['Saved', 'Applied', 'Interview', 'Offer', 'Rejected'];
