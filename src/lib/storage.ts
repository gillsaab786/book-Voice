import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Book, DEFAULT_SETTINGS, Settings } from './types';

// Everything lives in Documents/ so iOS shows it in the Files app (On My iPhone ▸ BookVoice).
export const booksDir = () => ensureDir(new Directory(Paths.document, 'Books'));
export const bookDir = (id: string) => ensureDir(new Directory(booksDir(), id));
const settingsFile = () => new File(Paths.document, '.settings.json');

function ensureDir(d: Directory): Directory {
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

export function safeName(s: string, max = 60): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || 'untitled';
}

// ---------- secrets ----------
export const getKey = (name: 'gemini' | 'eleven') => SecureStore.getItemAsync(`key_${name}`);
export const setKey = (name: 'gemini' | 'eleven', v: string) =>
  v ? SecureStore.setItemAsync(`key_${name}`, v.trim()) : SecureStore.deleteItemAsync(`key_${name}`);

// ---------- settings ----------
let settingsCache: Settings | null = null;
export async function loadSettings(): Promise<Settings> {
  if (settingsCache) return settingsCache;
  try {
    const f = settingsFile();
    settingsCache = f.exists ? { ...DEFAULT_SETTINGS, ...JSON.parse(await f.text()) } : { ...DEFAULT_SETTINGS };
  } catch {
    settingsCache = { ...DEFAULT_SETTINGS };
  }
  return settingsCache!;
}
export async function saveSettings(s: Settings) {
  settingsCache = s;
  const f = settingsFile();
  if (!f.exists) f.create();
  f.write(JSON.stringify(s));
}

// ---------- books ----------
const bookJson = (id: string) => new File(bookDir(id), 'book.json');

export async function listBooks(): Promise<Book[]> {
  const out: Book[] = [];
  for (const entry of booksDir().list()) {
    if (!(entry instanceof Directory)) continue;
    try {
      const f = new File(entry, 'book.json');
      if (f.exists) out.push(JSON.parse(await f.text()));
    } catch {}
  }
  return out.sort((a, b) => b.addedAt - a.addedAt);
}

export async function loadBook(id: string): Promise<Book> {
  return JSON.parse(await bookJson(id).text());
}

const listeners = new Set<(b: Book) => void>();
export const onBookSaved = (fn: (b: Book) => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export function saveBook(b: Book) {
  const f = bookJson(b.id);
  if (!f.exists) f.create();
  f.write(JSON.stringify(b));
  listeners.forEach((l) => l(b));
}

export function deleteBook(id: string) {
  const d = new Directory(booksDir(), id);
  if (d.exists) d.delete();
}

// File layout inside a book folder
export const sourceFile = (b: Book) => new File(bookDir(b.id), 'source.' + b.format);
export const chapterTextFile = (bookId: string, idx: number) => new File(bookDir(bookId), `ch${pad(idx)}.source.txt`);
export const chapterScriptFile = (bookId: string, idx: number) => new File(bookDir(bookId), `ch${pad(idx)}.script.json`);
export const chapterTimingFile = (bookId: string, idx: number) => new File(bookDir(bookId), `ch${pad(idx)}.timing.json`);
export const chapterPartialFile = (bookId: string, idx: number) => new File(bookDir(bookId), `ch${pad(idx)}.partial.wav`);
export const chapterAudioFile = (b: Book, idx: number) =>
  new File(bookDir(b.id), `${pad(idx + 1)} - ${safeName(b.chapters[idx].title, 50)}.wav`);

export const pad = (n: number) => String(n).padStart(3, '0');

export function writeText(f: File, s: string) {
  if (!f.exists) f.create();
  f.write(s);
}

export function bookAudioBytes(b: Book): number {
  let n = 0;
  b.chapters.forEach((_, i) => {
    const f = chapterAudioFile(b, i);
    if (f.exists) n += f.size || 0;
  });
  return n;
}
