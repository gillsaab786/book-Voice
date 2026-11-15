import { File, UploadType } from 'expo-file-system';
import { base64ToBytes, sleep } from './bytes';
import { Segment, Settings, VoiceChoice } from './types';

const BASE = 'https://generativelanguage.googleapis.com';

export class ApiError extends Error {
  constructor(public status: number, message: string, public retryAfterMs?: number) {
    super(message);
  }
}

function parseRetry(body: any): number | undefined {
  const d = body?.error?.details?.find?.((x: any) => String(x['@type'] || '').includes('RetryInfo'));
  const m = /([\d.]+)s/.exec(d?.retryDelay || '');
  return m ? Math.ceil(Number(m[1]) * 1000) : undefined;
}

/** POST JSON with retries for 429 / 5xx / network failures. */
async function post(path: string, key: string, body: unknown, signal?: AbortSignal, tries = 7): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (signal?.aborted) throw new Error('cancelled');
    try {
      const res = await fetch(BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal,
      });
      const text = await res.text();
      let json: any = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {}
      if (res.ok) return json;
      const msg = json?.error?.message || `HTTP ${res.status}`;
      if (res.status === 429 || res.status >= 500) {
        lastErr = new ApiError(res.status, msg, parseRetry(json));
      } else {
        throw new ApiError(res.status, msg); // 400/401/403/404: don't retry
      }
    } catch (e: any) {
      if (e instanceof ApiError && e.status < 500 && e.status !== 429) throw e;
      if (signal?.aborted || e?.name === 'AbortError') throw new Error('cancelled');
      lastErr = e;
    }
    const wait = (lastErr as ApiError)?.retryAfterMs ?? Math.min(60000, 2000 * 2 ** attempt) + Math.random() * 1000;
    await sleep(wait);
  }
  throw lastErr;
}

// ---------------------------------------------------------------- text models

type Part = { text: string } | { fileData: { mimeType: string; fileUri: string } };

export async function generateJson<T>(opts: {
  key: string;
  model: string;
  system: string;
  parts: Part[];
  schema: object;
  signal?: AbortSignal;
}): Promise<T> {
  const json = await post(`/v1beta/models/${opts.model}:generateContent`, opts.key, {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: 'user', parts: opts.parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: opts.schema, maxOutputTokens: 65536 },
  }, opts.signal);
  const cand = json.candidates?.[0];
  const text = (cand?.content?.parts || []).filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join('');
  if (!text) throw new Error(`Gemini returned no text (${cand?.finishReason || json.promptFeedback?.blockReason || 'unknown'})`);
  try {
    return JSON.parse(text);
  } catch {
    if (cand?.finishReason === 'MAX_TOKENS') throw new Error('MAX_TOKENS');
    throw new Error('Gemini returned malformed JSON');
  }
}

// ---------------------------------------------------------------- files API (PDFs)

