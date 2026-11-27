// Small, dependency-free helpers for cover letters, shared by the browser and the serverless function.

/** Placeholders such as [Your name] that the person still has to fill in. Unique, in order of appearance. */
export function findPlaceholders(letter: string): string[] {
  const found = letter.match(/\[[^\][\n]{2,60}\]/g) ?? [];
  return [...new Set(found)];
}

/**
 * Numbers in a draft that appear nowhere in the material it was written from (profile, resume, listing). A model can
 * invent "8 years" or "30%"; this does not catch everything, but anything it returns must be checked before sending.
 */
export function findUnsupportedNumbers(letter: string, sources: string[], max = 6): string[] {
  const haystack = sources.join(' ').toLowerCase();
  const unsupported: string[] = [];
  for (const match of letter.matchAll(/\b\d[\d,.]*\d%?|\b\d%?/g)) {
    const token = match[0].replace(/[,.]+$/, '');
    if (haystack.includes(token.toLowerCase())) continue;
    // "8 years" reads better than "8" when the next word says what the number counts.
    const after = letter.slice((match.index ?? 0) + match[0].length).match(/^\s+(years?|yrs?|months?|people|countries|clients|teams?|projects?)\b/i);
    const label = after ? `${token} ${after[1].toLowerCase()}` : token;
    if (!unsupported.includes(label)) unsupported.push(label);
    if (unsupported.length >= max) break;
  }
  return unsupported;
}
