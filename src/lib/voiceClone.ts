import { decodeAudioData } from 'react-native-audio-api';
import { bytesToBase64 } from './bytes';
import { wavHeader } from './wav';

/** Google's English consent statement. The person must read it aloud, word for word, in their own voice. */
export const CONSENT_EN =
  'I am the owner of this voice and have consented to the creation of a synthetic model of my voice through the use of Google Cloud.';

export type PreparedAudio = { base64: string; seconds: number };

/**
 * Any audio/video file or recording (WhatsApp voice note, m4a, mp3, wav, mp4…) ->
 * WAV, 16-bit PCM, mono, 24 kHz, which is what Gemini voice replication requires.
 */
export async function toReplicationWav(uri: string, maxSeconds: number): Promise<PreparedAudio> {
  const buf = await decodeAudioData(uri, 24000);
  const ch = buf.numberOfChannels;
  const channels = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  const total = Math.min(channels[0].length, Math.round(maxSeconds * 24000));
  // mix to mono, normalise gently so quiet voice notes are usable
  const mono = new Float32Array(total);
  let peak = 0;
  for (let i = 0; i < total; i++) {
    let v = 0;
    for (let c = 0; c < ch; c++) v += channels[c][i];
    v /= ch;
    mono[i] = v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  const gain = peak > 0 && peak < 0.5 ? Math.min(4, 0.89 / peak) : 1;
  const pcm = new Uint8Array(total * 2);
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < total; i++) {
    const s = Math.max(-1, Math.min(1, mono[i] * gain));
    view.setInt16(i * 2, Math.round(s * 32767), true);
  }
  const wav = new Uint8Array(44 + pcm.length);
  wav.set(wavHeader(pcm.length, 24000), 0);
  wav.set(pcm, 44);
  return { base64: bytesToBase64(wav), seconds: total / 24000 };
}
