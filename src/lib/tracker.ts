// Application tracking for saved jobs: when you applied, when to follow up, notes, and the views built on them.
// Pure and dependency-free (apart from types) so it is easy to test. Everything stays on the device.
import type { ApplicationStatus, JobResult } from './types';

/** Days after applying that the default follow-up reminder is set. The user can change it. */
export const FOLLOW_UP_DAYS = 7;
export const MAX_NOTES = 2000;

const DAY_MS = 86_400_000;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Today's date on the user's own calendar (not UTC), as YYYY-MM-DD. */
export function localDateString(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY_MS);
}

// ---- follow-up state ----------------------------------------------------------------------------------------

export type FollowUp =
  | { kind: 'none' }
  | { kind: 'upcoming' | 'today' | 'overdue'; days: number; label: string };

/** Jobs that are decided (an offer or a rejection) no longer need a follow-up. */
const CLOSED: ApplicationStatus[] = ['Offer', 'Rejected'];

export function followUpState(job: Pick<JobResult, 'status' | 'followUpAt'>, today: string): FollowUp {
  if (!job.followUpAt || !isDateOnly(job.followUpAt) || CLOSED.includes(job.status)) return { kind: 'none' };
  const days = daysBetween(today, job.followUpAt);
  if (days === 0) return { kind: 'today', days: 0, label: 'Follow up today' };
  if (days < 0) {
    const late = -days;
    return { kind: 'overdue', days: late, label: `Follow-up overdue by ${late} ${late === 1 ? 'day' : 'days'}` };
  }
  return { kind: 'upcoming', days, label: days === 1 ? 'Follow up tomorrow' : `Follow up in ${days} days` };
}

export const isFollowUpDue = (job: Pick<JobResult, 'status' | 'followUpAt'>, today: string): boolean => {
  const state = followUpState(job, today);
  return state.kind === 'today' || state.kind === 'overdue';
};

export const countDue = (jobs: JobResult[], today: string): number => jobs.filter((job) => isFollowUpDue(job, today)).length;

// ---- status changes -----------------------------------------------------------------------------------------

/**
 * Moves a job to a new stage. The first time it reaches Applied (or any later stage) the application date is
 * recorded, and an Applied job without a reminder gets one FOLLOW_UP_DAYS later. Nothing is ever erased: going back
 * to Saved keeps the dates and notes.
 */
export function setStatus(job: JobResult, status: ApplicationStatus, now = new Date()): JobResult {
  const next: JobResult = { ...job, status };
  if (status !== 'Saved' && !next.appliedAt) next.appliedAt = now.toISOString();
  if (status === 'Applied' && !next.followUpAt) next.followUpAt = addDays(localDateString(now), FOLLOW_UP_DAYS);
  return next;
}

export const markApplied = (job: JobResult, now = new Date()): JobResult => setStatus(job, 'Applied', now);

/** True once the job has been applied for (Applied, Interview, Offer or Rejected). */
export const hasApplied = (status: ApplicationStatus | undefined): boolean => status !== undefined && status !== 'Saved';

// ---- stored values ------------------------------------------------------------------------------------------

/** Keeps only valid tracking fields from stored or imported data. */
export function sanitizeTracking(value: unknown): Pick<JobResult, 'appliedAt' | 'followUpAt' | 'notes'> {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const result: Pick<JobResult, 'appliedAt' | 'followUpAt' | 'notes'> = {};
  if (typeof source.appliedAt === 'string' && !Number.isNaN(Date.parse(source.appliedAt))) result.appliedAt = source.appliedAt;
  if (isDateOnly(source.followUpAt)) result.followUpAt = source.followUpAt;
  if (typeof source.notes === 'string') {
    const notes = source.notes.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').slice(0, MAX_NOTES);
    if (notes.trim()) result.notes = notes;
  }
  return result;
}

// ---- lists --------------------------------------------------------------------------------------------------

export type SavedFilter = 'all' | ApplicationStatus;

export const filterSaved = (jobs: JobResult[], filter: SavedFilter): JobResult[] =>
  filter === 'all' ? jobs : jobs.filter((job) => job.status === filter);

export function countByStatus(jobs: JobResult[]): Record<SavedFilter, number> {
  const counts: Record<SavedFilter, number> = { all: jobs.length, Saved: 0, Applied: 0, Interview: 0, Offer: 0, Rejected: 0 };
  for (const job of jobs) counts[job.status] += 1;
  return counts;
}

/** Follow-ups that are due come first (the most overdue at the top); everything else keeps its order. */
export function orderSaved(jobs: JobResult[], today: string): JobResult[] {
  const due = jobs
    .filter((job) => isFollowUpDue(job, today))
    .sort((a, b) => (a.followUpAt ?? '').localeCompare(b.followUpAt ?? ''));
  return [...due, ...jobs.filter((job) => !isFollowUpDue(job, today))];
}

// ---- returning from a listing -------------------------------------------------------------------------------

/** After opening a listing, ask "did you apply?" only when the user was away for a while (not a quick peek). */
export const awayLongEnough = (hiddenAt: number | null, now: number, minAwayMs: number): boolean =>
  hiddenAt !== null && now - hiddenAt >= minAwayMs;

// ---- CSV export ---------------------------------------------------------------------------------------------

// A cell that starts with one of these is read as a formula by spreadsheet programs, so it is shown as text.
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value: string | number | undefined): string {
  const text = value === undefined ? '' : String(value);
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(jobs: JobResult[]): string {
  const header = ['Title', 'Source', 'Link', 'Status', 'Match %', 'Posted', 'Saved', 'Applied', 'Follow-up', 'Notes'];
  const day = (value?: string | null): string => (value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString().slice(0, 10) : '');
  const rows = jobs.map((job) => [
    job.title, job.domain, job.url, job.status, job.matchScore, day(job.publishedDate), day(job.savedAt), day(job.appliedAt), job.followUpAt ?? '', job.notes ?? '',
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
