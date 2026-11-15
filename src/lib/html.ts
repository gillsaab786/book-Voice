// Lightweight HTML/XHTML -> readable plain text (no DOM needed, works in Hermes).

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  copy: '©', reg: '®', trade: '™', deg: '°', middot: '·', bull: '•', times: '×', divide: '÷',
  shy: '', zwj: '', zwnj: '', thinsp: ' ', ensp: ' ', emsp: ' ', eacute: 'é', egrave: 'è',
  aacute: 'á', agrave: 'à', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', ccedil: 'ç',
  uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß', pound: '£', euro: '€', cent: '¢', yen: '¥', sect: '§', para: '¶',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return '';
      }
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

const BLOCK = /<\/?(p|div|h[1-6]|li|ul|ol|tr|table|blockquote|section|article|header|footer|aside|figure|figcaption|pre|dt|dd|hr)\b[^>]*>/gi;

export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<head[\s\S]*?<\/head>/gi, ' ');
  s = s.replace(/<(script|style|svg|math)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  // footnote reference markers like <sup><a>12</a></sup> are noise when read aloud
  s = s.replace(/<sup\b[^>]*>\s*(<a\b[^>]*>)?\s*\[?\d{1,3}\]?\s*(<\/a>)?\s*<\/sup>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<td\b[^>]*>/gi, ' | ');
  s = s.replace(BLOCK, '\n\n');
  s = s.replace(/<img\b[^>]*alt="([^"]+)"[^>]*>/gi, ' [Image: $1] ');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  s = s.replace(/\r/g, '');
  s = s
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .join('\n');
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

export function firstHeading(html: string): string | undefined {
  const m = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(html) || /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return undefined;
  const t = decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  return t && t.length < 120 ? t : undefined;
}
