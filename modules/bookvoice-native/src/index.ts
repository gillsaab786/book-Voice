import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

export type DeviceVoice = { id: string; name: string; language: string; quality: 'premium' | 'enhanced' | 'default'; gender?: string; network?: boolean; installed?: boolean };

type Native = {
  listVoices(): Promise<DeviceVoice[]>;
  synthesize(text: string, voiceId: string, rate: number, pitch: number, outPath: string): Promise<{ path: string; sampleRate: number }>;
  pdfText(path: string): Promise<string[]>;
};

const mod = requireOptionalNativeModule<Native>('BookVoiceNative');

export const nativeAvailable = !!mod;

export async function listDeviceVoices(): Promise<DeviceVoice[]> {
  if (!mod) return [];
  const list = await mod.listVoices();
  const rank = { premium: 0, enhanced: 1, default: 2 } as const;
  return list
    .filter((v) => v.installed !== false)
    .sort((a, b) => a.language.localeCompare(b.language) || rank[a.quality] - rank[b.quality] || a.name.localeCompare(b.name));
}

export async function synthesizeToFile(text: string, voiceId: string, rate: number, pitch: number, outPath: string) {
  if (!mod) throw new Error(`Phone voices need the BookVoice app build (not available on ${Platform.OS} here).`);
  return mod.synthesize(text, voiceId, rate, pitch, outPath);
}

export async function pdfPagesText(path: string): Promise<string[]> {
  if (!mod) throw new Error('PDF reading on the phone is not available in this build');
  return mod.pdfText(path);
}
