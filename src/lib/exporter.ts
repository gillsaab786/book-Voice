import { Directory, File, FileMode } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { chapterAudioFile, safeName } from './storage';
import { Book } from './types';

export async function shareChapter(book: Book, i: number) {
  const f = chapterAudioFile(book, i);
  if (!f.exists) throw new Error('No audio for this chapter yet');
  await Sharing.shareAsync(f.uri, { mimeType: 'audio/wav', UTI: 'com.microsoft.waveform-audio', dialogTitle: book.chapters[i].title });
}

/** Copy every finished chapter (lossless WAV) into a folder you choose: Files app, SD card, Downloads… */
export async function exportToFolder(book: Book, onProgress: (done: number, total: number) => void): Promise<number> {
  const root = await Directory.pickDirectoryAsync();
  const files = book.chapters.map((_, i) => chapterAudioFile(book, i)).filter((f) => f.exists);
  if (!files.length) throw new Error('No finished chapters to export yet');
  let target: Directory = root;
  try {
    target = root.createDirectory(safeName(book.title));
  } catch {
    target = root; // some providers don't allow sub-folders
  }
  let n = 0;
  for (const src of files) {
    const dst = target.createFile(src.name, 'audio/wav');
    await streamCopy(src, dst);
    onProgress(++n, files.length);
  }
  return n;
}

async function streamCopy(src: File, dst: File) {
  const CH = 4 * 1024 * 1024;
  const r = src.open(FileMode.ReadOnly);
  const w = dst.open(FileMode.WriteOnly);
  try {
    for (;;) {
      const bytes = await r.readBytes(CH);
      if (!bytes.length) break;
      await w.writeBytes(bytes);
    }
  } finally {
    r.close();
    w.close();
  }
}
