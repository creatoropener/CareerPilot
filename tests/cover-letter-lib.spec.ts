import { describe, expect, it } from 'vitest';
import { MAX_LETTERS, MAX_LETTER_CHARS, letterFileName, sanitizeLetters, saveLetter, splitTitle, templateLetter } from '../src/lib/coverLetter';
import { findPlaceholders } from '../lib/letter';

const now = new Date('2026-11-27T05:00:00Z');

describe('splitTitle', () => {
  it('separates the role from the company', () => {
    expect(splitTitle('Supply Chain Manager — Acme Logistics')).toEqual({ role: 'Supply Chain Manager', company: 'Acme Logistics' });
    expect(splitTitle('Buyer')).toEqual({ role: 'Buyer', company: '' });
    expect(splitTitle('Planner — Acme — Mumbai')).toEqual({ role: 'Planner', company: 'Acme — Mumbai' });
  });
});

describe('templateLetter', () => {
  const base = { title: 'Supply Chain Manager — Acme Logistics', matchedTerms: ['SAP', 'Supply Chain Manager', 'MBA'], skills: 'SAP, Excel, Power BI', education: 'MBA · PMP' };

  it('writes only about skills that are both yours and in the listing, and leaves placeholders for the rest', () => {
    const letter = templateLetter({ ...base, name: 'Tab Kumar' });
    expect(letter).toContain('apply for the Supply Chain Manager position at Acme Logistics');
    expect(letter).toContain('My skills in SAP match');
    expect(letter).not.toContain('Excel');
    expect(letter).not.toContain('Power BI');
    expect(letter).toContain('My qualifications include MBA, PMP.');
    expect(letter.endsWith('Sincerely,\nTab Kumar')).toBe(true);
    // Every placeholder the template leaves must be one the dialog can list.
    expect(findPlaceholders(letter)).toEqual(['[One achievement from your experience, with a number]']);
  });

  it('invents nothing when it has nothing: placeholders for the name, company and reason', () => {
    const letter = templateLetter({ title: 'Buyer', matchedTerms: [], skills: '', education: '' });
    expect(letter).toContain('apply for the Buyer position.');
    expect(letter).not.toContain('qualifications');
    expect(findPlaceholders(letter)).toEqual(['[Why this role interests you]', '[One achievement from your experience, with a number]', '[Company]', '[Your name]']);
  });

  it('contains no digits except those the person supplied', () => {
    expect(templateLetter({ ...base, name: 'A' })).not.toMatch(/\d/);
  });
});

describe('letterFileName', () => {
  it('makes a safe file name', () => {
    expect(letterFileName('Supply Chain Manager — Acme / Co.')).toBe('cover-letter-supply-chain-manager-acme-co.txt');
    expect(letterFileName('')).toBe('cover-letter.txt');
    expect(letterFileName('../../etc/passwd')).toBe('cover-letter-etc-passwd.txt');
  });
});

describe('the letter store', () => {
  it('saves, replaces and removes a letter', () => {
    let store = saveLetter({}, 'https://x.test/1', { text: 'Dear A', title: 'Job' }, now);
    expect(store['https://x.test/1']).toMatchObject({ text: 'Dear A', title: 'Job', updatedAt: now.toISOString() });
    store = saveLetter(store, 'https://x.test/1', { text: 'Dear B', title: 'Job' }, now);
    expect(Object.keys(store)).toHaveLength(1);
    expect(store['https://x.test/1'].text).toBe('Dear B');
    expect(Object.keys(saveLetter(store, 'https://x.test/1', { text: '   ', title: 'Job' }, now))).toHaveLength(0);
  });

  it('limits the number and length of letters, dropping the oldest first', () => {
    let store = {};
    for (let index = 0; index < MAX_LETTERS + 5; index += 1) {
      store = saveLetter(store, `https://x.test/${index}`, { text: 'x'.repeat(MAX_LETTER_CHARS + 50), title: 't' }, new Date(now.getTime() + index * 1000));
    }
    const keys = Object.keys(store);
    expect(keys).toHaveLength(MAX_LETTERS);
    expect(keys).not.toContain('https://x.test/0');
    expect(keys).toContain(`https://x.test/${MAX_LETTERS + 4}`);
    expect((store as Record<string, { text: string }>)[keys[0]].text).toHaveLength(MAX_LETTER_CHARS);
  });

  it('keeps valid stored letters and drops malformed ones', () => {
    const stored = JSON.parse(JSON.stringify({
      'https://x.test/ok': { text: 'Hello\u0000 there', title: 'T', updatedAt: now.toISOString() },
      'javascript:alert(1)': { text: 'bad', title: 'T', updatedAt: now.toISOString() },
      'https://x.test/empty': { text: '  ', title: 'T' },
      'https://x.test/notext': { title: 'T' },
      'https://x.test/null': null,
      'https://x.test/baddate': { text: 'fine', title: 5, updatedAt: 'yesterday' },
    }));
    const result = sanitizeLetters(stored);
    expect(Object.keys(result).sort()).toEqual(['https://x.test/baddate', 'https://x.test/ok']);
    expect(result['https://x.test/ok'].text).toBe('Hello  there');
    expect(result['https://x.test/baddate']).toMatchObject({ title: '', updatedAt: new Date(0).toISOString() });
    for (const value of [null, undefined, [], 'x', 5]) expect(sanitizeLetters(value)).toEqual({});
  });
});

describe('every bracket in a template is listed', () => {
  it('has no placeholder that findPlaceholders would miss', () => {
    for (const input of [
      { title: 'Buyer', matchedTerms: [], skills: '', education: '' },
      { title: 'Planner — Acme', matchedTerms: ['SAP'], skills: 'SAP', education: 'MBA', name: 'A' },
    ]) {
      const letter = templateLetter(input);
      expect(findPlaceholders(letter)).toHaveLength((letter.match(/\[/g) ?? []).length);
    }
  });
});