export async function uploadFile(key: string, file: File, mimeType: string, displayName: string) {
  const size = file.size || 0;
  const start = await fetch(`${BASE}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': key,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(size),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName.slice(0, 100) } }),
  });
  if (!start.ok) throw new ApiError(start.status, 'Upload start failed: ' + (await start.text()).slice(0, 200));
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Upload URL missing');
  const res = await file.upload(uploadUrl, {
    httpMethod: 'POST',
    uploadType: UploadType.BINARY_CONTENT,
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize', 'Content-Length': String(size) },
  });
  if (res.status < 200 || res.status >= 300) throw new ApiError(res.status, 'Upload failed: ' + res.body.slice(0, 200));
  const info = JSON.parse(res.body).file;
  // wait until processed
  for (let i = 0; i < 60 && info.state === 'PROCESSING'; i++) {
    await sleep(2000);
    const r = await fetch(`${BASE}/v1beta/${info.name}`, { headers: { 'x-goog-api-key': key } });
    Object.assign(info, await r.json());
  }
  if (info.state === 'FAILED') throw new Error('Gemini could not process this file');
  return { uri: info.uri as string, mimeType, expiresAt: Date.parse(info.expirationTime) || Date.now() + 47 * 3600e3 };
}

// ---------------------------------------------------------------- narration prep

const SEGMENT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    segments: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          speaker: { type: 'STRING', enum: ['NARRATOR', 'DIALOGUE'] },
          style: { type: 'STRING' },
          text: { type: 'STRING' },
        },
        required: ['speaker', 'text'],
      },
    },
  },
  required: ['segments'],
};

export const NARRATION_SYSTEM = `You are an expert audiobook script editor. You turn book text into a script a skilled narrator reads aloud, so the listener hears it the way a person would naturally tell it.

Hard rules:
- Keep the author's words and meaning. Never summarise, skip, reorder or add commentary. Keep the original language (do not translate).
- Remove things that only make sense on paper: page numbers, running headers/footers, hyphenation breaks, footnote/endnote reference numbers, "continued on next page", URLs (say "a web link" if needed).
- Rewrite for the ear only where needed: expand abbreviations and symbols the way a narrator would say them ("Dr." -> "Doctor", "e.g." -> "for example", "$5" -> "five dollars", "Fig. 3" -> "figure three", "1990s" stays). Read chapter headings once, cleanly.
- Tables, figures, code or formulas: give one or two spoken sentences describing what they show instead of reading cell by cell.
- Bulleted lists become natural spoken sentences.
- Fold an essential footnote in as "Note: ..." at the end of its paragraph; drop purely bibliographic ones.

Performance:
- Split into segments in reading order. speaker = DIALOGUE only for the words a character actually says aloud (the quoted words themselves, without quote marks); everything else, including "he said", is NARRATOR.
- style = a short delivery direction (2-6 words) matching the moment, e.g. "calm, measured", "tense whisper", "angry, shouting", "tender, quiet". Vary it with the scene.
- You may add sparse vocal cues inside text where the book clearly implies them: <short pause>, <long pause>, <sigh>, <laugh>, <breath>, <gasp>. Use a <long pause> at scene breaks. Never overuse.
- CAPITALISE a word only when the book stresses it (italics/emphasis).`;

type Narration = 'faithful' | 'storyteller';

export const STORYTELLER_SYSTEM = `You are a gifted human storyteller preparing to TELL this book aloud to one listener you care about, the way a person tells a story they know well, not the way a machine reads a page.

What must stay: every event, every character, every important detail, every line of dialogue (dialogue stays word-for-word), and the order of the story. Never summarise away content, never skip a scene, never add plot or facts that aren't in the book. Keep the book's language (do not translate); for Punjabi or Hindi, use natural everyday spoken style.

What you may change, so it sounds like a real person telling it:
- Turn long, written, complicated sentences into natural spoken sentences. Split very long sentences; use the rhythm of speech.
- Use natural spoken connectors where they help: "And then…", "Now, here's the thing…", "But listen…", "So…", "And you know what?". Use them sparingly — a few per page, never every paragraph.
- Occasionally (rarely) address the listener warmly at big moments: "Imagine that…", "Can you believe it?" — at most once or twice a chapter.
- Remove page clutter: page numbers, headers, footnote markers, URLs, citations. Describe tables or figures in a sentence. Spell out abbreviations and symbols as spoken.
- Read chapter headings once, naturally ("Chapter three. The storm.").

Performance:
- Split into segments in reading order. speaker = DIALOGUE only for the exact words a character says aloud (without quote marks); everything else is NARRATOR.
- style = a short, human delivery note (2-6 words) for each segment that follows the emotion: "smiling, playful", "hushed, tense", "heartbroken, slow", "excited, faster", "teasing", "gentle, reassuring". Vary it like a real storyteller would.
- Add real human vocal moments where a storyteller naturally would: <breath> before an important line, <short pause> for effect, <long pause> at scene changes, <laugh> at something funny, <sigh> at sadness, <gasp> at a shock. Natural, not constant — roughly one cue every few sentences.
- CAPITALISE a word only for genuine spoken emphasis.`;

function systemFor(mode: Narration) {
  return mode === 'storyteller' ? STORYTELLER_SYSTEM : NARRATION_SYSTEM;
}

export async function scriptFromText(key: string, model: string, text: string, signal?: AbortSignal, mode: Narration = 'faithful'): Promise<Segment[]> {
  const r = await generateJson<{ segments: Segment[] }>({
    key, model, system: systemFor(mode), schema: SEGMENT_SCHEMA, signal,
    parts: [{ text: 'Convert this book text into the narration script:\n\n' + text }],
  });
  return clean(r.segments);
}

export async function scriptFromPdf(
  key: string, model: string, file: { uri: string; mimeType: string }, pages: [number, number], title: string, signal?: AbortSignal, mode: Narration = 'faithful'
): Promise<Segment[]> {
  const r = await generateJson<{ segments: Segment[] }>({
    key, model, system: systemFor(mode), schema: SEGMENT_SCHEMA, signal,
    parts: [
      { fileData: { mimeType: file.mimeType, fileUri: file.uri } },
      {
        text: `Convert ONLY PDF pages ${pages[0]} to ${pages[1]} (physical page numbers where 1 = first page of the file) into the narration script. This is the section "${title}".
If page ${pages[0]} starts mid-sentence, skip that fragment (it belongs to the previous section). If the last sentence runs past page ${pages[1]}, finish that sentence. Read the text in its natural reading order (handle columns, sidebars and captions sensibly).`,
      },
    ],
  });
  return clean(r.segments);
}

export type PdfOutline = { title?: string; author?: string; totalPages: number; sections: { title: string; startPage: number; endPage: number }[] };

export async function pdfOutline(key: string, model: string, file: { uri: string; mimeType: string }): Promise<PdfOutline> {
  return generateJson<PdfOutline>({
    key, model,
    system: 'You analyse book PDFs and return their reading structure as JSON. Page numbers are physical PDF pages (1 = first page of the file), not printed page labels.',
    parts: [
      { fileData: { mimeType: file.mimeType, fileUri: file.uri } },
      {
        text: `Return the book's title, author, total page count, and the list of sections in reading order that a listener would want narrated: front-matter worth reading (foreword, introduction), every chapter, and afterword. Skip cover, copyright page, table of contents, index, and blank pages. Sections must not overlap. Split any section longer than 14 pages into consecutive parts titled like "Chapter 3 (part 2)". If the PDF has no clear chapters, make sections of about 10 pages titled "Pages X–Y".`,
      },
    ],
    schema: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        author: { type: 'STRING' },
        totalPages: { type: 'INTEGER' },
        sections: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { title: { type: 'STRING' }, startPage: { type: 'INTEGER' }, endPage: { type: 'INTEGER' } },
            required: ['title', 'startPage', 'endPage'],
          },
        },
      },
      required: ['totalPages', 'sections'],
    },
  });
}

