import type { CareerProfile, JobResult, RawJobResult } from './types';

const splitList = (value: string): string[] => value
  .split(/[\n,;|]/)
  .map((part) => part.trim())
  .filter((part) => part.length > 1)
  .filter((part, index, all) => all.findIndex((x) => x.toLowerCase() === part.toLowerCase()) === index);

const SUMMARY_STOP_WORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'also', 'among', 'and', 'any', 'are', 'because',
  'been', 'before', 'being', 'below', 'between', 'both', 'could', 'during', 'each', 'experience',
  'from', 'have', 'having', 'into', 'more', 'most', 'other', 'over', 'same', 'should', 'some',
  'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those',
  'through', 'under', 'very', 'was', 'were', 'what', 'when', 'where', 'which', 'while', 'with',
  'within', 'would', 'your', 'years', 'worked', 'work', 'responsible', 'including', 'using', 'role',
  'team', 'teams', 'support', 'supported', 'helped', 'managed', 'management', 'results',
]);

function extractSummaryTerms(value: string): string[] {
  const tokens = value.match(/[\p{L}\p{N}][\p{L}\p{N}+#./-]{2,}/gu) ?? [];
  return tokens
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !SUMMARY_STOP_WORDS.has(token.toLowerCase()))
    .filter((token, index, all) => all.findIndex((part) => part.toLowerCase() === token.toLowerCase()) === index)
    .slice(0, 30);
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function includesTerm(haystack: string, term: string): boolean {
  const normalizedText = haystack.toLocaleLowerCase();
  const normalizedTerm = term.toLocaleLowerCase().trim();
  if (!normalizedTerm) return false;
  if (normalizedTerm.includes(' ') || /[+.#/-]/.test(normalizedTerm)) {
    return normalizedText.includes(normalizedTerm);
  }
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(normalizedTerm)}([^a-z0-9]|$)`, 'i').test(normalizedText);
}


const RESUME_SKILL_CATALOG = [
  'SAP S/4HANA', 'SAP MM', 'SAP SD', 'SAP FI', 'SAP TM', 'SAP', 'Excel', 'Advanced Excel',
  'Power BI', 'Tableau', 'SQL', 'Python', 'JavaScript', 'TypeScript', 'React', 'Node.js',
  'PostgreSQL', 'HTML', 'CSS', 'Git', 'Docker', 'REST API', 'AWS', 'Azure', 'Salesforce',
  'Supply Chain', 'Logistics', 'Import/Export', 'Customs Clearance', 'Freight Auditing',
  'Order Management', 'Customer Service', 'Procurement', 'Inventory Management',
  'Warehouse Management', 'Transport Management', 'Demand Planning', 'Production Planning',
  'Team Leadership', 'Vendor Management', 'Data Analysis', 'Business Analysis',
  'Project Management', 'Stakeholder Management', 'Contract Management', 'Financial Analysis',
  'Accounting', 'Compliance', 'Risk Management', 'Marketing', 'Sales', 'Human Resources',
  'Machine Learning', 'Artificial Intelligence', 'Agile', 'Scrum', 'Jira', 'PowerPoint',
  'Negotiation', 'Lean Six Sigma', 'Process Improvement', 'ERP', 'Budgeting', 'Forecasting',
];

const ROLE_WORDS = /\b(manager|analyst|engineer|specialist|coordinator|team lead|lead|executive|director|consultant|developer|administrator|officer|supervisor|technician|architect|accountant|scientist|designer|planner|buyer|merchandiser|auditor|controller|associate|representative)\b/i;
const EDUCATION_WORDS = /\b(bachelor|master|mba|bba|b\.com|b\.sc|bsc|b\.tech|m\.tech|ph\.?d|diploma|degree|certification|certified|university|college|graduate|postgraduate|pmp|cpa|acca)\b/i;

export interface ResumeSuggestions {
  skills: string[];
  roles: string[];
  education: string[];
}

export function suggestProfileFromResume(resumeText: string): ResumeSuggestions {
  const text = resumeText.trim();
  const lines = text.split(/\r?\n/).map((line) => line.replace(/^[-•*\s]+/, '').trim()).filter(Boolean);
  const skills = RESUME_SKILL_CATALOG.filter((skill) => includesTerm(text, skill));
  const roles = lines
    .filter((line) => line.length >= 4 && line.length <= 90 && ROLE_WORDS.test(line))
    .filter((line) => !/^(skills|responsibilities|qualifications|summary|profile|experience|education|certifications?)\b/i.test(line))
    .filter((line, index, all) => all.findIndex((entry) => entry.toLowerCase() === line.toLowerCase()) === index)
    .slice(0, 3);
  const education = lines
    .filter((line) => line.length <= 140 && EDUCATION_WORDS.test(line))
    .filter((line, index, all) => all.findIndex((entry) => entry.toLowerCase() === line.toLowerCase()) === index)
    .slice(0, 4);
  return { skills, roles, education };
}

export function canonicalizeUrl(input: string): string {
  try {
    const url = new URL(input);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|ref|refid|source|trk|trackingid|gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    return url.toString().replace(/\/$/, '');
  } catch {
    return input.trim();
  }
}

export function domainOf(input: string): string {
  try {
    return new URL(input).hostname.replace(/^www\./, '');
  } catch {
    return 'Unknown source';
  }
}

export function scoreJob(raw: RawJobResult, profile: CareerProfile): JobResult {
  const roles = splitList(profile.targetRoles);
  const skills = splitList(profile.skills);
  const location = profile.location.trim();
  const allText = `${raw.title} ${raw.content} ${raw.url}`.toLocaleLowerCase();
  const matchedRoles = roles.filter((term) => includesTerm(allText, term));
  const matchedSkills = skills.filter((term) => includesTerm(allText, term));
  const matchedEducation = splitList(profile.education).filter((term) => includesTerm(allText, term));
  const summaryTerms = extractSummaryTerms(profile.experienceSummary);
  const matchedSummary = summaryTerms.filter((term) => includesTerm(allText, term));
  const matchedTerms = [...matchedRoles, ...matchedSkills, ...matchedEducation, ...matchedSummary]
    .filter((term, index, array) => array.findIndex((entry) => entry.toLowerCase() === term.toLowerCase()) === index);

  let score = 0;
  if (roles.length > 0) score += matchedRoles.length > 0 ? 30 : 0;
  else score += 12;
  if (skills.length > 0) score += Math.round((matchedSkills.length / skills.length) * 40);
  else score += 15;
  if (location) {
    const locationPart = location.split(',')[0].trim();
    score += includesTerm(allText, locationPart) ? 15 : 0;
  } else score += 8;
  if (/\b(job|jobs|career|careers|apply|application|vacancy|vacancies|hiring|position|opening|recruitment)\b/i.test(allText)) score += 5;
  if (matchedEducation.length > 0) score += Math.min(5, matchedEducation.length * 2);
  if (summaryTerms.length > 0) score += Math.min(5, Math.round((matchedSummary.length / Math.min(10, summaryTerms.length)) * 5));
  score = Math.min(100, score);

  const missingTerms = skills.filter((term) => !matchedSkills.some((match) => match.toLowerCase() === term.toLowerCase()));
  const url = canonicalizeUrl(raw.url);
  const id = makeJobId(url);
  return {
    ...raw,
    url,
    id,
    domain: domainOf(url),
    matchScore: score,
    matchedTerms,
    missingTerms,
    status: 'Saved',
  };
}

export function makeJobId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `job-${(hash >>> 0).toString(16)}`;
}

export function rankJobs(results: RawJobResult[], profile: CareerProfile): JobResult[] {
  const seen = new Set<string>();
  const ranked: JobResult[] = [];
  for (const raw of results) {
    if (!raw.url || !/^https?:\/\//i.test(raw.url)) continue;
    const canonicalUrl = canonicalizeUrl(raw.url);
    if (seen.has(canonicalUrl)) continue;
    seen.add(canonicalUrl);
    ranked.push(scoreJob({ ...raw, url: canonicalUrl }, profile));
  }
  return ranked.sort((a, b) => b.matchScore - a.matchScore);
}

export function buildSearchFallbackLinks(profile: CareerProfile): { label: string; url: string }[] {
  const roles = splitList(profile.targetRoles).slice(0, 2);
  const skills = splitList(profile.skills).slice(0, 4);
  const keywords = [...roles, ...skills].filter(Boolean).join(' ');
  const location = profile.location.trim();
  const query = [keywords, location, 'jobs apply'].filter(Boolean).join(' ');
  const q = encodeURIComponent(query || 'jobs near me');
  const linkedinQuery = encodeURIComponent([roles[0] || keywords || 'jobs', location].filter(Boolean).join(' '));
  return [
    { label: 'Google Jobs', url: `https://www.google.com/search?q=${q}&ibp=htl;jobs` },
    { label: 'Indeed', url: `https://www.indeed.com/jobs?q=${q}&l=${encodeURIComponent(location)}` },
    { label: 'LinkedIn Jobs', url: `https://www.linkedin.com/jobs/search/?keywords=${linkedinQuery}` },
    { label: 'Company career pages', url: `https://www.google.com/search?q=${encodeURIComponent(`${keywords} ${location} careers apply`)}` },
  ];
}
