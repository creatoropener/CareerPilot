import { useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { SOURCE_GROUPS, SOURCES, getSource } from '../../lib/sources';
import { useOutsideClick } from './useOutsideClick';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
}

/** Grouped, searchable multi-select of job sites. Only ticked sites are searched. */
export function SourcePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useOutsideClick(root, () => setOpen(false), open);

  const selected = useMemo(() => new Set(value), [value]);
  const needle = filter.trim().toLowerCase();
  const groups = useMemo(() => SOURCE_GROUPS
    .map((group) => ({
      group,
      items: SOURCES.filter((source) => source.group === group && (!needle || group.toLowerCase().includes(needle) || source.label.toLowerCase().includes(needle) || source.domains.some((domain) => domain.split('.').includes(needle) || domain.startsWith(needle)))),
    }))
    .filter((entry) => entry.items.length > 0), [needle]);

  const toggle = (id: string) => onChange(selected.has(id) ? value.filter((item) => item !== id) : [...value, id]);
  const setMany = (ids: string[], on: boolean) => {
    const next = new Set(value);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    onChange(SOURCES.map((source) => source.id).filter((id) => next.has(id)));
  };
  const visibleIds = groups.flatMap((entry) => entry.items.map((item) => item.id));

  return (
    <div className="field picker" ref={root}>
      <span className="field-label">Search these sources only *</span>
      <button type="button" className="picker-trigger" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((current) => !current)}>
        <span>{value.length ? `${value.length} site${value.length === 1 ? '' : 's'} selected` : 'Choose job sites…'}</span>
        <ChevronDown size={15} className={open ? 'chevron open' : 'chevron'} />
      </button>
      {value.length > 0 && (
        <div className="chip-row" aria-label="Selected sites">
          {value.map((id) => (
            <span className="chip" key={id}>
              {getSource(id)?.label.replace(/\s*\(.*$/, '') ?? id}
              <button type="button" aria-label={`Remove ${getSource(id)?.label ?? id}`} onClick={() => toggle(id)}><X size={12} /></button>
            </span>
          ))}
        </div>
      )}
      {open && (
        <div className="picker-panel" id={panelId}>
          <div className="picker-search"><Search size={14} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter sites, e.g. remote, UK, naukri…" aria-label="Filter job sites" /></div>
          <div className="picker-actions">
            <button type="button" onClick={() => setMany(visibleIds, true)}>Select all{needle ? ' shown' : ''}</button>
            <button type="button" onClick={() => setMany(visibleIds, false)}>Clear{needle ? ' shown' : ''}</button>
            <span>{value.length} of {SOURCES.length}</span>
          </div>
          <div className="picker-groups">
            {groups.length === 0 && <p className="picker-note">No sites match “{filter}”.</p>}
            {groups.map(({ group, items }) => {
              const ids = items.map((item) => item.id);
              const all = ids.every((id) => selected.has(id));
              return (
                <fieldset key={group} className="picker-group">
                  <legend>
                    {group}
                    <button type="button" onClick={() => setMany(ids, !all)}>{all ? 'none' : 'all'}</button>
                  </legend>
                  {items.map((source) => (
                    <label key={source.id} className="source-option"><input type="checkbox" checked={selected.has(source.id)} onChange={() => toggle(source.id)} /><span>{source.label}</span></label>
                  ))}
                </fieldset>
              );
            })}
          </div>
        </div>
      )}
      <span className="field-hint">Only ticked sites are searched and only their results are shown. Many sites are searched together, within a fixed number of searches per click. Results come from public search results; open each link on the original site.</span>
    </div>
  );
}