function clean(segs: Segment[] | undefined): Segment[] {
  return (segs || [])
    .map((s) => ({ speaker: s.speaker === 'DIALOGUE' ? 'DIALOGUE' : 'NARRATOR', style: s.style?.trim() || undefined, text: (s.text || '').trim() } as Segment))
    .filter((s) => s.text);
}

// ---------------------------------------------------------------- speech

export type Audio = { bytes: Uint8Array; mimeType?: string };

/** Added to every request so delivery sounds like a real person, not a reader. */
export const HUMAN_TOUCH =
  'sound completely human: a real person telling a story to one listener, natural breathing, varied pace, tiny pauses to think, warmth and smiles in the voice, never robotic or announcer-like';

function voiceConfig(v: VoiceChoice) {
  return v.prebuilt ? { prebuiltVoiceConfig: { voiceName: v.id } } : { voice: v.id };
}

/** One TTS request. `parts` are spoken in order; with dialogue voices each part carries its speaker. */
export async function speak(opts: {
  key: string;
  settings: Settings;
  parts: Segment[];
  signal?: AbortSignal;
}): Promise<Audio> {
  const { settings: s } = opts;
  const speakers = new Set(opts.parts.map((p) => p.speaker));
  const dual = s.dialogueMode && s.voice.prebuilt && s.dialogueVoice.prebuilt && speakers.size > 1;

  let parts: any[];
  let speechConfig: any;
  if (dual) {
    parts = opts.parts.map((p) => ({
      text: p.text,
      speech_metadata: { speaker: p.speaker === 'DIALOGUE' ? 'Character' : 'Narrator', style: `${p.style || s.style}; ${HUMAN_TOUCH}` },
    }));
    speechConfig = {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: [
          { speaker: 'Narrator', voiceConfig: voiceConfig(s.voice) },
          { speaker: 'Character', voiceConfig: voiceConfig(s.dialogueVoice) },
        ],
      },
    };
  } else {
    const onlyDialogue = s.dialogueMode && speakers.size === 1 && speakers.has('DIALOGUE');
    const voice = onlyDialogue ? s.dialogueVoice : s.voice;
    // Keep the scene's mood: use the most common segment style, anchored by the user's base style.
    const moods = opts.parts.map((p) => p.style).filter(Boolean) as string[];
    const mood = moods.sort((a, b) => moods.filter((x) => x === b).length - moods.filter((x) => x === a).length)[0];
    parts = [
      {
        text: opts.parts.map((p) => (p.speaker === 'DIALOGUE' && !onlyDialogue ? `“${p.text}”` : p.text)).join(' '),
        speech_metadata: { style: `${s.style}; ${mood ? `this passage: ${mood}; ` : ''}${HUMAN_TOUCH}` },
      },
    ];
    speechConfig = { voiceConfig: voiceConfig(voice) };
  }
  if (s.languageCode) speechConfig.languageCode = s.languageCode;

  const json = await post(`/v1beta/models/${s.ttsModel}:generateContent`, opts.key, {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig },
  }, opts.signal);
  const part = json.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data);
  if (!part) throw new Error(`No audio returned (${json.candidates?.[0]?.finishReason || json.promptFeedback?.blockReason || 'unknown'})`);
  return { bytes: base64ToBytes(part.inlineData.data), mimeType: part.inlineData.mimeType };
}

