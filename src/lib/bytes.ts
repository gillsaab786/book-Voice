// Small, dependency-free byte helpers (base64 + text) that work in Hermes and Node.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(256).fill(255);
for (let i = 0; i < B64.length; i++) LOOKUP[B64.charCodeAt(i)] = i;
LOOKUP['-'.charCodeAt(0)] = 62; // base64url
LOOKUP['_'.charCodeAt(0)] = 63;

export function base64ToBytes(b64: string): Uint8Array {
  // strip whitespace / padding
  let len = 0;
  const clean = new Uint8Array(b64.length);
  for (let i = 0; i < b64.length; i++) {
    const v = LOOKUP[b64.charCodeAt(i)];
    if (v !== 255) clean[len++] = v;
  }
  const outLen = Math.floor((len * 3) / 4);
  const out = new Uint8Array(outLen);
  let o = 0;
  let i = 0;
  for (; i + 3 < len; i += 4) {
    const n = (clean[i] << 18) | (clean[i + 1] << 12) | (clean[i + 2] << 6) | clean[i + 3];
    out[o++] = (n >> 16) & 255;
    out[o++] = (n >> 8) & 255;
    out[o++] = n & 255;
  }
  const rem = len - i;
  if (rem === 2) {
    const n = (clean[i] << 18) | (clean[i + 1] << 12);
    out[o++] = (n >> 16) & 255;
  } else if (rem === 3) {
    const n = (clean[i] << 18) | (clean[i + 1] << 12) | (clean[i + 2] << 6);
    out[o++] = (n >> 16) & 255;
    out[o++] = (n >> 8) & 255;
  }
  return o === outLen ? out : out.subarray(0, o);
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
  // minimal fallback
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return decodeURIComponent(escape(s));
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function formatDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
}

export function formatBytes(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 ** 2) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1024 ** 3) return (n / 1024 ** 2).toFixed(1) + ' MB';
  return (n / 1024 ** 3).toFixed(2) + ' GB';
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const n = bytes.length;
  const CH = 3 * 4096;
  for (let s = 0; s < n; s += CH) {
    const end = Math.min(n, s + CH);
    let chunk = '';
    for (let i = s; i < end; i += 3) {
      const a = bytes[i];
      const b = i + 1 < end ? bytes[i + 1] : 0;
      const c = i + 2 < end ? bytes[i + 2] : 0;
      const t = (a << 16) | (b << 8) | c;
      chunk +=
        B64[(t >> 18) & 63] +
        B64[(t >> 12) & 63] +
        (i + 1 < end ? B64[(t >> 6) & 63] : '=') +
        (i + 2 < end ? B64[t & 63] : '=');
    }
    out += chunk;
  }
  return out;
}
