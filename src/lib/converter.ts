import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { File, FileMode, Paths } from 'expo-file-system';
import { chunkSegments, segmentsFromPlain } from './chunking';
import { DailyLimitError, timeLabel } from './errors';
import { Audio, scriptFromPdf } from './gemini';
import { ensurePdfOnGemini } from './importer';
import { adaptChapter } from './prep';
import { chunkCharsFor, engineConcurrency, engineProblem, ENGINE_NAMES, laneOf, profileFromSettings, profileLabel, synth } from './speech';
import {
  chapterAudioFile, chapterPartialFile, chapterScriptFile, chapterTextFile, chapterTimingFile, getKey, loadBook, loadSettings, saveBook, writeText,
} from './storage';
import { alignSentences, chunkSentences, Cue, findPauses } from './timing';
import { Book, Engine, Segment, Settings, VoiceProfile } from './types';
import { resample16, silence, toPcm, trimSilence, wavHeader } from './wav';

export const RATE = 24000; // every chapter file: 24 kHz, 16-bit, mono

export type BookProgress = {
  bookId: string;
  title: string;
  engine: Engine;
  lane: string;
  percent: number; // 0..1
  state: 'queued' | 'reading' | 'recording' | 'waiting' | 'error' | 'done';
  message: string;
  chapter?: number;
  waitUntil?: number;
  eta?: number; // seconds
  error?: string;
};

export type Progress = {
  running: boolean;
  books: Record<string, BookProgress>;
  order: string[]; // queue order
};

type QueueItem = { bookId: string; chapters?: number[]; redo?: boolean; addedAt: number; waitUntil?: number };

const queueFile = () => new File(Paths.document, '.queue.json');
const gapMs = () => 220 + Math.round(Math.random() * 200); // people never pause identically
const CHAPTER_LEAD_MS = 700;

class Converter {
  private queue: QueueItem[] = [];
  private running = new Map<string, { abort: AbortController; engine: string; started: number; p0: number }>();
  private listeners = new Set<(p: Progress) => void>();
  private timer: any = null;
  private loaded = false;
  progress: Progress = { running: false, books: {}, order: [] };