// ---------------------------------------------------------------- voice design

export type DesignedVoice = { id: string; label: string; description: string; createdAt: number };

/** Create a brand-new voice from a plain-language description (stored in your Gemini project). */
export async function designVoice(
  key: string,
  opts: { description: string; name: string; gender?: string; languageCode?: string }
): Promise<{ voice: DesignedVoice; sample?: Audio }> {
  const input = `${opts.description.trim()} The voice must sound like a real, specific human being: natural breath, subtle imperfections, organic warmth and micro-variation in pitch, never synthetic or overly polished.`;
  const voice: any = { type: 'VOICE_TYPE_PROMPTED', prompted: { input }, displayName: opts.name.slice(0, 60) };
  if (opts.gender) voice.gender = opts.gender;
  if (opts.languageCode) voice.languageCode = opts.languageCode;
  const json = await createVoice(key, voice);
  const v = json.voice || json;
  const id: string = (v.id || v.voiceId || v.name || '').replace(/^voices\//, '');
  if (!id) throw new Error('Gemini did not return a voice ID');
  const sa = json.sample_audio || json.sampleAudio || v.sample_audio || v.sampleAudio;
  return {
    voice: { id, label: opts.name, description: opts.description, createdAt: Date.now() },
    sample: sa?.data ? { bytes: base64ToBytes(sa.data), mimeType: sa.mime_type || sa.mimeType } : undefined,
  };
}

/** POST /v1beta/voices. Tries the nested shape first, then the flat shape used by the Cloud docs. */
async function createVoice(key: string, voice: Record<string, unknown>): Promise<any> {
  try {
    return await post('/v1beta/voices', key, { store: true, voice }, undefined, 4);
  } catch (e: any) {
    if (e instanceof ApiError && e.status === 400 && /unknown name|invalid json|cannot find field/i.test(e.message)) {
      return post('/v1beta/voices', key, { store: true, ...voice }, undefined, 4);
    }
    throw e;
  }
}

/**
 * Copy a real person's voice — only with their spoken consent. Google checks that the consent
 * recording is the same speaker reading the consent statement; otherwise it refuses.
 */
export async function replicateVoice(
  key: string,
  opts: { name: string; sampleWavB64: string; consentWavB64: string }
): Promise<DesignedVoice> {
  const json = await createVoice(key, {
    type: 'VOICE_TYPE_REPLICATED',
    displayName: opts.name.slice(0, 60),
    sourceAudio: { mimeType: 'audio/wav', data: opts.sampleWavB64 },
    consentAudio: { mimeType: 'audio/wav', data: opts.consentWavB64 },
  });
  const v = json.voice || json;
  const id: string = (v.id || v.voiceId || v.name || '').replace(/^voices\//, '');
  if (!id) throw new Error('Gemini did not return a voice ID');
  return { id, label: opts.name, description: 'Voice copied with consent', createdAt: Date.now() };
}

export async function deleteDesignedVoice(key: string, id: string) {
  await fetch(`${BASE}/v1beta/voices/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'x-goog-api-key': key } }).catch(() => {});
}

// ---------------------------------------------------------------- voice library

export type LibraryVoice = { id: string; label: string; detail: string };

export async function searchVoices(key: string, q: { language?: string; gender?: string; search?: string; context?: string }): Promise<LibraryVoice[]> {
  const params = new URLSearchParams({ page_size: '100' });
  if (q.language) params.set('language_code', q.language);
  if (q.gender) params.set('gender', q.gender);
  if (q.search) params.set('search', q.search);
  if (q.context) params.set('context', q.context);
  const res = await fetch(`${BASE}/v1beta/voices?${params}`, { headers: { 'x-goog-api-key': key } });
  const json = await res.json();
  if (!res.ok) throw new ApiError(res.status, json?.error?.message || 'Voice search failed');
  const list: any[] = json.voices || json.items || [];
  return list.map((v) => {
    const rawId: string = v.voice || v.voiceId || v.voice_id || v.name || v.id || '';
    const id = rawId.replace(/^voices\//, '');
    const label = v.displayName || v.display_name || v.title || id;
    const detail = [v.gender, v.accent, v.persona, (v.languageCodes || v.language_codes || [])[0], v.description]
      .filter(Boolean)
      .join(' · ');
    return { id, label, detail };
  }).filter((v) => v.id);
}
