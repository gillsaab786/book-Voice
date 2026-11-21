// AI keys from any service, detected automatically and used in parallel for the text work
// (adapting chapters for listening, reading PDFs). Ported from Now Feed+'s key system.
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { sleep, uid } from './bytes';

export type Provider = {
  id: string;
  name: string;
  base: string;
  prefixes: string[];
  prefer: string[];
  good: string[];
  gapMs: number; // min time between requests on one key
  daily: number; // rough free requests per day (for the meter)
  format?: 'openai' | 'anthropic';
};

const GOOD = ['gpt-oss-120b', '70b', 'qwen3', 'llama-4', 'deepseek', 'mistral-small', 'mistral-medium', 'gemma-3', 'mini', 'haiku', 'flash', 'grok'];

export const PROVIDERS: Provider[] = [
  { id: 'groq', name: 'Groq', base: 'https://api.groq.com/openai/v1', prefixes: ['gsk_'], prefer: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'], good: GOOD, gapMs: 2200, daily: 1000 },
  { id: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', prefixes: ['sk-or-'], prefer: ['openai/gpt-oss-120b:free', 'meta-llama/llama-3.3-70b-instruct:free'], good: GOOD, gapMs: 3200, daily: 50 },
  { id: 'nvidia', name: 'NVIDIA', base: 'https://integrate.api.nvidia.com/v1', prefixes: ['nvapi-'], prefer: ['openai/gpt-oss-120b', 'meta/llama-3.3-70b-instruct'], good: GOOD, gapMs: 1700, daily: 1000 },
  { id: 'cerebras', name: 'Cerebras', base: 'https://api.cerebras.ai/v1', prefixes: ['csk-'], prefer: ['gpt-oss-120b', 'llama-3.3-70b'], good: GOOD, gapMs: 6000, daily: 1000 },
  { id: 'huggingface', name: 'Hugging Face', base: 'https://router.huggingface.co/v1', prefixes: ['hf_'], prefer: ['openai/gpt-oss-120b', 'meta-llama/Llama-3.3-70B-Instruct'], good: GOOD, gapMs: 2500, daily: 100 },
  { id: 'github', name: 'GitHub Models', base: 'https://models.github.ai/inference', prefixes: ['github_pat_', 'ghp_'], prefer: ['openai/gpt-4.1-mini', 'meta/Llama-3.3-70B-Instruct'], good: GOOD, gapMs: 4000, daily: 150 },
  { id: 'xai', name: 'xAI', base: 'https://api.x.ai/v1', prefixes: ['xai-'], prefer: ['grok-3-mini'], good: GOOD, gapMs: 1500, daily: 1000 },
  { id: 'anthropic', name: 'Anthropic', base: 'https://api.anthropic.com/v1', prefixes: ['sk-ant-'], prefer: [], good: ['haiku', 'sonnet'], gapMs: 1500, daily: 1000, format: 'anthropic' },
  { id: 'fireworks', name: 'Fireworks', base: 'https://api.fireworks.ai/inference/v1', prefixes: ['fw_'], prefer: ['accounts/fireworks/models/gpt-oss-120b'], good: GOOD, gapMs: 1500, daily: 1000 },
  { id: 'together', name: 'Together', base: 'https://api.together.xyz/v1', prefixes: ['tgp_'], prefer: ['openai/gpt-oss-120b'], good: GOOD, gapMs: 1500, daily: 1000 },
  { id: 'openai', name: 'OpenAI', base: 'https://api.openai.com/v1', prefixes: ['sk-proj-', 'sk-svcacct-'], prefer: ['gpt-4.1-mini', 'gpt-4o-mini'], good: GOOD, gapMs: 1000, daily: 1000 },
  // no telling prefix: tried in turn
  { id: 'mistral', name: 'Mistral', base: 'https://api.mistral.ai/v1', prefixes: [], prefer: ['mistral-small-latest', 'mistral-medium-latest'], good: GOOD, gapMs: 1500, daily: 1000 },
  { id: 'sambanova', name: 'SambaNova', base: 'https://api.sambanova.ai/v1', prefixes: [], prefer: ['gpt-oss-120b', 'Meta-Llama-3.3-70B-Instruct'], good: GOOD, gapMs: 2500, daily: 1000 },
  { id: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com/v1', prefixes: [], prefer: ['deepseek-chat'], good: GOOD, gapMs: 1000, daily: 1000 },
];

export const providerById = (id: string) => PROVIDERS.find((p) => p.id === id);

export type AiKey = { id: string; provider: string; models: string[]; addedAt: number; disabled?: boolean };

// ---------------------------------------------------------------- storage

const indexFile = () => new File(Paths.document, '.aikeys.json');
const usageFile = () => new File(Paths.document, '.aiusage.json');

type Usage = {
  day: string;
  counts: Record<string, number>; // key id (or "gemini-tts", "gemini-text") -> requests today
  rest: Record<string, number>; // key id -> resting until (ms)
  out: Record<string, number>; // "keyId|model" -> daily limit hit, back at (ms)
  errors: Record<string, string>;
};

let keys: AiKey[] | null = null;
let usage: Usage | null = null;
const secrets = new Map<string, string>();
const listeners = new Set<() => void>();
export const onAiChange = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const changed = () => listeners.forEach((l) => l());

const today = () => new Date().toISOString().slice(0, 10);

export async function loadKeys(): Promise<AiKey[]> {
  if (keys) return keys;
  try {
    const f = indexFile();
    keys = f.exists ? JSON.parse(await f.text()) : [];
  } catch {
    keys = [];
  }
  for (const k of keys!) {
    const s = await SecureStore.getItemAsync(`aikey_${k.id}`);
    if (s) secrets.set(k.id, s);
  }
  keys = keys!.filter((k) => secrets.has(k.id));
  return keys!;
}

function saveKeys() {
  const f = indexFile();
  if (!f.exists) f.create();
  f.write(JSON.stringify(keys || []));
  changed();
}

export async function loadUsage(): Promise<Usage> {
  if (!usage) {
    try {
      const f = usageFile();
      usage = f.exists ? JSON.parse(await f.text()) : null;
    } catch {}
    usage = usage || { day: today(), counts: {}, rest: {}, out: {}, errors: {} };
  }
  if (usage.day !== today()) usage = { day: today(), counts: {}, rest: {}, out: usage.out || {}, errors: {} };
  return usage;
}
let saveTimer: any;
function saveUsage() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const f = usageFile();
    if (!f.exists) f.create();
    f.write(JSON.stringify(usage));
  }, 800);
  changed();
}