  subscribe(fn: (p: Progress) => void) {
    this.listeners.add(fn);
    fn(this.progress);
    return () => void this.listeners.delete(fn);
  }
  private emitNow() {
    this.progress = { running: this.running.size > 0, books: { ...this.progress.books }, order: this.queue.map((q) => q.bookId) };
    this.listeners.forEach((l) => l(this.progress));
  }
  private emitTimer: any = null;
  private emit() {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emitNow();
    }, 250);
  }
  private setBook(id: string, patch: Partial<BookProgress>) {
    const prev = this.progress.books[id] || ({ bookId: id, title: '', engine: 'gemini', lane: 'gemini', percent: 0, state: 'queued', message: '' } as BookProgress);
    this.progress.books[id] = { ...prev, ...patch };
    this.emit();
  }

  /** Load the saved queue (after the app was closed) and carry on. */
  async restore() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const f = queueFile();
      if (f.exists) this.queue = JSON.parse(await f.text());
    } catch {}
    for (const q of this.queue) await this.describe(q.bookId, 'queued');
    this.emitNow();
    this.tick();
  }
  private persist() {
    const f = queueFile();
    if (!f.exists) f.create();
    f.write(JSON.stringify(this.queue));
  }

  private async describe(bookId: string, state: BookProgress['state']) {
    try {
      const b = await loadBook(bookId);
      const s = await loadSettings();
      const p = b.profile || profileFromSettings(s);
      this.setBook(bookId, { title: b.title, engine: p.engine, lane: laneOf(p, s), percent: bookPercent(b), state, message: state === 'queued' ? `Waiting · ${ENGINE_NAMES[p.engine]}` : '' });
    } catch {}
  }

  /** Add a book (or some chapters) to the queue, optionally with the voice to use. */
  async enqueue(bookId: string, opts: { chapters?: number[]; redo?: boolean; profile?: VoiceProfile } = {}) {
    await this.restore();
    if (opts.profile) {
      const b = await loadBook(bookId);
      b.profile = opts.profile;
      saveBook(b);
    }
    const existing = this.queue.find((q) => q.bookId === bookId);
    if (existing && !opts.chapters) {
      existing.waitUntil = undefined;
    } else if (existing && opts.chapters) {
      existing.chapters = existing.chapters ? Array.from(new Set([...existing.chapters, ...opts.chapters])) : undefined;
    } else {
      this.queue.push({ bookId, chapters: opts.chapters, redo: opts.redo, addedAt: Date.now() });
    }
    this.persist();
    await this.describe(bookId, 'queued');
    this.tick();
  }

  isQueued(bookId: string) {
    return this.queue.some((q) => q.bookId === bookId);
  }

  move(bookId: string, dir: -1 | 1) {
    const i = this.queue.findIndex((q) => q.bookId === bookId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.queue.length) return;
    [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    this.persist();
    this.emitNow();
    this.tick();
  }

  /** Remove from the queue (stops it if it's converting). Finished chapters are kept. */
  stop(bookId?: string) {
    const ids = bookId ? [bookId] : this.queue.map((q) => q.bookId);
    this.queue = this.queue.filter((q) => !ids.includes(q.bookId));
    for (const id of ids) {
      this.running.get(id)?.abort.abort();
      delete this.progress.books[id];
    }
    this.persist();
    this.emitNow();
  }

  /** Start every queued book whose voice service is free (one book per service at a time). */
  private tick() {
    clearTimeout(this.timer);
    const now = Date.now();
    const busy = new Set([...this.running.values()].map((r) => r.engine));
    let nextWake = Infinity;
    for (const q of this.queue) {
      if (this.running.has(q.bookId)) continue;
      if (q.waitUntil && q.waitUntil > now) {
        nextWake = Math.min(nextWake, q.waitUntil);
        continue;
      }
      const engine = this.progress.books[q.bookId]?.lane || 'gemini';
      if (busy.has(engine)) continue;
      busy.add(engine);
      void this.start(q, engine);
    }
    if (nextWake < Infinity) this.timer = setTimeout(() => this.tick(), Math.min(nextWake - now + 1000, 2 ** 31 - 1));
    if (this.running.size) void activateKeepAwakeAsync('convert').catch(() => {});
    else deactivateKeepAwake('convert');
    this.emitNow();
  }

  private async start(q: QueueItem, engine: string) {
    const abort = new AbortController();
    const book0 = await loadBook(q.bookId).catch(() => null);
    if (!book0) {
      this.stop(q.bookId);
      return;
    }
    this.running.set(q.bookId, { abort, engine, started: Date.now(), p0: bookPercent(book0) });
    this.setBook(q.bookId, { state: 'reading', message: 'Starting…', error: undefined, waitUntil: undefined });
    this.emitNow();
    let finished = false;
    try {
      await this.runBook(q, abort.signal);
      finished = true;
    } catch (e: any) {
      if (e instanceof DailyLimitError) {
        q.waitUntil = e.resumeAt;
        this.setBook(q.bookId, { state: 'waiting', waitUntil: e.resumeAt, message: `${e.message} · carries on at ${timeLabel(e.resumeAt)}` });
      } else if (e?.message !== 'cancelled') {
        this.setBook(q.bookId, { state: 'error', error: e?.message || String(e), message: e?.message || String(e) });
        // keep it in the queue but don't spin on it
        q.waitUntil = Date.now() + 10 * 60e3;
      }
    } finally {
      this.running.delete(q.bookId);
      if (finished) {
        this.queue = this.queue.filter((x) => x !== q);
        this.setBook(q.bookId, { state: 'done', percent: 1, message: 'Ready to listen', eta: undefined });
        setTimeout(() => {
          if (this.progress.books[q.bookId]?.state === 'done') delete this.progress.books[q.bookId];
          this.emitNow();
        }, 60e3);
      }
      this.persist();
      this.tick();
    }
  }

  private async runBook(q: QueueItem, signal: AbortSignal) {
    const s = await loadSettings();
    const book = await loadBook(q.bookId);
    const profile = book.profile || profileFromSettings(s);
    const problem = await engineProblem(profile.engine, s);
    if (problem) throw new Error(problem);

    const idxs = (q.chapters ?? book.chapters.map((_, i) => i)).filter((i) => i < book.chapters.length);
    if (q.redo) {
      idxs.forEach((i) => resetChapter(book, i));
      q.redo = false;
      this.persist();
    }
    const todo = idxs.filter((i) => !(book.chapters[i].status === 'done' && chapterAudioFile(book, i).exists));
    const update = (msg: string, state: BookProgress['state'], chapter?: number) => {
      const r = this.running.get(book.id);
      const pct = bookPercent(book);
      let eta: number | undefined;
      if (r && pct - r.p0 > 0.01) eta = ((Date.now() - r.started) / 1000) * ((1 - pct) / (pct - r.p0));
      this.setBook(book.id, { title: book.title, engine: profile.engine, lane: laneOf(profile, s), percent: pct, state, message: msg, chapter, eta });
    };

    // Text preparation runs ahead of the voice, several chapters at once.
    const prep = new Map<number, Promise<Segment[]>>();
    const AHEAD = 4;
    const ensurePrep = (i: number) => {
      if (!prep.has(i)) {
        const p = this.ensureScript(book, i, s, profile, signal, (m) => update(m, 'reading', i));
        p.catch(() => {}); // handled when awaited
        prep.set(i, p);
      }
      return prep.get(i)!;
    };

    for (let k = 0; k < todo.length; k++) {
      if (signal.aborted) throw new Error('cancelled');
      for (let a = k; a < Math.min(todo.length, k + AHEAD); a++) ensurePrep(todo[a]);
      const i = todo[k];
      const ch = book.chapters[i];
      update(`Preparing “${ch.title}”`, 'reading', i);
      let segs: Segment[];
      try {
        segs = await ensurePrep(i);
      } catch (e: any) {
        if (e instanceof DailyLimitError || e?.message === 'cancelled' || signal.aborted) throw e;
        ch.status = 'error';
        ch.error = e?.message || String(e);
        saveBook(book);
        continue;
      }
      try {
        await this.synthesize(book, i, segs, s, profile, signal, (m) => update(m, 'recording', i));
      } catch (e: any) {
        if (e instanceof DailyLimitError || e?.message === 'cancelled' || signal.aborted) {
          if (ch.status === 'speaking' && !ch.chunksDone) ch.status = 'scripted';
          saveBook(book);
          throw e instanceof DailyLimitError ? e : new Error('cancelled');
        }
        ch.status = 'error';
        ch.error = e?.message || String(e);
        saveBook(book);
        if (/key|PERMISSION|401|403|billing|region/i.test(ch.error!)) throw e;
      }
    }
    const failed = todo.filter((i) => book.chapters[i].status === 'error');
    if (failed.length) throw new Error(`${failed.length} chapter${failed.length > 1 ? 's' : ''} failed — long-press them to retry`);
  }

  private async ensureScript(book: Book, i: number, s: Settings, p: VoiceProfile, signal: AbortSignal, say: (m: string) => void): Promise<Segment[]> {
    const f = chapterScriptFile(book.id, i);
    if (f.exists) return JSON.parse(await f.text());
    const ch = book.chapters[i];
    ch.status = 'scripting';
    ch.error = undefined;
    saveBook(book);

    let segs: Segment[] = [];
    if (book.format === 'pdf' && !book.pdfText) {
      const key = await getKey('gemini');
      if (!key) throw new Error('This PDF needs Gemini (or a Mistral key for OCR) to be read');
      const file = await ensurePdfOnGemini(book, key);
      const [a, b] = ch.pages!;
      for (let pg = a; pg <= b; pg += 8) {
        const range: [number, number] = [pg, Math.min(b, pg + 7)];
        say(`Reading pages ${range[0]}–${range[1]}`);
        segs.push(...(await scriptFromPdf(key, s.textModel, file, range, ch.title, signal, p.narration)));
      }
    } else {
      const text = await chapterTextFile(book.id, i).text();
      if (!p.adaptText) segs = segmentsFromPlain(`${ch.title}\n\n${text}`);
      else segs = await adaptChapter(ch.title, text, p.narration, s.textModel, (d, t) => say(`Adapting “${ch.title}” ${d}/${t}`), signal);
    }
    if (!segs.length) throw new Error('No narratable text in this section');
    writeText(f, JSON.stringify(segs));
    if (ch.status === 'scripting') ch.status = 'scripted';
    saveBook(book);
    return segs;
  }

  private async synthesize(book: Book, i: number, segs: Segment[], s: Settings, p: VoiceProfile, signal: AbortSignal, say: (m: string) => void) {
    const ch = book.chapters[i];
    const chunks = chunkSegments(segs, chunkCharsFor(p.engine, s));
    const partial = chapterPartialFile(book.id, i);
    const label = profileLabel(p);
    if (ch.voiceLabel && ch.voiceLabel !== label && ch.chunksDone) {
      if (partial.exists) partial.delete();
      ch.chunksDone = 0;
      ch.pcmBytes = 0;
    }
    if (!partial.exists || ch.sampleRate !== RATE) {
      if (partial.exists) partial.delete();
      const tf = chapterTimingFile(book.id, i);
      if (tf.exists) tf.delete();
      partial.create();
      ch.chunksDone = 0;
      ch.pcmBytes = 0;
    }
    ch.status = 'speaking';
    ch.chunksTotal = chunks.length;
    ch.voiceLabel = label;
    ch.sampleRate = RATE;
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
      if (!ch.pcmBytes) {
        handle.offset = 0;
        handle.writeBytesSync(wavHeader(0, RATE));
        const lead = silence(CHAPTER_LEAD_MS, RATE);
        handle.writeBytesSync(lead);
        ch.pcmBytes = lead.length;
      }
      const conc = engineConcurrency(p.engine, s);
      let next = ch.chunksDone || 0;
      while (next < chunks.length) {
        if (signal.aborted) throw new Error('cancelled');
        say(`Recording “${ch.title}” ${Math.round((next / chunks.length) * 100)}%`);
        const batch = chunks.slice(next, next + conc);
        const audios = await Promise.all(batch.map((parts) => synth(s, p, parts, signal)));
        for (let b = 0; b < audios.length; b++) {
          const body = trimSilence(to24k(audios[b]), RATE);
          const startSec = ch.pcmBytes! / (RATE * 2);
          const sentences = chunkSentences(batch[b]);
          const starts = alignSentences(sentences.map((x) => x.s), body.length / (RATE * 2), findPauses(body, RATE));
          sentences.forEach((x, k) => cues.push({ t: +(startSec + starts[k]).toFixed(2), s: x.s, p: x.p, ...(x.d ? { d: true } : {}) }));
          handle.offset = 44 + ch.pcmBytes!;
          handle.writeBytesSync(body);
          const gap = silence(gapMs(), RATE);
          handle.writeBytesSync(gap);
          ch.pcmBytes! += body.length + gap.length;
          next++;
          ch.chunksDone = next;
        }
        writeText(timingFile, JSON.stringify(cues));
        saveBook(book);
      }
      handle.offset = 0;
      handle.writeBytesSync(wavHeader(ch.pcmBytes!, RATE));
    } finally {
      handle.close();
    }
    const out = chapterAudioFile(book, i);
    if (out.exists) out.delete();
    partial.move(out);
    ch.durationSec = ch.pcmBytes! / (RATE * 2);
    ch.status = 'done';
    ch.error = undefined;
    saveBook(book);
  }
}

