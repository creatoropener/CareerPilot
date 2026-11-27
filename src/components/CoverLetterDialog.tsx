import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, Download, FileText, Save, Sparkles, X } from 'lucide-react';
import { findPlaceholders } from '../../lib/letter';
import { LETTER_TONES, MAX_LETTER_CHARS, letterFileName, numbersStillPresent, splitTitle, templateLetter } from '../lib/coverLetter';
import type { GeneratedLetter, LetterRequest, LetterTone } from '../lib/coverLetter';
import { downloadText } from '../lib/format';
import type { JobResult } from '../lib/types';

interface Props {
  job: JobResult;
  /** The letter kept on this device for this listing, if any. */
  initialText: string;
  name: string;
  onNameChange: (name: string) => void;
  skills: string;
  education: string;
  /** Whether the profile has resume text that could be shared with the AI. */
  hasResume: boolean;
  /** False when no target role is set: the AI needs one. */
  canGenerate: boolean;
  onGenerate: (request: LetterRequest) => Promise<GeneratedLetter>;
  onSave: (text: string) => void;
  onClose: () => void;
}

/** Draft, edit, copy and keep a cover letter for one listing. Nothing is sent anywhere until "Write with Nemotron". */
export function CoverLetterDialog({ job, initialText, name, onNameChange, skills, education, hasResume, canGenerate, onGenerate, onSave, onClose }: Props) {
  const [text, setText] = useState(initialText);
  const [tone, setTone] = useState<LetterTone>('professional');
  const [emphasis, setEmphasis] = useState('');
  const [includeResume, setIncludeResume] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [origin, setOrigin] = useState<'ai' | 'template' | 'kept' | 'none'>(initialText ? 'kept' : 'none');
  const [flagged, setFlagged] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(Boolean(initialText));
  const firstChange = useRef(true);
  const latest = useRef(text);
  const dirty = useRef(false);
  const onSaveRef = useRef(onSave);
  latest.current = text;
  onSaveRef.current = onSave;
  const { company } = splitTitle(job.title);

  // The letter is kept on this device as you edit it, and once more when the dialog closes.
  useEffect(() => {
    if (firstChange.current) { firstChange.current = false; return undefined; }
    dirty.current = true;
    setSaved(false);
    const timer = window.setTimeout(() => { onSaveRef.current(text); dirty.current = false; setSaved(true); }, 600);
    return () => window.clearTimeout(timer);
  }, [text]);
  useEffect(() => () => { if (dirty.current) onSaveRef.current(latest.current); }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function write() {
    if (loading) return;
    if (text.trim() && origin !== 'none' && !window.confirm('Replace the letter in the box with a new draft?')) return;
    setLoading(true);
    setError('');
    try {
      const result = await onGenerate({ tone, emphasis: emphasis.trim(), name: name.trim(), includeResume: includeResume && hasResume });
      setText(result.letter.slice(0, MAX_LETTER_CHARS));
      setFlagged(result.unsupportedNumbers);
      setOrigin('ai');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not write the letter right now.');
    } finally {
      setLoading(false);
    }
  }

  function useTemplate() {
    if (text.trim() && origin !== 'none' && !window.confirm('Replace the letter in the box with the template?')) return;
    setText(templateLetter({ name, title: job.title, matchedTerms: job.matchedTerms, skills, education }));
    setFlagged([]);
    setOrigin('template');
    setError('');
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy automatically. Select the text and copy it yourself.');
    }
  }

  const placeholders = findPlaceholders(text);
  const numbers = numbersStillPresent(flagged, text);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal letter-modal" role="dialog" aria-modal="true" aria-labelledby="letter-title">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">COVER LETTER</span>
            <h2 id="letter-title">{splitTitle(job.title).role}{company ? ` — ${company}` : ''}</h2>
            <p>Draft a letter for this listing, edit it, and keep it. Read every sentence before you send it.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button>
        </div>

        <div className="letter-options">
          <label className="field"><span className="field-label">Your name (for the sign-off)</span><input value={name} onChange={(event) => onNameChange(event.target.value.slice(0, 80))} placeholder="Full name" autoComplete="name" /></label>
          <label className="field"><span className="field-label">Tone</span><select value={tone} onChange={(event) => setTone(event.target.value as LetterTone)}>{LETTER_TONES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
          <label className="field letter-wide"><span className="field-label">Emphasise (optional)</span><input value={emphasis} onChange={(event) => setEmphasis(event.target.value.slice(0, 300))} placeholder="e.g. customs knowledge, a recent SAP rollout" /></label>
        </div>
        <label className="ai-optin letter-optin"><input type="checkbox" checked={includeResume && hasResume} disabled={!hasResume} onChange={(event) => setIncludeResume(event.target.checked)} /><span>{hasResume ? 'Share my resume text with the AI for this letter. Off by default; it lets the letter use your real experience.' : 'No resume text in your profile, so the letter can only use your roles, skills and education. Add resume text in the profile to enable this.'}</span></label>

        <div className="letter-actions">
          <button className="primary-button" onClick={() => void write()} disabled={loading || !canGenerate} title={canGenerate ? undefined : 'Add a target job title first'}><Sparkles size={15} /> {loading ? 'Writing…' : text.trim() ? 'Write again with Nemotron' : 'Write with Nemotron'}</button>
          <button className="secondary-button" onClick={useTemplate} disabled={loading}><FileText size={15} /> Use template (no AI)</button>
        </div>
        <small className="field-hint letter-privacy">Writing sends this listing&apos;s title and text, your target roles, skills, education{name.trim() ? ', your name' : ''}{includeResume && hasResume ? ' and your resume text' : ''} to NVIDIA Nemotron on Nebius when you click. The template stays on your device.</small>

        {error && <div className="alert error-alert letter-alert" role="alert"><X size={17} /><span>{error}</span><button aria-label="Dismiss message" onClick={() => setError('')}><X size={15} /></button></div>}

        <label className="field letter-field">
          <span className="field-label">Your letter{origin === 'ai' ? ' (drafted by NVIDIA Nemotron)' : origin === 'template' ? ' (template)' : ''}</span>
          <textarea value={text} onChange={(event) => setText(event.target.value.slice(0, MAX_LETTER_CHARS))} rows={14} placeholder="Write with Nemotron, start from the template, or type your own letter here." />
        </label>

        {placeholders.length > 0 && <div className="letter-warning" role="status"><AlertTriangle size={15} aria-hidden="true" /><span><strong>Fill in before sending:</strong> {placeholders.join('  ')}</span></div>}
        {numbers.length > 0 && <div className="letter-warning" role="status"><AlertTriangle size={15} aria-hidden="true" /><span><strong>Check these numbers:</strong> {numbers.join(', ')}. They are not in your profile, resume or the listing, so the AI may have made them up.</span></div>}
        {origin === 'ai' && <small className="field-hint">AI drafts can be wrong or generic. The letter is based only on the facts you gave; anything missing should be a [placeholder].</small>}

        <div className="modal-footer letter-footer">
          <span className="letter-saved">{text.trim() ? (saved ? <><Save size={13} /> Kept on this device</> : 'Saving…') : ''}</span>
          <button className="secondary-button" onClick={() => void copy()} disabled={!text.trim()}>{copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}</button>
          <button className="secondary-button" onClick={() => downloadText(letterFileName(job.title), text, 'text/plain;charset=utf-8')} disabled={!text.trim()}><Download size={15} /> Download .txt</button>
          <button className="primary-button" onClick={onClose}>Done</button>
        </div>
      </section>
    </div>
  );
}
