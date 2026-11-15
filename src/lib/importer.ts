import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { uid } from './bytes';
import { pdfOutline, uploadFile } from './gemini';
import { parseDocx, parseEpub, parseHtmlDoc, parsePlainText, ParsedBook } from './parsers';
import { bookDir, chapterTextFile, getKey, loadSettings, saveBook, sourceFile, writeText } from './storage';
import { Book, BookFormat } from './types';

const EXT: Record<string, BookFormat> = {
  epub: 'epub', pdf: 'pdf', txt: 'txt', text: 'txt', md: 'md', markdown: 'md', docx: 'docx', html: 'html', htm: 'html', xhtml: 'html',
};

export const PICK_TYPES = [
  'application/epub+zip', 'application/pdf', 'text/plain', 'text/markdown', 'text/html',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream', '*/*',
];

export async function pickBooks(): Promise<DocumentPicker.DocumentPickerAsset[]> {
  const r = await DocumentPicker.getDocumentAsync({ type: PICK_TYPES, multiple: true, copyToCacheDirectory: true });
  return r.canceled ? [] : r.assets;
}

export async function importBook(asset: DocumentPicker.DocumentPickerAsset, onStatus: (s: string) => void): Promise<Book> {
  const ext = (asset.name.split('.').pop() || '').toLowerCase();
  const format = EXT[ext];
  if (!format) {
    if (['mobi', 'azw', 'azw3', 'kfx'].includes(ext))
      throw new Error(`${ext.toUpperCase()} isn't supported directly. Convert it to EPUB with Calibre (free), then add it.`);
    throw new Error(`Unsupported file type: .${ext}`);
  }
  const baseTitle = asset.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
  const book: Book = { id: uid(), title: baseTitle, format, sourceName: asset.name, addedAt: Date.now(), chapters: [] };
  bookDir(book.id);
  const src = sourceFile(book);
  new File(asset.uri).copy(src);

  let parsed: ParsedBook | null = null;
  if (format === 'pdf') {
    const key = await getKey('gemini');
    if (!key) throw new Error('Add your Gemini API key in Settings first (PDFs are read by Gemini).');
    const s = await loadSettings();
    onStatus('Uploading PDF to Gemini…');
    book.geminiFile = await uploadFile(key, src, 'application/pdf', baseTitle);
    onStatus('Gemini is reading the table of contents…');
    const o = await pdfOutline(key, s.textModel, book.geminiFile);
    if (o.title) book.title = o.title;
    if (o.author) book.author = o.author;
    const secs = (o.sections || [])
      .filter((x) => x.startPage >= 1 && x.endPage >= x.startPage)
      .sort((a, b) => a.startPage - b.startPage);
    if (!secs.length) {
      const total = Math.max(1, o.totalPages || 1);
      for (let p = 1; p <= total; p += 10) secs.push({ title: `Pages ${p}–${Math.min(total, p + 9)}`, startPage: p, endPage: Math.min(total, p + 9) });
    }
    book.chapters = secs.map((x) => ({ id: uid(), title: x.title, pages: [x.startPage, x.endPage] as [number, number], status: 'pending' }));
  } else {
    onStatus('Reading book…');
    const bytes = await src.bytes();
    if (format === 'epub') parsed = await parseEpub(bytes);
    else if (format === 'docx') parsed = await parseDocx(bytes);
    else if (format === 'html') parsed = parseHtmlDoc(bytes, baseTitle);
    else parsed = parsePlainText(await src.text(), baseTitle);
    book.title = parsed.title && parsed.title !== 'Untitled' ? parsed.title : baseTitle;
    book.author = parsed.author;
    book.chapters = parsed.chapters.map((c) => ({ id: uid(), title: c.title, status: 'pending' }));
    parsed.chapters.forEach((c, i) => writeText(chapterTextFile(book.id, i), c.text));
  }
  saveBook(book);
  return book;
}

/** Re-upload a PDF if its Gemini file has expired (Gemini keeps uploads ~48h). */
export async function ensurePdfOnGemini(book: Book, key: string): Promise<{ uri: string; mimeType: string }> {
  if (book.geminiFile && book.geminiFile.expiresAt - Date.now() > 30 * 60e3) return book.geminiFile;
  book.geminiFile = await uploadFile(key, sourceFile(book), 'application/pdf', book.title);
  saveBook(book);
  return book.geminiFile;
}
