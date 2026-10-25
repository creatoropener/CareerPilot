import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, MapPin, X } from 'lucide-react';
import { cleanCustomLocation, loadPlaces, MAX_LOCATIONS, searchPlaces } from '../lib/locations';
import type { PlaceIndex, PlaceSuggestion } from '../lib/locations';
import { useOutsideClick } from './useOutsideClick';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
}

/** Searchable multi-select for cities and countries worldwide. Press Enter to add any text as a custom place. */
export function LocationPicker({ value, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState<PlaceIndex | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  useOutsideClick(root, () => setOpen(false), open);

  useEffect(() => {
    if (!open || index || loadError) return;
    let cancelled = false;
    loadPlaces().then((loaded) => { if (!cancelled) setIndex(loaded); }).catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [open, index, loadError]);

  const custom = cleanCustomLocation(query);
  const suggestions = useMemo<PlaceSuggestion[]>(() => {
    if (!index) return [];
    const found = searchPlaces(index, query);
    const hasExact = found.some((item) => item.label.toLowerCase() === custom.toLowerCase());
    if (custom.length >= 2 && !hasExact) found.push({ label: custom, kind: 'custom', hint: 'Add exactly as typed' });
    return found;
  }, [index, query, custom]);

  const selected = new Set(value.map((item) => item.toLowerCase()));
  const full = value.length >= MAX_LOCATIONS;

  function toggle(label: string) {
    const key = label.toLowerCase();
    if (selected.has(key)) {
      onChange(value.filter((item) => item.toLowerCase() !== key));
    } else if (!full) {
      onChange([...value, label]);
      setQuery('');
      setActive(0);
    }
    input.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((current) => Math.min(current + 1, Math.max(suggestions.length - 1, 0))); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((current) => Math.max(current - 1, 0)); }
    else if (event.key === 'Enter') {
      event.preventDefault();
      const choice = suggestions[active] ?? (custom.length >= 2 ? { label: custom } : null);
      if (choice) toggle(choice.label);
    } else if (event.key === 'Escape') setOpen(false);
    else if (event.key === 'Backspace' && !query && value.length) onChange(value.slice(0, -1));
  }

  return (
    <div className="field picker" ref={root}>
      <span className="field-label" id={`${listId}-label`}>Preferred locations</span>
      <div className="picker-box" onClick={() => { setOpen(true); input.current?.focus(); }}>
        {value.map((label) => (
          <span className="chip" key={label}>
            <MapPin size={11} /> {label}
            <button type="button" aria-label={`Remove ${label}`} onClick={(event) => { event.stopPropagation(); toggle(label); }}><X size={12} /></button>
          </span>
        ))}
        <input
          ref={input}
          value={query}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-labelledby={`${listId}-label`}
          aria-autocomplete="list"
          placeholder={value.length ? (full ? `Limit of ${MAX_LOCATIONS} reached` : 'Add another…') : 'Search any city or country…'}
          disabled={full && !query}
          onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </div>
      {open && (
        <ul className="picker-list" id={listId} role="listbox" aria-multiselectable="true" aria-labelledby={`${listId}-label`}>
          {loadError && <li className="picker-note">Could not load the place list. You can still type a place and press Enter.</li>}
          {!loadError && !index && <li className="picker-note">Loading places…</li>}
          {index && query.trim().length < 2 && <li className="picker-note">Type at least 2 letters. Cities, countries and “City, Country” all work.</li>}
          {index && query.trim().length >= 2 && suggestions.length === 0 && <li className="picker-note">No match. Press Enter to add “{custom}”.</li>}
          {suggestions.map((item, position) => {
            const isSelected = selected.has(item.label.toLowerCase());
            return (
              <li
                key={`${item.kind}-${item.label}`}
                role="option"
                aria-selected={isSelected}
                className={`picker-option${position === active ? ' active' : ''}${isSelected ? ' selected' : ''}`}
                onMouseEnter={() => setActive(position)}
                onMouseDown={(event) => { event.preventDefault(); toggle(item.label); }}
              >
                <span>{item.label}</span>
                <small>{isSelected ? <Check size={13} /> : item.hint}</small>
              </li>
            );
          })}
          {full && <li className="picker-note">You can pick up to {MAX_LOCATIONS} places. Remove one to add another.</li>}
        </ul>
      )}
      <span className="field-hint">Pick up to {MAX_LOCATIONS} cities or countries from anywhere in the world. Each is searched separately. Place data © GeoNames (CC BY 4.0).</span>
    </div>
  );
}
