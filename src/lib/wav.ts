// WAV helpers. All audio in the app is 16-bit PCM mono (Gemini TTS native output: 24 kHz).

export type Pcm = { sampleRate: number; channels: number; bits: number; data: Uint8Array };

export function wavHeader(dataBytes: number, sampleRate: number, channels = 1, bits = 16): Uint8Array {
  const h = new Uint8Array(44);
  const v = new DataView(h.buffer);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) h[o + i] = s.charCodeAt(i);
  };
  const blockAlign = (channels * bits) / 8;
  w(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bits, true);
  w(36, 'data');
  v.setUint32(40, dataBytes, true);
  return h;
}

const tag = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** Accepts a RIFF/WAV buffer or raw L16 PCM and returns the PCM payload. */
export function toPcm(bytes: Uint8Array, mimeType?: string): Pcm {
  if (bytes.length >= 12 && tag(bytes, 0) === 'RIFF' && tag(bytes, 8) === 'WAVE') {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let off = 12;
    let sampleRate = 24000;
    let channels = 1;
    let bits = 16;
    while (off + 8 <= bytes.length) {
      const id = tag(bytes, off);
      let size = v.getUint32(off + 4, true);
      const body = off + 8;
      if (id === 'fmt ') {
        channels = v.getUint16(body + 2, true);
        sampleRate = v.getUint32(body + 4, true);
        bits = v.getUint16(body + 14, true);
      } else if (id === 'data') {
        // streaming encoders sometimes write 0 or 0xFFFFFFFF as size
        if (size === 0 || size === 0xffffffff || body + size > bytes.length) size = bytes.length - body;
        return { sampleRate, channels, bits, data: bytes.subarray(body, body + size - (size % 2)) };
      }
      off = body + size + (size % 2);
    }
    throw new Error('WAV has no data chunk');
  }
  const m = /rate=(\d+)/.exec(mimeType || '');
  return { sampleRate: m ? Number(m[1]) : 24000, channels: 1, bits: 16, data: bytes.subarray(0, bytes.length - (bytes.length % 2)) };
}

export function silence(ms: number, sampleRate: number): Uint8Array {
  return new Uint8Array(Math.round((sampleRate * ms) / 1000) * 2);
}

/** Trim near-silent samples at both ends (keeps `padMs` of natural air). */
export function trimSilence(pcm: Uint8Array, sampleRate: number, padMs = 120, threshold = 300): Uint8Array {
  const v = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const n = pcm.length >> 1;
  let s = 0;
  while (s < n && Math.abs(v.getInt16(s * 2, true)) < threshold) s++;
  let e = n - 1;
  while (e > s && Math.abs(v.getInt16(e * 2, true)) < threshold) e--;
  if (s >= e) return pcm;
  const pad = Math.round((sampleRate * padMs) / 1000);
  s = Math.max(0, s - pad);
  e = Math.min(n - 1, e + pad);
  return pcm.subarray(s * 2, (e + 1) * 2);
}
