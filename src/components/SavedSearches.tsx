import { useState } from 'react';
import { BellRing, ChevronDown, Play, RefreshCw, Save, Trash2 } from 'lucide-react';
import { MAX_SAVED_SEARCHES, checkedLabel, totalNew } from '../lib/savedSearches';
import type { SavedSearch } from '../lib/savedSearches';
import { windowLabel } from '../lib/window';

interface Props {
  searches: SavedSearch[];
  /** The saved search whose results are on screen. */
  activeId: string | null;
  canSave: boolean;
  busy: boolean;
  /** The id being checked, "all" while every search is being checked, or null. */
  checking: string | null;
  onSave: (name: string) => void;
  onRun: (search: SavedSearch) => void;
  onCheck: (search: SavedSearch) => void;
  onCheckAll: () => void;
  onRemove: (id: string) => void;
}

function describe(search: SavedSearch): string {
  const { search: s } = search;
  const places = s.locations.length ? s.locations.map((place) => place.split(',')[0]).join(', ') : 'any place';
  const parts = [places, windowLabel(s.timeWindow).replace(/^last /, ''), `${s.sources.length} ${s.sources.length === 1 ? 'site' : 'sites'}`];
  if (s.companies.length) parts.push(s.companies.map((id) => id.split(':')[1] ?? id).join(', '));
  return parts.join(' · ');
}

/** Searches you want to repeat, each with a count of listings found since you last looked. Stored on this device. */
export function SavedSearches({ searches, activeId, canSave, busy, checking, onSave, onRun, onCheck, onCheckAll, onRemove }: Props) {
  const [open, setOpen] = useState(true);
  const [name, setName] = useState('');
  const newTotal = totalNew(searches);

  return (
    <section className="panel saved-searches-panel">
      <button className="panel-heading collapsible-heading" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <span className="heading-icon"><BellRing size={18} /></span>
        <span className="heading-copy"><strong>Saved searches</strong><small>Repeat a search and see what is new</small></span>
        {newTotal > 0 && <span className="new-badge" aria-label={`${newTotal} new listings`}>{newTotal} new</span>}
        <ChevronDown className={open ? 'chevron open' : 'chevron'} size={17} />
      </button>
      {open && <div className="saved-searches-body">
        <div className="save-search-row">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name (optional)" maxLength={60} aria-label="Name for this search" />
          <button type="button" className="secondary-button" disabled={!canSave} onClick={() => { onSave(name); setName(''); }} title={canSave ? 'Save the search in the form' : 'Add a target role and a source first'}><Save size={14} /> Save</button>
        </div>
        {searches.length === 0
          ? <p className="field-hint">Save the search in the form to run it again in one click. CareerPilot remembers which listings you have seen, so the next run can show what is new. This stays on this device.</p>
          : <>
            <ul className="saved-search-list">
              {searches.map((entry) => {
                const isChecking = checking === entry.id || checking === 'all';
                return <li key={entry.id} className={entry.id === activeId ? 'saved-search active' : 'saved-search'}>
                  <div className="saved-search-main">
                    <strong title={entry.name}>{entry.name}</strong>
                    {entry.newCount > 0 && <span className="new-badge" aria-label={`${entry.newCount} new listings`}>{entry.newCount} new</span>}
                  </div>
                  <small>{describe(entry)}</small>
                  <small className="saved-search-time">{checkedLabel(entry.lastCheckedAt)}</small>
                  <div className="saved-search-actions">
                    <button type="button" className="secondary-button" onClick={() => onRun(entry)} disabled={busy} aria-label={`Run ${entry.name}`}><Play size={13} /> Run</button>
                    <button type="button" className="secondary-button" onClick={() => onCheck(entry)} disabled={busy} aria-label={`Check ${entry.name} for new listings`} title="Look for new listings without changing the list on screen"><RefreshCw size={13} className={isChecking ? 'spin' : ''} /> Check</button>
                    <button type="button" className="icon-button danger" onClick={() => onRemove(entry.id)} aria-label={`Delete saved search ${entry.name}`} title="Delete"><Trash2 size={15} /></button>
                  </div>
                </li>;
              })}
            </ul>
            {searches.length > 1 && <button type="button" className="text-button full-width" onClick={onCheckAll} disabled={busy}>{checking === 'all' ? 'Checking…' : 'Check all for new listings'}</button>}
            <p className="field-hint">“Check” runs the search in the background and counts listings you have not been shown. Each check is a normal search; repeats within 10 minutes are answered from a short cache. You can keep up to {MAX_SAVED_SEARCHES}.</p>
          </>}
      </div>}
    </section>
  );
}
