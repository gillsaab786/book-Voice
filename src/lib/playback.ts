import { AudioPlaylist, AudioPlaylistStatus, createAudioPlaylist, setAudioModeAsync } from 'expo-audio';
import { chapterAudioFile, loadBook, loadSettings, onBookSaved, saveBook, saveSettings } from './storage';
import { Book } from './types';

export const SKIP_SEC = 40;

/** Sleep timer: stop after N minutes, after N chapters (1 = end of this chapter), or at the end of the book. */
export type SleepMode = { kind: 'minutes'; n: number } | { kind: 'chapters'; n: number } | { kind: 'book' } | null;
const FADE_SEC = 30;

export type PlayState = {
  book?: Book;
  chapter: number;
  playing: boolean;
  time: number;
  duration: number;
  rate: number;
  sleepLabel?: string;
};

/**
 * One app-wide playlist (one track per recorded chapter) so that:
 *  - audio keeps going in the background and auto-advances chapters,
 *  - lock screen / headphones / Siri ("skip back 40 seconds", "next track") work natively,
 *  - your exact place is saved and restored after the app is closed.
 */
class Playback {
  private pl: AudioPlaylist | null = null;
  private map: number[] = []; // playlist index -> chapter index
  private listeners = new Set<(s: PlayState) => void>();
  private pendingSeek: number | null = null;
  private lastSave = 0;
  private sleepTick: ReturnType<typeof setInterval> | null = null;
  private sleepEndsAt = 0; // ms timestamp for minute mode
  private chaptersLeft = 0; // chapter mode
  private sleepMode: SleepMode = null;
  private modeSet = false;
  state: PlayState = { chapter: -1, playing: false, time: 0, duration: 0, rate: 1 };

  constructor() {
    // newly finished chapters join the queue while you listen
    onBookSaved((b) => {
      if (!this.pl || b.id !== this.state.book?.id) return;
      const last = this.map[this.map.length - 1] ?? -1;
      for (let i = last + 1; i < b.chapters.length; i++) {
        if (b.chapters[i].status !== 'done') break;
        const f = chapterAudioFile(b, i);
        if (!f.exists) break;
        this.pl.add({ uri: f.uri });
        this.map.push(i);
      }
    });
  }

