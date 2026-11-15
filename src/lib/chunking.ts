import { splitText } from './parsers';
import { Segment } from './types';

/** Plain paragraphs -> NARRATOR segments (used when "adapt text with Gemini" is off). */
export function segmentsFromPlain(text: string): Segment[] {
  return text
    .split(/\n{2,}/)
    .map((t) => t.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .map((t) => ({ speaker: 'NARRATOR', text: t }));
}

/**
 * Group segments into TTS requests of at most `max` characters.
 * Long segments are split at sentence boundaries; order is preserved.
 */
export function chunkSegments(segs: Segment[], max: number): Segment[][] {
  const out: Segment[][] = [];
  let cur: Segment[] = [];
  let len = 0;
  const flush = () => {
    if (cur.length) out.push(cur);
    cur = [];
    len = 0;
  };
  segs.forEach((seg, segIndex) => {
    const pieces = seg.text.length > max ? splitText(seg.text, max) : [seg.text];
    for (const text of pieces) {
      if (len + text.length > max) flush();
      cur.push({ ...seg, text, i: segIndex });
      len += text.length + 1;
    }
    // a scene break is a natural place to start a fresh request
    if (/<long pause>\s*$/.test(seg.text) && len > max * 0.5) flush();
  });
  flush();
  return out;
}

/** Text chunks for the Gemini script pass (keeps output comfortably within limits). */
export const PREP_CHARS = 18000;
