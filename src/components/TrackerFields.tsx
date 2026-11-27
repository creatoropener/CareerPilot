import { useState } from 'react';
import { CalendarClock, ChevronDown, NotebookPen } from 'lucide-react';
import type { JobResult } from '../lib/types';
import { followUpState, isFollowUpDue, MAX_NOTES } from '../lib/tracker';

const longDate = (value?: string): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

/** "Follow up today", "Follow-up overdue by 3 days"... or nothing when there is no reminder to show. */
export function FollowUpChip({ job, today }: { job: JobResult; today: string }) {
  const state = followUpState(job, today);
  if (state.kind === 'none') return null;
  return <span className={`follow-chip follow-${state.kind}`}><CalendarClock size={12} aria-hidden="true" /> {state.label}</span>;
}

interface TrackerFieldsProps {
  job: JobResult;
  today: string;
  onChange: (patch: Pick<JobResult, 'notes' | 'followUpAt'>) => void;
}

/** The follow-up date and notes of a saved job. Open by default when there are notes or a reminder is due. */
export function TrackerFields({ job, today, onChange }: TrackerFieldsProps) {
  const [open, setOpen] = useState(() => Boolean(job.notes) || isFollowUpDue(job, today));
  const bodyId = `tracker-${job.id}`;
  const applied = longDate(job.appliedAt);
  return <div className="tracker">
    <button type="button" className="details-button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((current) => !current)}>
      <NotebookPen size={14} aria-hidden="true" /> Notes &amp; follow-up <ChevronDown className={open ? 'chevron open' : 'chevron'} size={14} aria-hidden="true" />
    </button>
    {open && <div className="tracker-body" id={bodyId}>
      {applied && <p className="tracker-applied">Applied on {applied}</p>}
      <label className="field">
        <span className="field-label">Follow-up date</span>
        <input type="date" value={job.followUpAt ?? ''} onChange={(event) => onChange({ followUpAt: event.target.value || undefined, notes: job.notes })} />
      </label>
      <label className="field">
        <span className="field-label">Notes</span>
        <textarea rows={3} maxLength={MAX_NOTES} value={job.notes ?? ''} placeholder="Contact name, what was said, next step…" onChange={(event) => onChange({ notes: event.target.value || undefined, followUpAt: job.followUpAt })} />
        <span className="field-hint">Kept on this device only. Included in your backup and CSV export.</span>
      </label>
    </div>}
  </div>;
}
