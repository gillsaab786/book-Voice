// Read-along timing: where each sentence starts in the chapter audio.
// Gemini TTS doesn't return timestamps, so we align sentences to the natural
// pauses detected in each generated chunk (sentence ends are where speakers breathe).
import { Segment } from './types';

/** One sentence on the read-along page. t = start time (sec), p = paragraph index, d = dialogue. */
export type Cue = { t: number; s: string; p: number; d?: boolean };

export const stripTags = (s: string) => s.replace(/<[^>]{1,20}>/g, ' ').replace(/\|[^|]{0,40}\|/g, ' ').replace(/\s+/g, ' ').trim();

export function splitSentences(text: string): string[] {
  const clean = stripTags(text);
  const parts = clean.match(/[^.!?।॥…]+(?:[.!?।॥…]+["'”’)\]]*|$)\s*/g) || [clean];
  // merge very short fragments ("Mr." etc.) into neighbours
  const out: string[] = [];
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    if (out.length && (p.length < 4 || /\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|etc)\.$/i.test(out[out.length - 1]))) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  return out;
}

/** Sentences of one TTS chunk, keeping paragraph (segment) numbering continuous across the chapter. */
export function chunkSentences(parts: Segment[]): { s: string; p: number; d: boolean }[] {
  const out: { s: string; p: number; d: boolean }[] = [];
  for (const seg of parts) for (const s of splitSentences(seg.text)) out.push({ s, p: seg.i ?? 0, d: seg.speaker === 'DIALOGUE' });
  return out;
}

export type Pause = { t: number; len: number };

/** Gaps between speech in 16-bit mono PCM: centre time and length (sec), relative to chunk start. */
export function findPauses(pcm: Uint8Array, sampleRate: number, minPauseMs = 140): Pause[] {
  const v = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const frame = Math.max(1, Math.round(sampleRate * 0.02));
  const nFrames = Math.floor(pcm.length / 2 / frame);
  if (nFrames < 3) return [];
  const energy = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    let sum = 0;
    const base = f * frame;
    for (let i = 0; i < frame; i += 2) sum += Math.abs(v.getInt16((base + i) * 2, true));
    energy[f] = sum / (frame / 2);
  }
  const sorted = Array.from(energy).sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.8)] || 1;
  const threshold = Math.max(120, loud * 0.1);
  const minFrames = Math.ceil(minPauseMs / 20);
  const pauses: Pause[] = [];
  let runStart = -1;
  for (let f = 0; f <= nFrames; f++) {
    const quiet = f < nFrames && energy[f] < threshold;
    if (quiet && runStart < 0) runStart = f;
    if (!quiet && runStart >= 0) {
      if (f - runStart >= minFrames && runStart > 0 && f < nFrames) pauses.push({ t: ((runStart + f) / 2) * 0.02, len: (f - runStart) * 0.02 });
      runStart = -1;
    }
  }
  return pauses;
}

/**
 * Assign each sentence a start time inside a chunk of `dur` seconds.
 * Dynamic programming picks, in order, the pauses that best match where sentence
 * boundaries should fall, preferring longer pauses (sentence ends) over short ones (commas).
 */
export function alignSentences(sentences: string[], dur: number, pauses: Pause[]): number[] {
  const n = sentences.length;
  if (!n) return [];
  if (n === 1) return [0];
  const w = sentences.map((s) => Math.max(1, s.length));
  const total = w.reduce((a, b) => a + b, 0);
  const B = n - 1;
  const expected: number[] = [];
  let acc = 0;
  for (let j = 0; j < B; j++) {
    acc += w[j];
    expected.push((acc / total) * dur);
  }
  const m = pauses.length;
  const SKIP = 0.05;
  const cost = (j: number, k: number) => 4 * ((pauses[k].t - expected[j]) / Math.max(dur, 1)) ** 2 - Math.min(pauses[k].len, 0.8);
  // f[j][k]: best cost placing first j boundaries using first k pauses
  const f: number[][] = Array.from({ length: B + 1 }, () => new Array(m + 1).fill(Infinity));
  const how: number[][] = Array.from({ length: B + 1 }, () => new Array(m + 1).fill(0));
  for (let k = 0; k <= m; k++) f[0][k] = 0;
  for (let j = 1; j <= B; j++) {
    f[j][0] = j * SKIP;
    how[j][0] = 2;
    for (let k = 1; k <= m; k++) {
      let best = f[j][k - 1];
      let h = 0; // pause k-1 unused
      const a = f[j - 1][k - 1] + cost(j - 1, k - 1);
      if (a < best) { best = a; h = 1; } // boundary j-1 -> pause k-1
      const sk = f[j - 1][k] + SKIP;
      if (sk < best) { best = sk; h = 2; } // boundary j-1 has no pause
      f[j][k] = best;
      how[j][k] = h;
    }
  }
  const assigned: (number | null)[] = new Array(B).fill(null);
  for (let j = B, k = m; j > 0; ) {
    const h = how[j][k];
    if (h === 0) k--;
    else if (h === 1) { assigned[j - 1] = pauses[k - 1].t; j--; k--; }
    else j--;
  }
  // interpolate boundaries without a pause between known neighbours
  const times: number[] = [0];
  for (let j = 0; j < B; j++) {
    if (assigned[j] !== null) { times.push(assigned[j]!); continue; }
    const prevT = times[times.length - 1];
    let nx = j + 1;
    while (nx < B && assigned[nx] === null) nx++;
    const nextT = nx < B ? assigned[nx]! : dur;
    // char weights between prev known boundary and the next one
    let wPrev = 0, wSpan = 0;
    for (let q = j; q <= nx; q++) wSpan += w[q];
    for (let q = j; q <= j; q++) wPrev += w[q];
    times.push(prevT + ((nextT - prevT) * wPrev) / Math.max(1, wSpan));
  }
  for (let i = 1; i < times.length; i++) times[i] = Math.min(dur - 0.05, Math.max(times[i], times[i - 1] + 0.2));
  return times;
}

/** Fallback for chapters recorded before timing existed: spread the script across the duration. */
export function cuesFromScript(segs: Segment[], duration: number, lead = 0.7): Cue[] {
  const items: { s: string; p: number; d: boolean }[] = [];
  segs.forEach((seg, p) => splitSentences(seg.text).forEach((s) => items.push({ s, p, d: seg.speaker === 'DIALOGUE' })));
  const total = items.reduce((a, x) => a + x.s.length + 8, 0) || 1;
  let acc = 0;
  const span = Math.max(1, duration - lead);
  return items.map((x) => {
    const t = lead + (acc / total) * span;
    acc += x.s.length + 8;
    return { t, s: x.s, p: x.p, d: x.d || undefined };
  });
}

/** Index of the cue playing at time t (binary search). */
export function cueAt(cues: Cue[], t: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Which word of the sentence is being spoken (proportional to word length). */
export function wordAt(sentence: string, start: number, end: number, t: number): number {
  const words = sentence.split(' ');
  if (end <= start) return 0;
  const frac = Math.min(0.999, Math.max(0, (t - start) / (end - start)));
  const total = words.reduce((a, w) => a + w.length + 1, 0);
  let acc = 0;
  for (let i = 0; i < words.length; i++) {
    acc += words[i].length + 1;
    if (acc / total > frac) return i;
  }
  return words.length - 1;
}
