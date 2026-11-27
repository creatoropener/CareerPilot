import { useId, useState } from 'react';
import { Building2, Plus, X } from 'lucide-react';
import { MAX_BOARDS_PER_SEARCH, MAX_FOLLOWED, companyId, companyLabel, parseCompany } from '../../lib/companies';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
}

/**
 * Companies whose own job boards (Greenhouse or Lever) are read on every new search, with the date each opening
 * was really posted. Accepts the address of a company's job board or of one of its listings.
 */
export function CompanyFollow({ value, onChange }: Props) {
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');
  const inputId = useId();

  function add() {
    if (!text.trim()) return;
    const board = parseCompany(text);
    if (!board) {
      setMessage('That is not a Greenhouse or Lever job board. Try an address like boards.greenhouse.io/stripe or jobs.lever.co/netflix.');
      return;
    }
    const id = companyId(board);
    if (value.includes(id)) {
      setMessage(`${companyLabel(id)} is already followed.`);
      return;
    }
    if (value.length >= MAX_FOLLOWED) {
      setMessage(`You can follow up to ${MAX_FOLLOWED} companies. Remove one first.`);
      return;
    }
    onChange([...value, id]);
    setText('');
    setMessage('');
  }

  return (
    <div className="field company-follow">
      <label className="field-label" htmlFor={inputId}>Follow companies (optional)</label>
      <div className="company-add">
        <input
          id={inputId}
          value={text}
          onChange={(event) => { setText(event.target.value); setMessage(''); }}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}
          placeholder="boards.greenhouse.io/stripe"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="button" className="secondary-button" onClick={add} disabled={!text.trim()}><Plus size={14} /> Follow</button>
      </div>
      {message && <span className="field-error" role="alert">{message}</span>}
      {value.length > 0 && (
        <div className="chip-row" aria-label="Followed companies">
          {value.map((id) => (
            <span className="chip" key={id}>
              <Building2 size={12} aria-hidden="true" />
              {companyLabel(id)}
              <button type="button" aria-label={`Stop following ${companyLabel(id)}`} onClick={() => onChange(value.filter((item) => item !== id))}><X size={12} /></button>
            </span>
          ))}
        </div>
      )}
      <span className="field-hint">
        Paste the address of a company&apos;s job board on Greenhouse or Lever. Each new search also reads its openings straight from the board, with the date they were really posted, for your titles and places. The first {MAX_BOARDS_PER_SEARCH} followed companies are read each time.
      </span>
    </div>
  );
}
