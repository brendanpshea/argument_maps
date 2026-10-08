/**
 * Parses passage markup. Claims are written `{{id|text}}`; everything else
 * is plain passage text.
 */

export interface ParsedPassage {
  text: string;
  claims: { id: string; start: number; end: number; text: string }[];
}

const CLAIM = /\{\{\s*([A-Za-z][\w-]*)\s*\|([\s\S]*?)\}\}/g;

/** Single line breaks become spaces (as in Markdown); blank lines separate paragraphs. */
function normalizeWhitespace(markup: string): string {
  return markup
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .join('\n\n');
}

export function parsePassage(markup: string): ParsedPassage {
  const source = normalizeWhitespace(markup);
  const claims: ParsedPassage['claims'] = [];
  let text = '';
  let last = 0;
  for (const match of source.matchAll(CLAIM)) {
    text += source.slice(last, match.index);
    const claimText = match[2];
    claims.push({ id: match[1], start: text.length, end: text.length + claimText.length, text: claimText });
    text += claimText;
    last = match.index + match[0].length;
  }
  text += source.slice(last);
  if (text.includes('{{') || text.includes('}}')) {
    throw new Error(`Malformed claim markup near: ${text.slice(text.search(/\{\{|\}\}/), 60)}`);
  }
  return { text, claims };
}