  subscribe(fn: (s: PlayState) => void) {
    this.listeners.add(fn);
    fn(this.state);
    return () => void this.listeners.delete(fn);
  }
  private emit(p: Partial<PlayState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l(this.state));
  }

  private async load(bookId: string, chapter: number, time: number, autoplay: boolean) {
    if (!this.modeSet) {
      this.modeSet = true;
      await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => {});
      this.state.rate = (await loadSettings()).playbackRate || 1;
    }
    const book = await loadBook(bookId);
    const map: number[] = [];
    const sources: { uri: string }[] = [];
    book.chapters.forEach((c, i) => {
      const f = chapterAudioFile(book, i);
      if (c.status === 'done' && f.exists) {
        map.push(i);
        sources.push({ uri: f.uri });
      }
    });
    const idx = map.indexOf(chapter);
    if (idx < 0) throw new Error('This chapter has no audio yet');

    if (this.pl) {
      try {
        this.pl.clearLockScreenControls();
        this.pl.destroy();
      } catch {}
    }
    const pl = createAudioPlaylist({ sources, updateInterval: 250, loop: 'none' });
    this.pl = pl;
    this.map = map;
    pl.addListener('playlistStatusUpdate', (st) => this.onStatus(st));
    pl.addListener('trackChanged', (e) => this.onTrack(e.currentIndex, e.previousIndex));
    if (idx > 0) pl.skipTo(idx);
    this.pendingSeek = time > 1 ? time : null;
    pl.playbackRate = this.state.rate;
    try {
      pl.setActiveForLockScreen(true, this.meta(book, chapter), {
        showSeekBackward: true,
        seekBackwardIntervalSeconds: SKIP_SEC,
        showSeekForward: true,
        seekForwardIntervalSeconds: SKIP_SEC,
        showNextTrack: true, // replaces the forward button on iOS; Siri "next track" = next chapter
        showPreviousTrack: false, // keep the 40 s rewind button on the lock screen
      });
    } catch {}
    if (autoplay) pl.play();
    this.emit({ book, chapter, playing: autoplay, time, duration: book.chapters[chapter].durationSec || 0 });
    const s = await loadSettings();
    if (s.lastBookId !== bookId) await saveSettings({ ...s, lastBookId: bookId });
  }

  private meta(book: Book, chapter: number) {
    return { title: book.chapters[chapter]?.title, artist: book.title, albumTitle: book.author };
  }

  /** Play a chapter (resumes from your saved spot in that chapter unless startAt is given). */
  async open(bookId: string, chapter: number, startAt?: number) {
    const book = await loadBook(bookId);
    const resume = startAt ?? (book.position?.chapter === chapter ? book.position.time : 0);
    await this.load(bookId, chapter, resume, true);
  }

  /** Continue a book from where you left it. */
  async resumeBook(bookId: string, autoplay = true) {
    const book = await loadBook(bookId);
    let ch = book.position?.chapter ?? book.chapters.findIndex((c) => c.status === 'done');
    if (ch < 0 || !chapterAudioFile(book, ch).exists) ch = book.chapters.findIndex((c) => c.status === 'done');
    if (ch < 0) throw new Error('No chapters recorded yet');
    await this.load(bookId, ch, book.position?.chapter === ch ? book.position.time : 0, autoplay);
  }

  /** On app start: put the last book back exactly where you left it (paused). */
  async restore() {
    if (this.pl) return;
    const s = await loadSettings();
    if (!s.lastBookId) return;
    try {
      await this.resumeBook(s.lastBookId, false);
    } catch {}
  }

  play() {
    this.pl?.play();
  }
  pause() {
    this.pl?.pause();
    void this.savePosition();
  }
  toggle() {
    if (!this.pl) return;
    this.state.playing ? this.pause() : this.play();
  }

  async seekBy(sec: number) {
    if (!this.pl) return;
    const t = this.state.time + sec;
    if (t < 0 && sec < 0 && this.map.indexOf(this.state.chapter) > 0) {
      // rewinding past the start goes back into the previous chapter, like a real audiobook
      const prevIdx = this.map.indexOf(this.state.chapter) - 1;
      const prevCh = this.map[prevIdx];
      const prevDur = this.state.book?.chapters[prevCh]?.durationSec || 0;
      this.pendingSeek = Math.max(0, prevDur + t);
      this.pl.skipTo(prevIdx);
      return;
    }
    await this.pl.seekTo(Math.max(0, Math.min(this.state.duration - 0.5, t)));
    this.emit({ time: Math.max(0, t) });
  }
  async seekTo(sec: number) {
    await this.pl?.seekTo(Math.max(0, sec));
    this.emit({ time: sec });
  }

  async setRate(rate: number) {
    if (this.pl) this.pl.playbackRate = rate;
    this.emit({ rate });
    const s = await loadSettings();
    await saveSettings({ ...s, playbackRate: rate });
  }

  next(dir = 1) {
    if (!this.pl) return;
    const idx = this.map.indexOf(this.state.chapter) + dir;
    if (idx < 0 || idx >= this.map.length) return;
    this.pendingSeek = null;
    this.pl.skipTo(idx);
  }

  setSleep(mode: SleepMode) {
    if (this.sleepTick) clearInterval(this.sleepTick);
    this.sleepTick = null;
    this.sleepMode = mode;
    if (this.pl) this.pl.volume = 1;
    if (mode?.kind === 'minutes') {
      this.sleepEndsAt = Date.now() + mode.n * 60e3;
      // gentle fade over the last 30 s, then stop — like falling asleep to someone reading
      this.sleepTick = setInterval(() => this.minuteTick(), 1000);
    } else if (mode?.kind === 'chapters') {
      this.chaptersLeft = mode.n;
    }
    this.updateSleepLabel();
  }

  private minuteTick() {
    if (!this.state.playing) {
      // paused: push the deadline back so the timer only counts listening time
      this.sleepEndsAt += 1000;
      return;
    }
    const left = (this.sleepEndsAt - Date.now()) / 1000;
    if (left <= 0) return this.sleepNow();
    if (this.pl) this.pl.volume = left < FADE_SEC ? Math.max(0.05, left / FADE_SEC) : 1;
    if (Math.round(left) % 15 === 0) this.updateSleepLabel();
  }

  private sleepNow() {
    if (this.sleepTick) clearInterval(this.sleepTick);
    this.sleepTick = null;
    this.sleepMode = null;
    this.pl?.pause();
    if (this.pl) this.pl.volume = 1;
    // rewind a little so you pick up from something you remember hearing
    void this.seekBy(-20);
    this.emit({ sleepLabel: undefined, playing: false });
    void this.savePosition();
  }

  private updateSleepLabel() {
    const m = this.sleepMode;
    let label: string | undefined;
    if (m?.kind === 'minutes') label = `${Math.max(1, Math.ceil((this.sleepEndsAt - Date.now()) / 60e3))} min left`;
    else if (m?.kind === 'chapters') label = this.chaptersLeft === 1 ? 'End of chapter' : `${this.chaptersLeft} chapters left`;
    else if (m?.kind === 'book') label = 'End of book';
    this.emit({ sleepLabel: label });
  }

  get sleep(): SleepMode {
    return this.sleepMode;
  }

  async savePosition() {
    const b = this.state.book;
    if (!b || this.state.chapter < 0) return;
    this.lastSave = Date.now();
    try {
      const fresh = await loadBook(b.id);
      fresh.position = { chapter: this.state.chapter, time: Math.max(0, this.state.time - 2) };
      saveBook(fresh);
    } catch {}
  }

  private onTrack(currentIndex: number, previousIndex: number) {
    const chapter = this.map[currentIndex];
    if (chapter === undefined || !this.state.book) return;
    if (this.sleepMode?.kind === 'chapters' && currentIndex === previousIndex + 1) {
      this.chaptersLeft--;
      if (this.chaptersLeft <= 0) {
        // stop at the very start of the next chapter, so tomorrow begins cleanly
        this.sleepMode = null;
        this.pl?.pause();
        this.pendingSeek = null;
        void this.pl?.seekTo(0);
        this.emit({ sleepLabel: undefined, playing: false });
      } else this.updateSleepLabel();
    }
    try {
      this.pl?.updateLockScreenMetadata(this.meta(this.state.book, chapter));
    } catch {}
    this.emit({ chapter, time: this.pendingSeek ?? 0, duration: this.state.book.chapters[chapter]?.durationSec || 0 });
    void this.savePosition();
  }

  private onStatus(st: AudioPlaylistStatus) {
    if (this.pendingSeek !== null && st.isLoaded && st.duration > 0) {
      const t = this.pendingSeek;
      this.pendingSeek = null;
      void this.pl?.seekTo(t);
      this.emit({ time: t });
      return;
    }
    const chapter = this.map[st.currentIndex] ?? this.state.chapter;
    this.emit({ playing: st.playing, time: st.currentTime, duration: st.duration || this.state.duration, chapter });
    if (Date.now() - this.lastSave > 5000 && st.playing) void this.savePosition();
    if (st.didJustFinish && st.currentIndex === this.map.length - 1) {
      // end of everything recorded so far (also the "End of book" sleep option)
      if (this.sleepMode?.kind === 'book' || this.sleepMode?.kind === 'chapters') this.setSleep(null);
      this.emit({ playing: false });
      void this.savePosition();
    }
  }
}

export const playback = new Playback();
