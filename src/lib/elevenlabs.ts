import { fetch as expoFetch } from 'expo/fetch';
import { sleep } from './bytes';
import { Audio } from './gemini';
import { Segment, Settings } from './types';

/** Optional provider: any voice in your own ElevenLabs library (e.g. a licensed Iconic voice). */
export async function elevenSpeak(key: string, s: Settings, parts: Segment[], signal?: AbortSignal): Promise<Audio> {
  if (!s.elevenVoiceId) throw new Error('Set an ElevenLabs voice ID in Settings');
  const text = parts
    .map((p) => (p.speaker === 'DIALOGUE' ? `“${p.text}”` : p.text))
    .join(' ')
    .replace(/<long pause>/g, ' ... ... ')
    .replace(/<short pause>/g, ' ... ')
    .replace(/<(sigh|laugh|breath|gasp|cough)>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  for (let attempt = 0; ; attempt++) {
    const res = await expoFetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(s.elevenVoiceId)}?output_format=pcm_24000`,
      {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/pcm' },
        body: JSON.stringify({ text, model_id: s.elevenModel }),
        signal,
      }
    );
    if (res.ok) return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: 'audio/L16;rate=24000' };
    const body = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 200)}`);
  }
}
