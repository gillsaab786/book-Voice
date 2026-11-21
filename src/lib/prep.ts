// Turning chapter text into a narration script, spread across all AI keys in parallel.
import { extractJson, poolChat, poolSize } from './ai';
import { segmentsFromPlain } from './chunking';
import { DailyLimitError } from './errors';
import { NARRATION_SYSTEM, scriptFromText, STORYTELLER_SYSTEM } from './gemini';
import { splitText } from './parsers';
import { getKey } from './storage';
import { Segment } from './types';

const JSON_RULES = `

Answer with ONLY a JSON object, no other text, in exactly this shape:
{"segments":[{"speaker":"NARRATOR","style":"calm, measured","text":"..."},{"speaker":"DIALOGUE","style":"excited","text":"..."}]}`;

const letters = (t: string) => t.replace(/<[^>]{1,20}>/g, '').replace(/[^\p{L}\p{N}]/gu, '').length;

/** A script is only accepted if it kept (nearly) all of the text — weaker models sometimes summarise. */
function keptEnough(input: string, segs: Segment[], mode: 'faithful' | 'storyteller') {
  const a = letters(input);
  const b = letters(segs.map((s) => s.text).join(' '));
  if (a < 200) return b > 0;
  const r = b / a;
  return r >= (mode === 'faithful' ? 0.78 : 0.62) && r <= 2.2;
}

function clean(segs: any[] | undefined): Segment[] {
  return (segs || [])
    .map((s) => ({ speaker: s?.speaker === 'DIALOGUE' ? 'DIALOGUE' : 'NARRATOR', style: String(s?.style || '').trim() || undefined, text: String(s?.text || '').trim() } as Segment))
    .filter((s) => s.text);
}

async function adaptPiece(piece: string, mode: 'faithful' | 'storyteller', textModel: string, signal?: AbortSignal): Promise<Segment[]> {
  const system = (mode === 'storyteller' ? STORYTELLER_SYSTEM : NARRATION_SYSTEM) + JSON_RULES;
  const tried = new Set<string>();
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await poolChat(system, 'Convert this book text into the narration script:\n\n' + piece, { signal, exclude: tried, maxTokens: 12000 });
    if (!r) break; // no other keys free/usable
    tried.add(r.keyId);
    const j = extractJson<{ segments: any[] }>(r.text);
    const segs = clean(j?.segments);
    if (segs.length && keptEnough(piece, segs, mode)) return segs;
  }
  // Gemini as the backstop for this piece
  const gKey = await getKey('gemini');
  if (gKey) {
    try {
      const segs = await scriptFromText(gKey, textModel, piece, signal, mode);
      if (segs.length && keptEnough(piece, segs, mode)) return segs;
    } catch (e: any) {
      if (e?.message === 'cancelled') throw e;
      if (!(e instanceof DailyLimitError) && e?.message !== 'MAX_TOKENS') console.warn('gemini prep failed', e?.message);
    }
  }
  // Never stall the book: read the text as written.
  return segmentsFromPlain(piece);
}

/** Adapt a whole chapter. Pieces go to different AI keys at the same time. */
export async function adaptChapter(
  title: string, text: string, mode: 'faithful' | 'storyteller', textModel: string,
  onPiece: (done: number, total: number) => void, signal?: AbortSignal
): Promise<Segment[]> {
  const pool = await poolSize();
  const size = pool > 0 ? 6000 : 18000; // small pieces spread well across free keys
  const pieces = splitText(text, size).map((p, k) => (k === 0 ? `${title}\n\n${p}` : p));
  let done = 0;
  const results = await Promise.all(
    pieces.map(async (p) => {
      const segs = await adaptPiece(p, mode, textModel, signal);
      onPiece(++done, pieces.length);
      return segs;
    })
  );
  return results.flat();
}
