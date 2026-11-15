import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { File, FileMode } from 'expo-file-system';
import { chunkSegments, PREP_CHARS, segmentsFromPlain } from './chunking';
import { elevenSpeak } from './elevenlabs';
import { Audio, scriptFromPdf, scriptFromText, speak } from './gemini';
import { ensurePdfOnGemini } from './importer';
import { splitText } from './parsers';
import {
  chapterAudioFile, chapterPartialFile, chapterScriptFile, chapterTextFile, chapterTimingFile, getKey, loadBook, loadSettings, saveBook, writeText,
} from './storage';
import { Book, Segment, Settings } from './types';
import { silence, toPcm, trimSilence, wavHeader } from './wav';
import { alignSentences, chunkSentences, Cue, findPauses } from './timing';

export type Progress = {
  running: boolean;
  bookId?: string;
  chapter?: number;
  phase?: 'script' | 'audio';
  done?: number;
  total?: number;
  message?: string;
  error?: string;
};

type Job = { bookId: string; chapters?: number[]; redo?: boolean };

// natural, slightly varied breath between generated chunks (people never pause identically)
const gapMs = () => 220 + Math.round(Math.random() * 200);
const CHAPTER_LEAD_MS = 700;

class Converter {
  private queue: Job[] = [];
  private abort: AbortController | null = null;
  private listeners = new Set<(p: Progress) => void>();
  progress: Progress = { running: false };

  subscribe(fn: (p: Progress) => void) {
    this.listeners.add(fn);
    fn(this.progress);
    return () => void this.listeners.delete(fn);
  }
  private emit(p: Partial<Progress>) {
    this.progress = { ...this.progress, ...p };
    this.listeners.forEach((l) => l(this.progress));
  }

  enqueue(job: Job) {
    this.queue.push(job);
    if (!this.progress.running) void this.run();
  }

  isQueued(bookId: string) {
    return this.progress.bookId === bookId || this.queue.some((j) => j.bookId === bookId);
  }

  stop(bookId?: string) {
    this.queue = bookId ? this.queue.filter((j) => j.bookId !== bookId) : [];
    if (!bookId || this.progress.bookId === bookId) this.abort?.abort();
  }

  private async run() {
    this.emit({ running: true, error: undefined });
    await activateKeepAwakeAsync('convert').catch(() => {});
    try {
      while (this.queue.length) {
        const job = this.queue.shift()!;
        this.abort = new AbortController();
        try {
          await this.runJob(job, this.abort.signal);
        } catch (e: any) {
          if (e?.message !== 'cancelled') this.emit({ error: e?.message || String(e) });
        }
      }
    } finally {
      deactivateKeepAwake('convert');
      this.abort = null;
      this.emit({ running: false, bookId: undefined, chapter: undefined, phase: undefined, message: undefined });
    }
  }

  private async runJob(job: Job, signal: AbortSignal) {
    const settings = await loadSettings();
    const geminiKey = await getKey('gemini');
    const elevenKey = settings.provider === 'elevenlabs' ? await getKey('eleven') : null;
    if (!geminiKey && (settings.adaptText || settings.provider === 'gemini')) throw new Error('Add your Gemini API key in Settings');
    if (settings.provider === 'elevenlabs' && !elevenKey) throw new Error('Add your ElevenLabs API key in Settings');

    const book = await loadBook(job.bookId);
    const idxs = job.chapters ?? book.chapters.map((_, i) => i);
    for (const i of idxs) {
      if (signal.aborted) throw new Error('cancelled');
      const ch = book.chapters[i];
      if (!job.redo && ch.status === 'done' && chapterAudioFile(book, i).exists) continue;
      if (job.redo) resetChapter(book, i);
      try {
        const segs = await this.ensureScript(book, i, settings, geminiKey!, signal);
        await this.synthesize(book, i, segs, settings, geminiKey, elevenKey, signal);
      } catch (e: any) {
        if (e?.message === 'cancelled' || signal.aborted) {
          if (ch.status === 'scripting' || ch.status === 'speaking') ch.status = ch.chunksDone ? 'speaking' : 'pending';
          saveBook(book);
          throw new Error('cancelled');
        }
        ch.status = 'error';
        ch.error = e?.message || String(e);
        saveBook(book);
        this.emit({ error: `${ch.title}: ${ch.error}` });
        if (/API key|PERMISSION|401|403|billing/i.test(ch.error!)) throw e; // no point continuing
      }
    }
  }

