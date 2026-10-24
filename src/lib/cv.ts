// CV text extraction. Runs entirely in the browser: the file never leaves the device.
// PDF and DOCX parsers are loaded on demand so they do not slow down the first page load.

export const MAX_CV_BYTES = 5 * 1024 * 1024;
export const MAX_CV_CHARS = 20_000;
const MAX_PDF_PAGES = 15;

export class CvError extends Error {}

type Kind = 'pdf' | 'docx' | 'text';

export function detectCvKind(file: Pick<File, 'name' | 'type'>): Kind | null {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || name.endsWith('.docx')) return 'docx';
  if (file.type.startsWith('text/') || /\.(txt|md|rtf)$/.test(name)) return 'text';
  return null;
}

export function normalizeCvText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, MAX_CV_CHARS);
}

async function readPdf(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let number = 1; number <= Math.min(document.numPages, MAX_PDF_PAGES); number += 1) {
    const page = await document.getPage(number);
    const content = await page.getTextContent();
    let line = '';
    const lines: string[] = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      line += item.str;
      if (item.hasEOL) { lines.push(line); line = ''; } else if (item.str && !item.str.endsWith(' ')) { line += ' '; }
    }
    if (line.trim()) lines.push(line);
    pages.push(lines.join('\n'));
  }
  return pages.join('\n\n');
}

async function readDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth/mammoth.browser.js');
  const result = await (mammoth.default ?? mammoth).extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

export async function extractCvText(file: File): Promise<string> {
  if (file.size > MAX_CV_BYTES) throw new CvError('That file is larger than 5 MB. Upload a smaller CV or paste the text instead.');
  const kind = detectCvKind(file);
  if (!kind) throw new CvError('Unsupported file type. Upload a PDF, DOCX or TXT file, or paste the text.');
  let raw: string;
  try {
    raw = kind === 'pdf' ? await readPdf(file) : kind === 'docx' ? await readDocx(file) : await file.text();
  } catch {
    throw new CvError('Could not read that file. It may be damaged or password-protected. Try another copy or paste the text.');
  }
  const text = normalizeCvText(raw);
  if (text.length < 40) {
    throw new CvError('No readable text was found. Scanned or image-only CVs are not supported; paste the text instead.');
  }
  return text;
}
