// All the services that can speak a book, behind one interface.
import { File, Paths } from 'expo-file-system';
import { synthesizeToFile } from '../../modules/bookvoice-native/src';
import { countUse } from './ai';
import { sleep } from './bytes';
import { elevenSpeak } from './elevenlabs';
import { DailyLimitError } from './errors';
import { Audio, speak } from './gemini';
import { getKey } from './storage';
import { Engine, Segment, Settings, VoiceProfile } from './types';

export const ENGINE_NAMES: Record<Engine, string> = {
  gemini: 'Gemini voices',
  device: 'Phone voices',
  azure: 'Microsoft Azure voices',
  elevenlabs: 'ElevenLabs',
};

export function profileFromSettings(s: Settings): VoiceProfile {
  const engine = s.engine || (s.provider === 'elevenlabs' ? 'elevenlabs' : 'gemini');
  const voice =
    engine === 'device' ? s.deviceVoice
    : engine === 'azure' ? s.azureVoice
    : engine === 'elevenlabs' ? { id: s.elevenVoiceId, label: `ElevenLabs ${s.elevenVoiceId}`, prebuilt: false }
    : s.voice;
  return {
    engine, voice,
    dialogueMode: engine === 'gemini' && s.dialogueMode,
    dialogueVoice: s.dialogueVoice,
    style: s.style, languageCode: s.languageCode, narration: s.narration, adaptText: s.adaptText, rate: s.speechRate || 1,
  };
}

/** Settings with a book's voice profile applied (what the speech functions read). */
export function effective(s: Settings, p: VoiceProfile): Settings {
  return {
    ...s,
    provider: p.engine === 'elevenlabs' ? 'elevenlabs' : 'gemini',
    voice: p.engine === 'gemini' ? p.voice : s.voice,
    elevenVoiceId: p.engine === 'elevenlabs' ? p.voice.id : s.elevenVoiceId,
    dialogueMode: p.dialogueMode,
    dialogueVoice: p.dialogueVoice,
    style: p.style,
    languageCode: p.languageCode,
    narration: p.narration,
    adaptText: p.adaptText,
    speechRate: p.rate,
  };
}

export function profileLabel(p: VoiceProfile): string {
  const v = p.voice.label || p.voice.id || 'default voice';
  if (p.engine === 'gemini') return v + (p.dialogueMode ? ` + ${p.dialogueVoice.label}` : '') + ` · ${p.style.slice(0, 32)}`;
  return `${v} · ${ENGINE_NAMES[p.engine]}`;
}

/** Requests in flight at once for one book. */
export function engineConcurrency(e: Engine, s: Settings) {
  return e === 'gemini' ? Math.max(1, Math.min(4, s.concurrency)) : e === 'device' ? 1 : 2;
}

export function chunkCharsFor(e: Engine, s: Settings) {
  return e === 'device' ? 1500 : e === 'azure' ? 2500 : e === 'elevenlabs' ? Math.min(s.chunkChars, 2400) : s.chunkChars;
}

/** Why an engine can't run yet (missing key etc.), or null when ready. */
export async function engineProblem(e: Engine, s: Settings): Promise<string | null> {
  if (e === 'gemini' && !(await getKey('gemini'))) return 'Add your Gemini key in Settings';
  if (e === 'elevenlabs' && !(await getKey('eleven'))) return 'Add your ElevenLabs key in Settings';
  if (e === 'azure' && !(await getKey('azure'))) return 'Add your Azure Speech key in Settings';
  if (e === 'elevenlabs' && !s.elevenVoiceId) return 'Choose an ElevenLabs voice ID in Settings';
  return null;
}

// ---------------------------------------------------------------- synth

const stripCues = (t: string) =>
  t.replace(/<long pause>/g, '\n\n').replace(/<short pause>/g, ', ').replace(/<[^>]{1,20}>/g, ' ').replace(/[ \t]+/g, ' ').trim();