  private async ensureScript(book: Book, i: number, s: Settings, key: string, signal: AbortSignal): Promise<Segment[]> {
    const f = chapterScriptFile(book.id, i);
    if (f.exists) return JSON.parse(await f.text());
    const ch = book.chapters[i];
    ch.status = 'scripting';
    ch.error = undefined;
    saveBook(book);
    this.emit({ bookId: book.id, chapter: i, phase: 'script', done: 0, total: 1, message: `Preparing “${ch.title}” for narration…` });

    let segs: Segment[] = [];
    if (book.format === 'pdf') {
      const file = await ensurePdfOnGemini(book, key);
      const [a, b] = ch.pages!;
      // smaller page windows if a chapter is long, to keep each answer complete
      for (let p = a; p <= b; p += 8) {
        const range: [number, number] = [p, Math.min(b, p + 7)];
        segs.push(...(await scriptFromPdf(key, s.textModel, file, range, ch.title, signal, s.narration)));
        this.emit({ done: Math.min(b, p + 7) - a + 1, total: b - a + 1 });
      }
    } else {
      const text = await chapterTextFile(book.id, i).text();
      if (!s.adaptText) {
        segs = segmentsFromPlain(`${ch.title}\n\n${text}`);
      } else {
        const pieces = splitText(text, PREP_CHARS);
        for (let k = 0; k < pieces.length; k++) {
          const piece = k === 0 ? `${ch.title}\n\n${pieces[k]}` : pieces[k];
          try {
            segs.push(...(await scriptFromText(key, s.textModel, piece, signal, s.narration)));
          } catch (e: any) {
            if (e?.message !== 'MAX_TOKENS') throw e;
            for (const half of splitText(piece, Math.ceil(piece.length / 2)))
              segs.push(...(await scriptFromText(key, s.textModel, half, signal, s.narration)));
          }
          this.emit({ done: k + 1, total: pieces.length });
        }
      }
    }
    if (!segs.length) throw new Error('No narratable text in this section');
    writeText(f, JSON.stringify(segs));
    ch.status = 'scripted';
    saveBook(book);
    return segs;
  }

  private async synthesize(
    book: Book, i: number, segs: Segment[], s: Settings, gKey: string | null, eKey: string | null, signal: AbortSignal
  ) {
    const ch = book.chapters[i];
    const chunks = chunkSegments(segs, s.provider === 'elevenlabs' ? Math.min(s.chunkChars, 2400) : s.chunkChars);
    const partial = chapterPartialFile(book.id, i);
    // A changed voice/settings invalidates a half-finished chapter.
    const label = voiceLabel(s);
    if (ch.voiceLabel && ch.voiceLabel !== label && ch.chunksDone) {
      if (partial.exists) partial.delete();
      ch.chunksDone = 0;
      ch.pcmBytes = 0;
    }
    if (!partial.exists) {
      const tf = chapterTimingFile(book.id, i);
      if (tf.exists) tf.delete();
      partial.create();
      ch.chunksDone = 0;
      ch.pcmBytes = 0;
    }
    ch.status = 'speaking';
    ch.chunksTotal = chunks.length;
    ch.voiceLabel = label;
    saveBook(book);

    const timingFile = chapterTimingFile(book.id, i);
    let cues: Cue[] = [];
    if (ch.pcmBytes && timingFile.exists) {
      try {
        cues = JSON.parse(await timingFile.text());
      } catch {}
    }
    const handle = partial.open(FileMode.ReadWrite);
    try {
      let sampleRate = ch.sampleRate || 24000;
      if (!ch.pcmBytes) {
        handle.offset = 0;
        handle.writeBytesSync(wavHeader(0, sampleRate));
        handle.writeBytesSync(silence(CHAPTER_LEAD_MS, sampleRate));
        ch.pcmBytes = silence(CHAPTER_LEAD_MS, sampleRate).length;
      }
      const conc = Math.max(1, Math.min(4, s.concurrency));
      let next = ch.chunksDone || 0;
      while (next < chunks.length) {
        if (signal.aborted) throw new Error('cancelled');
        this.emit({ bookId: book.id, chapter: i, phase: 'audio', done: next, total: chunks.length, message: `Recording “${ch.title}”` });
        const batch = chunks.slice(next, next + conc);
        const audios = await Promise.all(
          batch.map((parts) =>
            s.provider === 'elevenlabs' ? elevenSpeak(eKey!, s, parts, signal) : speak({ key: gKey!, settings: s, parts, signal })
          )
        );
        for (let b = 0; b < audios.length; b++) {
          const pcm = decode(audios[b]);
          if (next === 0 && (ch.chunksDone || 0) === 0 && pcm.sampleRate !== sampleRate) {
            // first chunk tells us the true sample rate; rewrite the lead-in header
            sampleRate = pcm.sampleRate;
            handle.offset = 0;
            handle.writeBytesSync(wavHeader(0, sampleRate));
            handle.writeBytesSync(silence(CHAPTER_LEAD_MS, sampleRate));
            ch.pcmBytes = silence(CHAPTER_LEAD_MS, sampleRate).length;
          }
          const body = trimSilence(pcm.data, sampleRate);
          // read-along cues for this chunk
          const startSec = ch.pcmBytes! / (sampleRate * 2);
          const sentences = chunkSentences(batch[b]);
          const starts = alignSentences(sentences.map((x) => x.s), body.length / (sampleRate * 2), findPauses(body, sampleRate));
          sentences.forEach((x, k) => cues.push({ t: +(startSec + starts[k]).toFixed(2), s: x.s, p: x.p, ...(x.d ? { d: true } : {}) }));
          handle.offset = 44 + ch.pcmBytes!;
          handle.writeBytesSync(body);
          const gap = silence(gapMs(), sampleRate);
          handle.writeBytesSync(gap);
          ch.pcmBytes! += body.length + gap.length;
          ch.sampleRate = sampleRate;
          next++;
          ch.chunksDone = next;
        }
        writeText(timingFile, JSON.stringify(cues));
        saveBook(book);
      }
      // finalise header
      handle.offset = 0;
      handle.writeBytesSync(wavHeader(ch.pcmBytes!, sampleRate));
    } finally {
      handle.close();
    }
    const out = chapterAudioFile(book, i);
    if (out.exists) out.delete();
    partial.move(out);
    ch.durationSec = ch.pcmBytes! / (ch.sampleRate! * 2);
    ch.status = 'done';
    ch.error = undefined;
    saveBook(book);
  }
}

