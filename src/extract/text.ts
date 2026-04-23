import { parse as parseHtml } from 'node-html-parser';

export interface RawBody {
  text: string | null;
  html: string | null;
}

export function extractBody(raw: RawBody): string | null {
  const base = raw.text ?? (raw.html ? htmlToText(raw.html) : null);
  if (!base) return null;
  return stripQuotedReplies(base).trim();
}

function htmlToText(html: string): string {
  const root = parseHtml(html, { comment: false });
  for (const el of root.querySelectorAll('style, script, head')) el.remove();
  const text = root.text.replace(/ /g, ' ');
  return collapseWhitespace(text);
}

function collapseWhitespace(s: string): string {
  return s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

const REPLY_MARKERS = [
  /^On .+ wrote:$/,
  /^-+ ?Original Message ?-+$/i,
  /^From:\s/i,
  /^_{3,}$/,
];

function stripQuotedReplies(body: string): string {
  const lines = body.split('\n');
  const cutIndex = lines.findIndex((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('>')) return true;
    return REPLY_MARKERS.some((re) => re.test(trimmed));
  });
  if (cutIndex === -1) return body;
  return lines.slice(0, cutIndex).join('\n');
}
