import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Text, View } from 'react-native';
import { Engine } from '../lib/types';
import { C, Dim } from './kit';

/** Honest ranking of the voice options: quality vs how fast a whole book gets done for free. */
export type VoiceOption = {
  key: string;
  name: string;
  engine: Engine;
  model?: string;
  quality: number; // 1..5
  speed: number; // 1..5 (whole-book turnaround on free allowances)
  free: string;
  book: string; // rough time for a 10-hour book
  best: string;
};

export const VOICE_OPTIONS: VoiceOption[] = [
  { key: 'gemini-flash', name: 'Gemini Flash TTS', engine: 'gemini', model: 'gemini-3.8-flash-tts', quality: 5, speed: 2, free: '~100 requests a day ≈ 7–9 h audio a day', book: '1–2 days', best: 'Most human: emotion, breaths, accents. Novels and stories.' },
  { key: 'elevenlabs', name: 'ElevenLabs', engine: 'elevenlabs', quality: 5, speed: 4, free: '~10 min a month on the free plan', book: 'needs a paid plan', best: 'Superb, but the free plan is tiny.' },
  { key: 'gemini-lite', name: 'Gemini Flash-Lite TTS', engine: 'gemini', model: 'gemini-3.8-flash-lite-tts', quality: 4, speed: 2, free: 'Its own daily allowance', book: '1–2 days', best: 'Nearly as natural; run it alongside Flash.' },
  { key: 'azure', name: 'Azure neural voices', engine: 'azure', quality: 4, speed: 5, free: '500,000 characters a month ≈ 9–10 h', book: '5–15 minutes', best: 'Fast and clear. Great Punjabi and Hindi. Long books.' },
  { key: 'phone-premium', name: 'Phone · Premium / Enhanced', engine: 'device', quality: 3, speed: 4, free: 'Unlimited, offline', book: '30–60 minutes', best: 'Good for non-fiction; flatter emotion.' },
  { key: 'phone', name: 'Phone · standard voices', engine: 'device', quality: 2, speed: 4, free: 'Unlimited, offline', book: '30–60 minutes', best: 'Robotic. Only if nothing else is available.' },
];

function Dots({ n, color }: { n: number; color: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={{ width: 14, height: 6, borderRadius: 3, backgroundColor: i <= n ? color : 'rgba(255,255,255,0.12)' }} />
      ))}
    </View>
  );
}

export function OptionMeter({ o }: { o: VoiceOption }) {
  return (
    <View style={{ gap: 6, marginBottom: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: C.dim, fontSize: 12, width: 54 }}>Quality</Text>
        <Dots n={o.quality} color={C.green} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: C.dim, fontSize: 12, width: 54 }}>Speed</Text>
        <Dots n={o.speed} color={C.accent} />
        <Text style={{ color: C.dim, fontSize: 12, fontVariant: ['tabular-nums'] }}>10 h book: {o.book}</Text>
      </View>
    </View>
  );
}

export function optionFor(engine: Engine, model?: string, voiceQuality?: string): VoiceOption {
  if (engine === 'gemini') return VOICE_OPTIONS.find((o) => o.model === model) || VOICE_OPTIONS[0];
  if (engine === 'device') return VOICE_OPTIONS.find((o) => o.key === (voiceQuality === 'default' ? 'phone' : 'phone-premium'))!;
  return VOICE_OPTIONS.find((o) => o.engine === engine)!;
}

/** Full best-to-worst table (Settings ▸ Compare voices, and inside the voice picker). */
export function ModelRanking({ compact }: { compact?: boolean }) {
  return (
    <View>
      {VOICE_OPTIONS.map((o, i) => (
        <View key={o.key} style={{ paddingVertical: 10, borderBottomWidth: i < VOICE_OPTIONS.length - 1 ? 1 : 0, borderColor: 'rgba(255,255,255,0.08)' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ color: C.dim, width: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{i + 1}</Text>
            <Text style={{ color: C.text, fontWeight: '700', flex: 1 }}>{o.name}</Text>
            {i === 0 ? <Tag text="BEST" color={C.green} /> : null}
            {i === VOICE_OPTIONS.length - 1 ? <Tag text="WORST" color={C.red} /> : null}
            {o.key === 'azure' ? <Tag text="FASTEST" color={C.accent} /> : null}
          </View>
          <View style={{ paddingLeft: 22 }}>
            <OptionMeter o={o} />
            {!compact ? (
              <>
                <Dim style={{ fontSize: 12 }}>
                  <Ionicons name="gift-outline" size={12} color={C.dim} /> {o.free}
                </Dim>
                <Dim style={{ fontSize: 12, marginTop: 2 }}>{o.best}</Dim>
              </>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function Tag({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ borderWidth: 1, borderColor: color, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, marginLeft: 6 }}>
      <Text style={{ color, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 }}>{text}</Text>
    </View>
  );
}