function decode(a: Audio) {
  const pcm = toPcm(a.bytes, a.mimeType);
  if (pcm.bits !== 16 || pcm.channels !== 1) throw new Error(`Unexpected audio format ${pcm.bits}-bit/${pcm.channels}ch`);
  return pcm;
}

export function voiceLabel(s: Settings) {
  if (s.provider === 'elevenlabs') return `ElevenLabs ${s.elevenVoiceId}`;
  return s.voice.label + (s.dialogueMode ? ` + ${s.dialogueVoice.label}` : '') + ` · ${s.style.slice(0, 40)}`;
}

export function resetChapter(book: Book, i: number, keepScript = true) {
  const ch = book.chapters[i];
  const p = chapterPartialFile(book.id, i);
  if (p.exists) p.delete();
  const a = chapterAudioFile(book, i);
  if (a.exists) a.delete();
  const tf = chapterTimingFile(book.id, i);
  if (tf.exists) tf.delete();
  if (!keepScript) {
    const sc = chapterScriptFile(book.id, i);
    if (sc.exists) sc.delete();
  }
  Object.assign(ch, { status: 'pending', chunksDone: 0, pcmBytes: 0, chunksTotal: undefined, durationSec: undefined, error: undefined, voiceLabel: undefined });
  saveBook(book);
}

export const converter = new Converter();

export async function previewVoice(s: Settings, text: string): Promise<File> {
  const parts: Segment[] = [{ speaker: 'NARRATOR', text }];
  const a =
    s.provider === 'elevenlabs'
      ? await elevenSpeak((await getKey('eleven'))!, s, parts)
      : await speak({ key: (await getKey('gemini'))!, settings: { ...s, dialogueMode: false }, parts });
  return audioToWavFile(a);
}

export async function audioToWavFile(a: Audio): Promise<File> {
  const pcm = decode(a);
  const { Paths } = await import('expo-file-system');
  const f = new File(Paths.cache, `preview-${Date.now()}.wav`);
  f.create();
  const h = f.open(FileMode.WriteOnly);
  h.writeBytesSync(wavHeader(pcm.data.length, pcm.sampleRate));
  h.writeBytesSync(pcm.data);
  h.close();
  return f;
}
