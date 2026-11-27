// Turns page text and HTML into short plain text for display and for matching. Pure and dependency-free.

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', hellip: '…', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    }
    return NAMED[entity.toLowerCase()] ?? match;
  });
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function tidyLines(value: string, max: number): string {
  const lines = value
    .replace(CONTROL, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line.length > 1 && !/^https?:\/\/\S+$/i.test(line));
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n');
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return `${(lastBreak > max * 0.6 ? cut.slice(0, lastBreak) : cut).trimEnd()}…`;
}

/**
 * Plain text from HTML. Greenhouse sends its descriptions as escaped HTML ("&lt;p&gt;..."), so entities are decoded
 * first, then the tags are removed, with paragraph and list breaks kept as line breaks.
 */
export function plainText(html: string, max = 2500): string {
  let text = decodeEntities(String(html ?? ''));
  text = text
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|ul|ol|h[1-6]|tr|section)\s*>/gi, '\n')
    .replace(/<\s*li\b[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, ' ');
  return tidyLines(decodeEntities(text), max);
}

/** Text of a web page as returned by a search provider: control characters and link-only lines removed, then shortened. */
export function cleanPageText(raw: string | null | undefined, max = 2500): string {
  if (!raw) return '';
  return tidyLines(String(raw).replace(/!?\[([^\]]*)\]\(https?:\/\/[^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, ' '), max);
}
