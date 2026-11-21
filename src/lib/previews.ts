// Voice samples are made once and kept on the phone, so listening again never uses credit.
// While the app is open and online, missing Gemini samples are downloaded a few a day in the background.
import { Directory, File, Paths } from 'expo-file-system';
import { audioToWavFile } from './converter';
import { DailyLimitError } from './errors';
import { profileFromSettings, synth } from './speech';
import { getKey, loadSettings } from './storage';
import { GEMINI_TTS_MODELS, PREBUILT_VOICES, Settings, VoiceProfile } from './types';

export const SAMPLE: Record<string, string> = {
  'pa-IN': 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ। ਇਹ ਤੁਹਾਡੀ ਕਿਤਾਬ ਦੀ ਆਵਾਜ਼ ਹੈ — ਆਓ ਕਹਾਣੀ ਸ਼ੁਰੂ ਕਰੀਏ।',
  'hi-IN': 'नमस्ते। यह आपकी किताब की आवाज़ है — चलिए, कहानी शुरू करते हैं।',
  'ur-PK': 'السلام علیکم۔ یہ آپ کی کتاب کی آواز ہے — آئیے کہانی شروع کرتے ہیں۔',
};
export const SAMPLE_EN = 'Chapter One. The rain had stopped by the time she reached the old house, and for a moment, everything was perfectly still.';

const dir = () => {
  const d = new Directory(Paths.document, 'Previews');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
};

function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function sampleFor(p: VoiceProfile) {
  const lang = p.engine === 'azure' ? p.voice.id.slice(0, 5) : p.languageCode;
  return SAMPLE[lang] || SAMPLE_EN;
}

/** Everything that changes how the sample sounds goes into its file name. */
function keyOf(s: Settings, p: VoiceProfile, text: string) {
  const model = p.engine === 'gemini' ? p.ttsModel || s.ttsModel : '';
  const style = p.engine === 'gemini' ? p.style : '';
  return `${p.engine}-${p.voice.id.replace(/[^\w.-]/g, '_')}-${hash([model, style, p.languageCode, p.rate, text].join('|'))}.wav`;
}

export function cachedPreview(s: Settings, p: VoiceProfile, text = sampleFor(p)): File | null {
  const f = new File(dir(), keyOf(s, p, text));
  return f.exists ? f : null;
}

/** A sample of this voice: from the phone if already made, otherwise made once and kept. */
export async function previewCached(s: Settings, profile: VoiceProfile): Promise<{ file: File; fresh: boolean }> {
  const p = { ...profile, dialogueMode: false };
  const text = sampleFor(p);
  const hit = cachedPreview(s, p, text);
  if (hit) return { file: hit, fresh: false };
  const a = await synth(s, p, [{ speaker: 'NARRATOR', text }]);
  const tmp = await audioToWavFile(a);
  const out = new File(dir(), keyOf(s, p, text));
  tmp.move(out);
  return { file: out, fresh: true };
}

/** Standard Gemini voices that already have a sample saved, for the current style/language. */
export async function previewCount(): Promise<{ have: number; total: number }> {
  const s = await loadSettings();
  const base = profileFromSettings({ ...s, engine: 'gemini' });
  let have = 0;
  for (const [id] of PREBUILT_VOICES) if (cachedPreview(s, { ...base, voice: { id, label: id, prebuilt: true } })) have++;
  return { have, total: PREBUILT_VOICES.length };
}

let running = false;
const PER_DAY = 12; // leave most of the free daily speech allowance for books
const budgetFile = () => new File(Paths.document, '.preview-budget.json');

/** Quietly fetch missing samples (a few a day) when online and Gemini isn't busy with a book. */
export async function prefetchPreviews(isGeminiBusy: () => boolean) {
  if (running) return;
  running = true;
  try {
    if (!(await getKey('gemini'))) return;
    const s = await loadSettings();
    const day = new Date().toISOString().slice(0, 10);
    let budget = { day, used: 0 };
    try {
      const f = budgetFile();
      if (f.exists) {
        const b = JSON.parse(await f.text());
        if (b.day === day) budget = b;
      }
    } catch {}
    const base = profileFromSettings({ ...s, engine: 'gemini' });
    const voices = [
      ...(s.myVoices || []).map((m) => ({ id: m.id, label: m.label, prebuilt: false })),
      ...PREBUILT_VOICES.map(([id, d]) => ({ id, label: `${id} — ${d}`, prebuilt: true })),
    ];
    // the default speech model first, then the other one
    const models = [s.ttsModel, ...GEMINI_TTS_MODELS.map((m) => m[0]).filter((m) => m !== s.ttsModel)];
    for (const model of models) {
      for (const v of voices) {
        if (budget.used >= PER_DAY || isGeminiBusy()) return;
        const p: VoiceProfile = { ...base, voice: v, ttsModel: model };
        if (cachedPreview(s, p)) continue;
        try {
          await previewCached(s, p);
          budget.used++;
          const f = budgetFile();
          if (!f.exists) f.create();
          f.write(JSON.stringify(budget));
        } catch (e) {
          if (e instanceof DailyLimitError) return;
          return; // offline or other problem: try again next time
        }
      }
    }
  } finally {
    running = false;
  }
}
