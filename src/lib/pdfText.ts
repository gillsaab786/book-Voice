import { ParsedBook, parsePlainText } from './parsers';

/** Pages -> chapters, after removing page numbers and running headers/footers. */
export function pdfToBook(pages: string[], title: string): ParsedBook {
  const lines = pages.map((p) => p.replace(/\r/g, '').split('\n').map((l) => l.trim()));
  // lines repeated at the top or bottom of many pages are running headers/footers
  const edge = new Map<string, number>();
  const norm = (l: string) => l.replace(/\d+/g, '#').toLowerCase();
  for (const ls of lines) {
    const ne = ls.filter(Boolean);
    for (const l of [...ne.slice(0, 2), ...ne.slice(-2)]) edge.set(norm(l), (edge.get(norm(l)) || 0) + 1);
  }
  const repeated = new Set([...edge.entries()].filter(([, n]) => n >= Math.max(3, pages.length * 0.3)).map(([k]) => k));
  const cleaned = lines.map((ls) =>
    ls
      .filter((l) => !/^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d+)?$/i.test(l) && !repeated.has(norm(l)))
      .join('\n')
      // join hyphenated line breaks and soft-wrapped lines into paragraphs
      .replace(/(\p{L})-\n(\p{L})/gu, '$1$2')
      .replace(/([^\n.!?:;"”’)\]।])\n(?=\p{Ll})/gu, '$1 ')
  );
  const book = parsePlainText(cleaned.join('\n\n'), title);
  if (book.chapters.length > 1 || pages.length <= 15) return book;
  // no chapter headings found: ~10 pages per part
  const chapters = [];
  for (let p = 0; p < cleaned.length; p += 10) {
    const text = cleaned.slice(p, p + 10).join('\n\n').trim();
    if (text) chapters.push({ title: `Pages ${p + 1}–${Math.min(cleaned.length, p + 10)}`, text });
  }
  return { title, chapters };
}