const plainText = (parts: Segment[]) => parts.map((p) => (p.speaker === 'DIALOGUE' ? `“${stripCues(p.text)}”` : stripCues(p.text))).join(' ');

export async function synth(s: Settings, p: VoiceProfile, parts: Segment[], signal?: AbortSignal): Promise<Audio> {
  switch (p.engine) {
    case 'gemini':
      return speak({ key: (await getKey('gemini'))!, settings: effective(s, p), parts, signal });
    case 'elevenlabs':
      return elevenSpeak((await getKey('eleven'))!, effective(s, p), parts, signal);
    case 'azure':
      return azureSpeak((await getKey('azure'))!, s.azureRegion, p, parts, signal);
    case 'device':
      return deviceSpeak(p, parts);
  }
}

let deviceN = 0;
async function deviceSpeak(p: VoiceProfile, parts: Segment[]): Promise<Audio> {
  const out = new File(Paths.cache, `tts-${Date.now()}-${deviceN++}.wav`);
  const r = await synthesizeToFile(plainText(parts), p.voice.id, p.rate || 1, 1, out.uri);
  const f = new File(r.path);
  const bytes = await f.bytes();
  try {
    f.delete();
  } catch {}
  void countUse('device-tts');
  return { bytes, mimeType: `audio/wav;rate=${r.sampleRate}` };
}

const xml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function ssml(p: VoiceProfile, parts: Segment[]) {
  const lang = p.voice.id.split('-').slice(0, 2).join('-') || 'en-US';
  const body = parts
    .map((seg) => {
      let t = xml(seg.text.replace(/<(short pause|long pause|sigh|laugh|breath|gasp)>/g, '[[$1]]'));
      t = t
        .replace(/\[\[short pause\]\]/g, '<break time="400ms"/>')
        .replace(/\[\[long pause\]\]/g, '<break time="1200ms"/>')
        .replace(/\[\[(sigh|laugh|breath|gasp)\]\]/g, '');
      return seg.speaker === 'DIALOGUE' ? `“${t}”` : t;
    })
    .join(' ');
  const rate = `${Math.round(((p.rate || 1) - 1) * 100)}%`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${xml(p.voice.id)}"><prosody rate="${rate}">${body}</prosody></voice></speak>`;
}

async function azureSpeak(key: string, region: string, p: VoiceProfile, parts: Segment[], signal?: AbortSignal): Promise<Audio> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'raw-24khz-16bit-mono-pcm',
        'User-Agent': 'BookVoice',
      },
      body: ssml(p, parts),
      signal,
    });
    if (res.ok) {
      void countUse('azure-tts');
      return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: 'audio/L16;rate=24000' };
    }
    const body = await res.text().catch(() => '');
    if (res.status === 429 && attempt < 6) {
      await sleep(Number(res.headers.get('retry-after')) * 1000 || 4000 * (attempt + 1));
      continue;
    }
    if (res.status === 403 && /quota/i.test(body)) {
      const d = new Date();
      throw new DailyLimitError('Azure', new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(), "Azure's free monthly characters are used up");
    }
    if (res.status === 401) throw new Error('Azure says the Speech key or region is wrong');
    if (res.status >= 500 && attempt < 4) {
      await sleep(3000 * (attempt + 1));
      continue;
    }
    throw new Error(`Azure ${res.status}: ${body.slice(0, 160)}`);
  }
}

export type AzureVoice = { id: string; label: string; locale: string; gender: string; styles: string[] };

export async function listAzureVoices(key: string, region: string): Promise<AzureVoice[]> {
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
    headers: { 'Ocp-Apim-Subscription-Key': key },
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'Azure says the key or region is wrong' : `Azure ${res.status}`);
  const list: any[] = await res.json();
  return list
    .filter((v) => /Neural/.test(v.VoiceType || v.ShortName))
    .map((v) => ({ id: v.ShortName, label: `${v.DisplayName || v.LocalName} (${v.LocaleName || v.Locale})`, locale: v.Locale, gender: v.Gender, styles: v.StyleList || [] }));
}
