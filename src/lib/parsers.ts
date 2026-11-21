// Pure parsers (no React Native imports) so they can be unit-tested in Node.
import JSZip from 'jszip';
import { decodeEntities, firstHeading, htmlToText } from './html';
import { decodeUtf8 } from './bytes';

export type ParsedChapter = { title: string; text: string };
export type ParsedBook = { title: string; author?: string; chapters: ParsedChapter[] };

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : undefined;
};

function resolvePath(base: string, rel: string): string {
  const clean = decodeURIComponent(rel.split('#')[0]);
  const parts = (base ? base.split('/').filter(Boolean) : []).concat(clean.split('/'));
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

function zipFile(zip: JSZip, path: string) {
  return zip.file(path) || zip.file(Object.keys(zip.files).find((k) => k.toLowerCase() === path.toLowerCase()) || '');
}

const MIN_CHARS = 60; // skip covers / blank pages

export async function parseEpub(bytes: Uint8Array): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(bytes);
  const container = await zipFile(zip, 'META-INF/container.xml')?.async('string');
  if (!container) throw new Error('Not a valid EPUB (missing container.xml)');
  const rootTag = /<rootfile\b[^>]*>/i.exec(container)?.[0] || '';
  const opfPath = attr(rootTag, 'full-path');
  if (!opfPath) throw new Error('EPUB has no package file');
  const opf = await zipFile(zip, opfPath)?.async('string');
  if (!opf) throw new Error('EPUB package file missing');
  const opfDir = dirOf(opfPath);

  const meta = (name: string) => {
    const m = new RegExp(`<dc:${name}\\b[^>]*>([\\s\\S]*?)</dc:${name}>`, 'i').exec(opf);
    return m ? decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim() : undefined;
  };

  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const m of opf.matchAll(/<item\b[^>]*>/gi)) {
    const id = attr(m[0], 'id');
    const href = attr(m[0], 'href');
    if (id && href) manifest.set(id, { href: resolvePath(opfDir, href), type: attr(m[0], 'media-type') || '', props: attr(m[0], 'properties') || '' });
  }

  // Table of contents titles: EPUB3 nav or EPUB2 NCX
  const tocTitles = new Map<string, string>();
  const navItem = [...manifest.values()].find((i) => /\bnav\b/.test(i.props));
  const spineTag = /<spine\b[^>]*>/i.exec(opf)?.[0] || '';
  const ncxId = attr(spineTag, 'toc');
  const ncxItem = (ncxId && manifest.get(ncxId)) || [...manifest.values()].find((i) => i.type === 'application/x-dtbncx+xml');
  if (navItem) {
    const nav = (await zipFile(zip, navItem.href)?.async('string')) || '';
    const tocBlock = /<nav\b[^>]*(epub:type|role)\s*=\s*"(toc|doc-toc)"[^>]*>([\s\S]*?)<\/nav>/i.exec(nav)?.[3] || nav;
    for (const a of tocBlock.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = attr(a[1], 'href');
      const t = decodeEntities(a[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      if (href && t) {
        const key = resolvePath(dirOf(navItem.href), href);
        if (!tocTitles.has(key)) tocTitles.set(key, t);
      }
    }
  }
  if (!tocTitles.size && ncxItem) {
    const ncx = (await zipFile(zip, ncxItem.href)?.async('string')) || '';
    for (const np of ncx.matchAll(/<navPoint\b[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<content\b([^>]*)\/?>/gi)) {
      const src = attr(np[2], 'src');
      const t = decodeEntities(np[1]).replace(/\s+/g, ' ').trim();
      if (src && t) {
        const key = resolvePath(dirOf(ncxItem.href), src);
        if (!tocTitles.has(key)) tocTitles.set(key, t);
      }
    }
  }

  const chapters: ParsedChapter[] = [];
  let lastTitle = '';
  let partCount = 0;
  for (const ref of opf.matchAll(/<itemref\b[^>]*>/gi)) {
    if (attr(ref[0], 'linear') === 'no') continue;
    const item = manifest.get(attr(ref[0], 'idref') || '');
    if (!item || !/html|xml/.test(item.type)) continue;
    const html = await zipFile(zip, item.href)?.async('string');
    if (!html) continue;
    const text = htmlToText(html);
    if (text.length < MIN_CHARS) continue;
    let title = tocTitles.get(item.href) || firstHeading(html);
    if (!title) {
      title = lastTitle ? `${lastTitle} (cont. ${++partCount})` : `Section ${chapters.length + 1}`;
    } else {
      lastTitle = title;
      partCount = 0;
    }
    chapters.push({ title, text });
  }
  if (!chapters.length) throw new Error('No readable text found in this EPUB (it may be DRM-protected).');
  return { title: meta('title') || 'Untitled', author: meta('creator'), chapters };
}

export async function parseDocx(bytes: Uint8Array): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zipFile(zip, 'word/document.xml')?.async('string');
  if (!xml) throw new Error('Not a valid .docx');
  const paras: { text: string; heading: boolean }[] = [];
  for (const p of xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    const heading = /<w:pStyle w:val="(Heading|Title)[^"]*"/i.test(p[0]);
    const text = decodeEntities(
      [...p[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map((t) => (t[1] !== undefined ? t[1] : ' ')).join('')
    ).trim();
    if (text) paras.push({ text, heading });
  }
  const core = (await zipFile(zip, 'docProps/core.xml')?.async('string')) || '';
  const title = /<dc:title>([\s\S]*?)<\/dc:title>/.exec(core)?.[1];
  const author = /<dc:creator>([\s\S]*?)<\/dc:creator>/.exec(core)?.[1];
  const chapters: ParsedChapter[] = [];
  let cur: ParsedChapter | null = null;
  for (const p of paras) {
    if (p.heading && p.text.length < 120) {
      if (cur && cur.text.length >= MIN_CHARS) chapters.push(cur);
      cur = { title: p.text, text: '' };
    } else {
      if (!cur) cur = { title: 'Start', text: '' };
      cur.text += (cur.text ? '\n\n' : '') + p.text;
    }
  }
  if (cur && cur.text) chapters.push(cur);
  const merged = mergeTiny(chapters.length ? chapters : [{ title: 'Document', text: paras.map((p) => p.text).join('\n\n') }]);
  return { title: title ? decodeEntities(title) : 'Untitled', author: author ? decodeEntities(author) : undefined, chapters: merged.flatMap(splitHuge) };
}

const CHAPTER_RE = /^\s*(chapter|part|book|prologue|epilogue|introduction|preface|afterword|chapitre|capítulo|kapitel|अध्याय|ਅਧਿਆਇ)\b[^\n]{0,80}$/gim;

export function parsePlainText(raw: string, fallbackTitle: string): ParsedBook {
  const text = raw.replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const marks = [...text.matchAll(CHAPTER_RE)]
    .map((m) => ({ idx: m.index!, len: m[0].length, title: m[0].trim() }))
    .filter((m) => m.title.length <= 60 && !/[.,;]$/.test(m.title) && m.title.split(/\s+/).length <= 8);
  let chapters: ParsedChapter[] = [];
  if (marks.length >= 2) {
    if (marks[0].idx > 0 && text.slice(0, marks[0].idx).trim().length >= MIN_CHARS)
      chapters.push({ title: 'Opening', text: text.slice(0, marks[0].idx).trim() });
    marks.forEach((m, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].idx : text.length;
      const body = text.slice(m.idx + m.len, end).trim();
      if (body) chapters.push({ title: m.title, text: body });
    });
  } else {
    chapters = [{ title: fallbackTitle, text: text.trim() }];
  }
  return { title: fallbackTitle, chapters: mergeTiny(chapters).flatMap(splitHuge) };
}

export function parseHtmlDoc(bytes: Uint8Array, fallbackTitle: string): ParsedBook {
  const html = decodeUtf8(bytes);
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  return parsePlainText(htmlToText(html), title ? decodeEntities(title) : fallbackTitle);
}

function mergeTiny(ch: ParsedChapter[]): ParsedChapter[] {
  const out: ParsedChapter[] = [];
  for (const c of ch) {
    if (out.length && c.text.length < MIN_CHARS) out[out.length - 1].text += '\n\n' + c.title + '\n\n' + c.text;
    else out.push({ ...c });
  }
  return out;
}

/** Keep chapters to a sane size (~45 min of audio max) so each file is manageable. */
const MAX_CHAPTER_CHARS = 45000;
export function splitHuge(c: ParsedChapter): ParsedChapter[] {
  if (c.text.length <= MAX_CHAPTER_CHARS) return [c];
  const pieces = splitText(c.text, MAX_CHAPTER_CHARS);
  return pieces.map((t, i) => ({ title: `${c.title} (part ${i + 1})`, text: t }));
}

/** Split text at paragraph, then sentence, then word boundaries into pieces ≤ max chars. */
export function splitText(text: string, max: number): string[] {
  const out: string[] = [];
  let buf = '';
  const push = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = '';
  };
  for (const para of text.split(/\n{2,}/)) {
    if ((buf + '\n\n' + para).length <= max) {
      buf = buf ? buf + '\n\n' + para : para;
      continue;
    }
    push();
    if (para.length <= max) {
      buf = para;
      continue;
    }
    // sentence split (Latin + Devanagari/Gurmukhi danda)
    const sentences = para.match(/[^.!?।॥]+[.!?।॥]+["'”’)\]]*\s*|[^.!?।॥]+$/g) || [para];
    for (let s of sentences) {
      while (s.length > max) {
        const cut = s.lastIndexOf(' ', max) > max * 0.5 ? s.lastIndexOf(' ', max) : max;
        if (buf) push();
        out.push(s.slice(0, cut).trim());
        s = s.slice(cut);
      }
      if ((buf + s).length > max) push();
      buf += s;
    }
  }
  push();
  return out;
}