/** Progress of a whole book, 0..1 (text prep counts for a little, the voice for the rest). */
export function bookPercent(b: Book): number {
  if (!b.chapters.length) return 0;
  let sum = 0;
  for (const c of b.chapters) {
    if (c.status === 'done') sum += 1;
    else if (c.status === 'speaking') sum += 0.12 + 0.88 * ((c.chunksDone || 0) / Math.max(1, c.chunksTotal || 1));
    else if (c.status === 'scripted') sum += 0.12;
    else if (c.status === 'scripting') sum += 0.04;
  }
  return sum / b.chapters.length;
}

function to24k(a: Audio): Uint8Array {
  const pcm = toPcm(a.bytes, a.mimeType);
  if (pcm.bits !== 16) throw new Error(`Unexpected audio format ${pcm.bits}-bit`);
  let data = pcm.data;
  if (pcm.channels === 2) {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const mono = new Uint8Array(data.length / 2);
    const m = new DataView(mono.buffer);
    for (let i = 0; i < mono.length / 2; i++) m.setInt16(i * 2, (v.getInt16(i * 4, true) + v.getInt16(i * 4 + 2, true)) >> 1, true);
    data = mono;
  }
  return resample16(data, pcm.sampleRate, RATE);
}

export function voiceLabel(s: Settings) {
  return profileLabel(profileFromSettings(s));
}