export async function countUse(id: string, n = 1) {
  const u = await loadUsage();
  u.counts[id] = (u.counts[id] || 0) + n;
  saveUsage();
}
export async function markError(id: string, msg: string | null) {
  const u = await loadUsage();
  if (msg) u.errors[id] = msg;
  else delete u.errors[id];
  saveUsage();
}
export async function restUntil(id: string, until: number) {
  const u = await loadUsage();
  u.rest[id] = until;
  saveUsage();
}

// ---------------------------------------------------------------- detection

const headers = (p: Provider, key: string): Record<string, string> =>
  p.format === 'anthropic'
    ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
    : { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

function rankModels(p: Provider, ids: string[]): string[] {
  if (!ids.length) return p.prefer.slice(0, 4);
  const out = p.prefer.filter((m) => ids.includes(m));
  const chat = (id: string) => !/embed|whisper|tts|guard|rerank|image|audio|moderation|vision|ocr|transcri/i.test(id);
  let usable = ids.filter(chat);
  if (p.id === 'openrouter') usable = usable.filter((id) => id.endsWith(':free'));
  const extra = usable.filter((id) => !out.includes(id) && p.good.some((w) => id.toLowerCase().includes(w)));
  extra.sort((a, b) => strength(b) - strength(a) || a.localeCompare(b));
  out.push(...extra);
  if (!out.length && usable.length) out.push(usable[0]);
  return out.slice(0, 6);
}
function strength(id: string) {
  const l = id.toLowerCase();
  if (l.includes('120b') || l.includes('405b') || l.includes('sonnet')) return 5;
  if (l.includes('70b') || l.includes('medium') || l.includes('qwen3')) return 4;
  if (l.includes('mini') || l.includes('small') || l.includes('flash')) return 3;
  return 1;
}

export class KeyError extends Error {}

async function probe(p: Provider, key: string): Promise<string[] | null> {
  const url = p.id === 'github' ? 'https://models.github.ai/catalog/models' : `${p.base}/models`;
  const res = await fetch(url, { headers: headers(p, key) });
  if (res.status === 401 || res.status === 403) throw new KeyError(`${p.name} says this key isn't valid`);
  if (res.status !== 200) return null;
  if (p.id === 'openrouter') {
    const k = await fetch(`${p.base}/key`, { headers: headers(p, key) });
    if (k.status !== 200) throw new KeyError("OpenRouter says this key isn't valid");
  }
  const j: any = await res.json().catch(() => ({}));
  const list: any[] = Array.isArray(j) ? j : j.data || j.models || [];
  const ids = list.map((m) => String(m.id || m.name || '')).filter(Boolean);
  const ranked = rankModels(p, ids);
  if (!ranked.length) throw new KeyError(`${p.name} key works, but no suitable chat model was found`);
  return ranked;
}

/** Works out which service a key belongs to, checks it, and stores it. */
export async function addKey(raw: string): Promise<AiKey> {
  const key = raw.trim();
  if (!key) throw new KeyError('Paste a key first');
  if (key.startsWith('AIza')) throw new KeyError('That\'s a Google (Gemini) key — it goes in the Gemini field above.');
  await loadKeys();
  for (const k of keys!) if (secrets.get(k.id) === key) throw new KeyError('That key is already added');
  const known = PROVIDERS.filter((p) => p.prefixes.some((x) => key.startsWith(x)));
  const tryList = known.length ? known : [...PROVIDERS.filter((p) => !p.prefixes.length), ...(key.startsWith('sk-') ? [providerById('openai')!] : [])];
  let why: string | undefined;
  for (const p of tryList) {
    try {
      const models = await probe(p, key);
      if (models) {
        const k: AiKey = { id: uid(), provider: p.id, models, addedAt: Date.now() };
        await SecureStore.setItemAsync(`aikey_${k.id}`, key);
        secrets.set(k.id, key);
        keys!.push(k);
        saveKeys();
        return k;
      }
    } catch (e: any) {
      why = e?.message;
      if (known.length) break;
    }
  }
  throw new KeyError(why || "Couldn't tell which service this key is from, or it isn't valid.");
}

export async function removeKey(id: string) {
  await loadKeys();
  keys = keys!.filter((k) => k.id !== id);
  secrets.delete(id);
  await SecureStore.deleteItemAsync(`aikey_${id}`);
  saveKeys();
}

export async function setKeyDisabled(id: string, disabled: boolean) {
  await loadKeys();
  const k = keys!.find((x) => x.id === id);
  if (k) k.disabled = disabled;
  saveKeys();
}

export function keyStatus(k: AiKey, u: Usage): { line: string; used: number; ok: boolean } {
  const p = providerById(k.provider);
  const n = u.counts[k.id] || 0;
  const used = Math.min(1, n / (p?.daily || 1000));
  const now = Date.now();
  if (k.disabled) return { line: 'Switched off', used, ok: false };
  const outModels = k.models.filter((m) => (u.out[`${k.id}|${m}`] || 0) > now);
  if (outModels.length === k.models.length) return { line: 'Daily free use finished · back tomorrow', used: 1, ok: false };
  if ((u.rest[k.id] || 0) > now) return { line: `Resting · back in ${Math.ceil(((u.rest[k.id] || 0) - now) / 1000)} s`, used, ok: true };
  if (u.errors[k.id]) return { line: `Problem · ${u.errors[k.id]}`, used, ok: false };
  return { line: `Ready · ${n} request${n === 1 ? '' : 's'} today`, used, ok: true };
}

// ---------------------------------------------------------------- the pool

type Slot = { k: AiKey; busy: boolean; lastStart: number };
const slots = new Map<string, Slot>();

/** Number of keys that can take text jobs right now (for planning parallel work). */
export async function poolSize(): Promise<number> {
  const ks = await loadKeys();
  return ks.filter((k) => !k.disabled).length;
}

async function acquire(exclude: Set<string>, signal?: AbortSignal): Promise<{ slot: Slot; model: string } | null> {
  for (;;) {
    if (signal?.aborted) throw new Error('cancelled');
    const ks = (await loadKeys()).filter((k) => !k.disabled && !exclude.has(k.id));
    if (!ks.length) return null;
    const u = await loadUsage();
    const now = Date.now();
    let soonest = Infinity;
    let anyUsable = false;
    for (const k of ks) {
      const models = k.models.filter((m) => (u.out[`${k.id}|${m}`] || 0) <= now);
      if (!models.length) continue;
      anyUsable = true;
      const s = slots.get(k.id) || { k, busy: false, lastStart: 0 };
      slots.set(k.id, s);
      const p = providerById(k.provider)!;
      const readyAt = Math.max(u.rest[k.id] || 0, s.lastStart + p.gapMs);
      if (!s.busy && readyAt <= now) {
        s.busy = true;
        s.lastStart = now;
        return { slot: s, model: models[0] };
      }
      soonest = Math.min(soonest, s.busy ? now + 300 : readyAt);
    }
    if (!anyUsable) return null;
    await sleep(Math.max(150, Math.min(5000, soonest - now)));
  }
}

function dailyReset(): number {
  // most services reset at midnight UTC
  const d = new Date();
  d.setUTCHours(24, 5, 0, 0);
  return d.getTime();
}

/** Ask one pooled key for a JSON answer. Returns null when no keys can take it. */
export async function poolChat(system: string, user: string, opts: { signal?: AbortSignal; exclude?: Set<string>; maxTokens?: number } = {}): Promise<{ text: string; via: string; keyId: string } | null> {
  const exclude = new Set(opts.exclude || []);
  for (let attempt = 0; attempt < 6; attempt++) {
    const got = await acquire(exclude, opts.signal);
    if (!got) return null;
    const { slot, model } = got;
    const p = providerById(slot.k.provider)!;
    const key = secrets.get(slot.k.id)!;
    try {
      let res: Response;
      if (p.format === 'anthropic') {
        res = await fetch(`${p.base}/messages`, {
          method: 'POST', headers: headers(p, key), signal: opts.signal,
          body: JSON.stringify({ model, system, max_tokens: opts.maxTokens || 8000, messages: [{ role: 'user', content: user }] }),
        });
      } else {
        res = await fetch(p.id === 'github' ? `${p.base}/chat/completions` : `${p.base}/chat/completions`, {
          method: 'POST', headers: headers(p, key), signal: opts.signal,
          body: JSON.stringify({
            model,
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
            max_tokens: opts.maxTokens || 8000,
            temperature: 0.4,
          }),
        });
      }
      const body = await res.text();
      await countUse(slot.k.id);
      if (res.ok) {
        const j = JSON.parse(body);
        const text = p.format === 'anthropic' ? (j.content || []).map((c: any) => c.text || '').join('') : j.choices?.[0]?.message?.content || '';
        await markError(slot.k.id, null);
        if (text.trim()) return { text, via: `${p.name} · ${model}`, keyId: slot.k.id };
        exclude.add(slot.k.id);
        continue;
      }
      if (res.status === 429) {
        const daily = /per day|daily|rpd|tpd|requests per day|tokens per day|quota/i.test(body);
        const ra = Number(res.headers.get('retry-after')) || 0;
        if (daily && ra > 3600 - 1) {
          (await loadUsage()).out[`${slot.k.id}|${model}`] = dailyReset();
        } else if (daily && !ra) {
          (await loadUsage()).out[`${slot.k.id}|${model}`] = dailyReset();
        } else {
          await restUntil(slot.k.id, Date.now() + Math.max(5, ra || 20) * 1000);
        }
        saveUsage();
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        await markError(slot.k.id, 'key not accepted');
        exclude.add(slot.k.id);
        continue;
      }
      if (res.status === 413 || /context|too long|maximum.*tokens/i.test(body)) {
        exclude.add(slot.k.id); // too much text for this one; another can take it
        continue;
      }
      await restUntil(slot.k.id, Date.now() + 15000);
    } catch (e: any) {
      if (opts.signal?.aborted || e?.name === 'AbortError') throw new Error('cancelled');
      await restUntil(slot.k.id, Date.now() + 15000);
    } finally {
      slot.busy = false;
    }
  }
  return null;
}

/** Pull the JSON object out of a model answer (handles ```json fences and chatter). */
export function extractJson<T>(text: string): T | null {
  const t = text.replace(/```(?:json)?/gi, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(t.slice(a, b + 1));
  } catch {
    return null;
  }
}

export async function getSecret(id: string) {
  await loadKeys();
  return secrets.get(id);
}

/** The secret of the first working key from a given service, if you added one. */
export async function keyFor(providerId: string): Promise<string | null> {
  const ks = await loadKeys();
  const k = ks.find((x) => x.provider === providerId && !x.disabled);
  return k ? secrets.get(k.id) || null : null;
}
