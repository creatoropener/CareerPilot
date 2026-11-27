// Cover letters: a template draft that needs no AI, the file name for a download, and the store of letters kept on
// this device. Pure and dependency-free, so it is easy to test. A letter never leaves the device unless the person
// copies or downloads it.

export const MAX_LETTERS = 30;
export const MAX_LETTER_CHARS = 8000;

export interface StoredLetter {
  text: string;
  /** The job title it was written for, so a backup file is readable. */
  title: string;
  updatedAt: string;
}

/** Saved letters by the listing's link. */
export type LetterStore = Record<string, StoredLetter>;

const splitList = (value: string): string[] => value.split(/[\n,;|]/).map((part) => part.trim()).filter((part) => part.length > 1);

/** "Supply Chain Manager — Acme Logistics" -> role and company. The company is empty when the title has none. */
export function splitTitle(title: string): { role: string; company: string } {
  const [role, ...rest] = title.split(/\s+[—–]\s+/);
  return { role: role.trim() || title.trim(), company: rest.join(' — ').trim() };
}

interface TemplateInput {
  name?: string;
  title: string;
  /** Terms the matcher found in the listing. Only those that are also in the person's skills are written about. */
  matchedTerms: string[];
  skills: string;
  education: string;
}

// Placeholders stay short (under 60 characters) so that findPlaceholders in lib/letter.ts always lists them.
/**
 * A short, honest draft from facts the person has already entered: the role, the company if the title names one,
 * the skills the listing really mentions, and their education. Everything else is a [placeholder] to fill in, so
 * nothing is invented. No AI is involved.
 */
export function templateLetter(input: TemplateInput): string {
  const { role, company } = splitTitle(input.title);
  const mine = splitList(input.skills);
  const matched = mine.filter((skill) => input.matchedTerms.some((term) => term.toLowerCase() === skill.toLowerCase())).slice(0, 5);
  const education = input.education.split(/[\n|·]/).map((part) => part.trim()).filter(Boolean).slice(0, 3).join(', ');

  const opening = `I am writing to apply for the ${role} position${company ? ` at ${company}` : ''}.`;
  const skillSentence = matched.length > 0
    ? ` My skills in ${matched.join(', ')} match what your listing asks for.`
    : ' [Why this role interests you]';
  const educationSentence = education ? ` My qualifications include ${education}.` : '';

  return [
    'Dear Hiring Team,',
    `${opening}${skillSentence}${educationSentence}`,
    '[One achievement from your experience, with a number]',
    `I would welcome the opportunity to discuss how I can contribute to ${company || '[Company]'}. Thank you for your time and consideration.`,
    `Sincerely,\n${input.name?.trim() || '[Your name]'}`,
  ].join('\n\n');
}

/** "Supply Chain Manager — Acme" -> "cover-letter-supply-chain-manager-acme.txt" */
export function letterFileName(title: string): string {
  const slug = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `cover-letter${slug ? `-${slug}` : ''}.txt`;
}

// ---- the store ----------------------------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Saves (or, for blank text, removes) the letter for a listing. The oldest letters go first when the store is full. */
export function saveLetter(store: LetterStore, url: string, letter: { text: string; title: string }, now = new Date()): LetterStore {
  const next: LetterStore = { ...store };
  const text = letter.text.replace(CONTROL, ' ').slice(0, MAX_LETTER_CHARS);
  if (!text.trim()) {
    delete next[url];
    return next;
  }
  next[url] = { text, title: letter.title.slice(0, 200), updatedAt: now.toISOString() };
  const keys = Object.keys(next).sort((a, b) => Date.parse(next[b].updatedAt) - Date.parse(next[a].updatedAt));
  for (const key of keys.slice(MAX_LETTERS)) delete next[key];
  return next;
}

/** Keeps only valid letters from stored or imported data. Anything malformed is dropped. */
export function sanitizeLetters(value: unknown): LetterStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries: [string, StoredLetter][] = [];
  for (const [url, raw] of Object.entries(value as Record<string, unknown>)) {
    if (url.length > 500 || !/^https?:\/\//i.test(url) || !raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.text !== 'string') continue;
    const text = item.text.replace(CONTROL, ' ').slice(0, MAX_LETTER_CHARS);
    if (!text.trim()) continue;
    const updatedAt = typeof item.updatedAt === 'string' && !Number.isNaN(Date.parse(item.updatedAt)) ? item.updatedAt : new Date(0).toISOString();
    entries.push([url, { text, title: typeof item.title === 'string' ? item.title.slice(0, 200) : '', updatedAt }]);
  }
  entries.sort((a, b) => Date.parse(b[1].updatedAt) - Date.parse(a[1].updatedAt));
  return Object.fromEntries(entries.slice(0, MAX_LETTERS));
}

// ---- the AI answer ------------------------------------------------------------------------------------------

export type LetterTone = 'professional' | 'warm' | 'concise';

export const LETTER_TONES: { id: LetterTone; label: string }[] = [
  { id: 'professional', label: 'Professional' },
  { id: 'warm', label: 'Warm' },
  { id: 'concise', label: 'Concise (about 175 words)' },
];

export interface LetterRequest {
  tone: LetterTone;
  emphasis: string;
  name: string;
  /** Send the resume text to the AI. Only true when the person ticked the box for this letter. */
  includeResume: boolean;
}

export interface GeneratedLetter {
  letter: string;
  model: string;
  placeholders: string[];
  /** Numbers in the draft that are not in the profile, the resume or the listing. */
  unsupportedNumbers: string[];
}

/** The flagged numbers that are still in the text, so a warning disappears once the person has fixed the letter. */
export function numbersStillPresent(flagged: string[], text: string): string[] {
  return flagged.filter((label) => {
    const number = label.split(' ')[0];
    return text.includes(number);
  });
}