export function resetChapter(book: Book, i: number, keepScript = true) {
  const ch = book.chapters[i];
  for (const f of [chapterPartialFile(book.id, i), chapterAudioFile(book, i), chapterTimingFile(book.id, i)]) if (f.exists) f.delete();
  if (!keepScript) {
    const sc = chapterScriptFile(book.id, i);
    if (sc.exists) sc.delete();
  }
  Object.assign(ch, { status: 'pending', chunksDone: 0, pcmBytes: 0, chunksTotal: undefined, durationSec: undefined, error: undefined, voiceLabel: undefined });
  saveBook(book);
}

export const converter = new Converter();

export async function previewVoice(s: Settings, text: string, profile?: VoiceProfile): Promise<File> {
  const p = { ...(profile || profileFromSettings(s)), dialogueMode: false };
  const a = await synth(s, p, [{ speaker: 'NARRATOR', text }]);
  return audioToWavFile(a);
}

export async function audioToWavFile(a: Audio): Promise<File> {
  const data = to24k(a);
  const f = new File(Paths.cache, `preview-${Date.now()}.wav`);
  f.create();
  const h = f.open(FileMode.WriteOnly);
  h.writeBytesSync(wavHeader(data.length, RATE));
  h.writeBytesSync(data);
  h.close();
  return f;
}
