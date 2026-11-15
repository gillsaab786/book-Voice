import { AudioPlayer, createAudioPlayer } from 'expo-audio';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { audioToWavFile, previewVoice } from '../lib/converter';
import { deleteDesignedVoice, designVoice, LibraryVoice, searchVoices } from '../lib/gemini';
import { getKey, loadSettings, saveSettings, setKey } from '../lib/storage';
import { handleRemoteUrl, REMOTE_LINKS } from '../lib/remote';
import { Platform } from 'react-native';
import { DESIGN_PRESETS, LANGUAGES, PREBUILT_VOICES, Settings, STYLE_PRESETS, VoiceChoice } from '../lib/types';
import { Btn, C, Card, Chip, Dim, Field, H, Header } from './kit';
import { CloneVoiceCard } from './CloneVoiceCard';

const SAMPLE: Record<string, string> = {
  'pa-IN': 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ। ਇਹ ਤੁਹਾਡੀ ਕਿਤਾਬ ਦੀ ਆਵਾਜ਼ ਹੈ — ਆਓ ਕਹਾਣੀ ਸ਼ੁਰੂ ਕਰੀਏ।',
  'hi-IN': 'नमस्ते। यह आपकी किताब की आवाज़ है — चलिए, कहानी शुरू करते हैं।',
  'ur-PK': 'السلام علیکم۔ یہ آپ کی کتاب کی آواز ہے — آئیے کہانی شروع کرتے ہیں۔',
};
const SAMPLE_EN = 'Chapter One. <short pause> The rain had stopped by the time she reached the old house, and for a moment, everything was perfectly still.';

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [gKey, setGKey] = useState('');
  const [eKey, setEKey] = useState('');
  const [target, setTarget] = useState<'voice' | 'dialogueVoice'>('voice');
  const [previewing, setPreviewing] = useState(false);
  const [lib, setLib] = useState<LibraryVoice[] | null>(null);
  const [libQ, setLibQ] = useState({ language: 'pa-IN', gender: '', search: '' });
  const [libBusy, setLibBusy] = useState(false);
  const [adv, setAdv] = useState(false);
  const player = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    loadSettings().then(setS);
    getKey('gemini').then((k) => setGKey(k || ''));
    getKey('eleven').then((k) => setEKey(k || ''));
    return () => player.current?.remove();
  }, []);
  if (!s) return null;

  const update = (patch: Partial<Settings>) => {
    const n = { ...s, ...patch };
    setS(n);
    void saveSettings(n);
  };
  const pickVoice = (v: VoiceChoice) => update({ [target]: v } as Partial<Settings>);

  const preview = async () => {
    setPreviewing(true);
    try {
      await setKey('gemini', gKey);
      await setKey('eleven', eKey);
      const f = await previewVoice(
        target === 'dialogueVoice' ? { ...s, voice: s.dialogueVoice } : s,
        SAMPLE[s.languageCode] || SAMPLE_EN
      );
      player.current?.remove();
      player.current = createAudioPlayer({ uri: f.uri });
      player.current.play();
    } catch (e: any) {
      Alert.alert('Preview failed', e?.message || String(e));
    } finally {
      setPreviewing(false);
    }
  };

  const findVoices = async () => {
    setLibBusy(true);
    try {
      await setKey('gemini', gKey);
      setLib(await searchVoices(gKey, { language: libQ.language || undefined, gender: libQ.gender || undefined, search: libQ.search || undefined, context: 'Audiobook' }));
    } catch (e: any) {
      Alert.alert('Voice search failed', e?.message || String(e));
    } finally {
      setLibBusy(false);
    }
  };

  const current = s[target];

  return (
    <View style={{ flex: 1 }}>
      <Header title="Settings" onBack={async () => { await setKey('gemini', gKey); await setKey('eleven', eKey); onBack(); }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
        <H>Gemini</H>
        <Card>
          <Field label="Gemini API key (stored in the phone's secure keychain)" value={gKey} onChangeText={setGKey} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="AIza…" onBlur={() => setKey('gemini', gKey)} />
          <Dim style={{ marginTop: 4, marginBottom: 8 }}>How should books be told?</Dim>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Chip label="Storyteller (like a person telling you)" on={s.narration === 'storyteller'} onPress={() => update({ narration: 'storyteller', adaptText: true })} />
            <Chip label="Faithful (every word as written)" on={s.narration === 'faithful'} onPress={() => update({ narration: 'faithful' })} />
          </View>
          <Dim style={{ marginBottom: 6 }}>
            {s.narration === 'storyteller'
              ? 'Keeps every event and every line of dialogue, but tells it in natural spoken sentences with breaths, pauses, laughs and emotion.'
              : 'Reads the author’s exact words, only cleaned up for listening.'}
          </Dim>
          <Row label="Adapt text for listening" hint="Gemini rewrites each chapter so it sounds natural: expands abbreviations, describes tables, removes page clutter, adds pauses and emotion. Off = read text exactly.">
            <Switch value={s.adaptText} onValueChange={(v) => update({ adaptText: v, narration: v ? s.narration : 'faithful' })} trackColor={{ true: C.accent }} />
          </Row>
        </Card>

        <H>Narrator</H>
        <Card>
          <View style={{ flexDirection: 'row', marginBottom: 8 }}>
            <Chip label={`Narrator: ${s.voice.id}`} on={target === 'voice'} onPress={() => setTarget('voice')} />
            {s.dialogueMode ? <Chip label={`Dialogue: ${s.dialogueVoice.id}`} on={target === 'dialogueVoice'} onPress={() => setTarget('dialogueVoice')} /> : null}
          </View>
          <Dim style={{ marginBottom: 8 }}>Pick a voice for the {target === 'voice' ? 'narrator' : 'characters’ dialogue'}:</Dim>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {PREBUILT_VOICES.map(([id, d]) => (
              <Chip key={id} label={`${id} · ${d}`} on={current.prebuilt && current.id === id} onPress={() => pickVoice({ id, label: `${id} — ${d}`, prebuilt: true })} />
            ))}
          </View>
          {!current.prebuilt ? <Dim style={{ color: C.accent, marginTop: 4 }}>Library voice: {current.label}</Dim> : null}
          <Btn title={previewing ? 'Generating…' : `▶  Preview ${current.id}`} kind="ghost" busy={previewing} onPress={preview} style={{ marginTop: 8 }} />
        </Card>

        <DesignVoiceCard
          s={s}
          gKey={gKey}
          target={target}
          current={current}
          update={update}
          pickVoice={pickVoice}
          play={(uri) => {
            player.current?.remove();
            player.current = createAudioPlayer({ uri });
            player.current.play();
          }}
        />

        <CloneVoiceCard
          s={s}
          gKey={gKey}
          update={update}
          pickVoice={pickVoice}
          play={(uri) => {
            player.current?.remove();
            player.current = createAudioPlayer({ uri });
            player.current.play();
          }}
        />

        <Card>
          <Text style={{ color: C.text, fontWeight: '700', marginBottom: 4 }}>Voice library (2,000+ voices)</Text>
          <Dim style={{ marginBottom: 10 }}>Find narrators by language and style, e.g. Punjabi or Hindi audiobook voices.</Dim>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {LANGUAGES.filter(([c]) => c).map(([c, n]) => <Chip key={c} label={n} on={libQ.language === c} onPress={() => setLibQ({ ...libQ, language: c })} />)}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {[['', 'Any'], ['female', 'Female'], ['male', 'Male']].map(([g, n]) => <Chip key={g} label={n} on={libQ.gender === g} onPress={() => setLibQ({ ...libQ, gender: g })} />)}
          </View>
          <Field placeholder="Search (e.g. warm storyteller, deep, soft)" value={libQ.search} onChangeText={(t) => setLibQ({ ...libQ, search: t })} />
          <Btn title="Search voices" kind="ghost" busy={libBusy} onPress={findVoices} />
          {lib?.length === 0 ? <Dim style={{ marginTop: 10 }}>No matches — try another filter.</Dim> : null}
          {lib?.map((v) => (
            <Pressable key={v.id} onPress={() => pickVoice({ id: v.id, label: v.label, prebuilt: false })} style={{ paddingVertical: 10, borderBottomWidth: 1, borderColor: C.line }}>
              <Text style={{ color: current.id === v.id ? C.accent : C.text, fontWeight: '600' }}>{v.label}</Text>
              {v.detail ? <Dim numberOfLines={2}>{v.detail}</Dim> : null}
            </Pressable>
          ))}
          {target === 'voice' && s.dialogueMode && !s.voice.prebuilt ? (
            <Dim style={{ color: C.accent, marginTop: 8 }}>Two-voice dialogue only works with the 30 standard voices; designed and library voices narrate everything.</Dim>
          ) : null}
        </Card>

        <H>Delivery</H>
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {STYLE_PRESETS.map(([n, v]) => <Chip key={n} label={n} on={s.style === v} onPress={() => update({ style: v })} />)}
          </View>
          <Field label="Style direction (plain words — Gemini follows it)" multiline value={s.style} onChangeText={(t) => update({ style: t })} />
          <Dim style={{ marginBottom: 8 }}>Language / accent</Dim>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {LANGUAGES.map(([c, n]) => <Chip key={c || 'auto'} label={n} on={s.languageCode === c} onPress={() => update({ languageCode: c })} />)}
          </View>
          <Row label="Separate voice for dialogue" hint="Characters' spoken lines use a second voice, like a dramatised audiobook.">
            <Switch value={s.dialogueMode} onValueChange={(v) => { update({ dialogueMode: v }); if (!v) setTarget('voice'); }} trackColor={{ true: C.accent }} />
          </Row>
        </Card>

        <H>Other provider</H>
        <Card>
          <View style={{ flexDirection: 'row' }}>
            <Chip label="Gemini voices" on={s.provider === 'gemini'} onPress={() => update({ provider: 'gemini' })} />
            <Chip label="ElevenLabs" on={s.provider === 'elevenlabs'} onPress={() => update({ provider: 'elevenlabs' })} />
          </View>
          {s.provider === 'elevenlabs' ? (
            <>
              <Dim style={{ marginBottom: 10 }}>Uses a voice from your own ElevenLabs account (including officially licensed voices). Gemini still adapts the text.</Dim>
              <Field label="ElevenLabs API key" value={eKey} onChangeText={setEKey} secureTextEntry autoCapitalize="none" onBlur={() => setKey('eleven', eKey)} />
              <Field label="Voice ID" value={s.elevenVoiceId} onChangeText={(t) => update({ elevenVoiceId: t.trim() })} autoCapitalize="none" />
              <Field label="Model" value={s.elevenModel} onChangeText={(t) => update({ elevenModel: t.trim() })} autoCapitalize="none" />
            </>
          ) : null}
        </Card>

        <H>{Platform.OS === 'ios' ? 'Siri & Shortcuts' : 'Assistant & shortcuts'}</H>
        <Card>
          <Dim style={{ marginBottom: 10 }}>
            {Platform.OS === 'ios'
              ? 'Lock screen, AirPods and CarPlay already have ⟲40s and Next chapter. For your own Siri phrases: Shortcuts app ▸ + ▸ add action “Open URLs” ▸ paste a link below ▸ name it (e.g. “Rewind book”). Then say “Hey Siri, rewind book”.'
              : 'Lock screen and headphone controls already include ⟲40s and Next chapter. For voice or home-screen shortcuts, use a Google Assistant routine or a shortcut app with “Open URL” and paste a link below.'}
          </Dim>
          {REMOTE_LINKS.map(([label, url]) => (
            <View key={url} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderColor: C.line }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontWeight: '600' }}>{label}</Text>
                <Text selectable style={{ color: C.accent, fontSize: 13 }}>{url}</Text>
              </View>
              <Btn small kind="ghost" title="Test" onPress={() => void handleRemoteUrl(url)} />
            </View>
          ))}
          <Dim style={{ marginTop: 8 }}>Add ?s=60 to a rewind/forward link for a different jump, e.g. bookvoice://rewind?s=60</Dim>
        </Card>

        <Pressable onPress={() => setAdv(!adv)}><H>{adv ? '▾' : '▸'} Advanced</H></Pressable>
        {adv ? (
          <Card>
            <Field label="Speech model" value={s.ttsModel} onChangeText={(t) => update({ ttsModel: t.trim() })} autoCapitalize="none" />
            <Field label="Text model (adapting + PDF reading)" value={s.textModel} onChangeText={(t) => update({ textModel: t.trim() })} autoCapitalize="none" />
            <Dim style={{ marginBottom: 8 }}>Parallel requests (raise if your quota allows; lower if you hit rate limits)</Dim>
            <View style={{ flexDirection: 'row' }}>
              {[1, 2, 3, 4].map((n) => <Chip key={n} label={String(n)} on={s.concurrency === n} onPress={() => update({ concurrency: n })} />)}
            </View>
            <Dim style={{ marginBottom: 8 }}>Characters per speech request</Dim>
            <View style={{ flexDirection: 'row' }}>
              {[1000, 1800, 2600].map((n) => <Chip key={n} label={String(n)} on={s.chunkChars === n} onPress={() => update({ chunkChars: n })} />)}
            </View>
            <Dim>Audio is saved as lossless 16-bit WAV at the voice's native sample rate (24 kHz), about 170 MB per hour.</Dim>
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Row(p: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={{ color: C.text, fontWeight: '600' }}>{p.label}</Text>
        {p.hint ? <Dim style={{ marginTop: 2 }}>{p.hint}</Dim> : null}
      </View>
      {p.children}
    </View>
  );
}

function DesignVoiceCard(p: {
  s: Settings;
  gKey: string;
  target: 'voice' | 'dialogueVoice';
  current: VoiceChoice;
  update: (patch: Partial<Settings>) => void;
  pickVoice: (v: VoiceChoice) => void;
  play: (uri: string) => void;
}) {
  const [preset, setPreset] = useState(0);
  const [name, setName] = useState(DESIGN_PRESETS[0].name);
  const [desc, setDesc] = useState(DESIGN_PRESETS[0].text);
  const [busy, setBusy] = useState(false);
  const mine = p.s.myVoices || [];

  const choosePreset = (i: number) => {
    setPreset(i);
    setName(DESIGN_PRESETS[i].name);
    setDesc(DESIGN_PRESETS[i].text);
  };

  const create = async () => {
    if (!p.gKey) return Alert.alert('Gemini key needed', 'Add your Gemini API key above first.');
    if (desc.trim().length < 20) return Alert.alert('Describe the voice', 'Write a sentence or two: age, accent, tone, texture, pace.');
    setBusy(true);
    try {
      await setKey('gemini', p.gKey);
      const pr = DESIGN_PRESETS[preset];
      const usePresetMeta = pr.text === desc;
      const { voice, sample } = await designVoice(p.gKey, {
        description: desc.trim(),
        name: name.trim() || 'My voice',
        gender: usePresetMeta ? pr.gender : undefined,
        languageCode: usePresetMeta ? pr.lang : undefined,
      });
      p.update({ myVoices: [voice, ...mine] });
      p.pickVoice({ id: voice.id, label: voice.label, prebuilt: false });
      if (sample) p.play((await audioToWavFile(sample)).uri);
    } catch (e: any) {
      Alert.alert('Could not create voice', e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = (id: string) =>
    Alert.alert('Delete this voice?', 'Chapters already recorded keep their audio.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deleteDesignedVoice(p.gKey, id);
          p.update({ myVoices: mine.filter((v) => v.id !== id) });
        },
      },
    ]);

  return (
    <Card>
      <Text style={{ color: C.text, fontWeight: '700', marginBottom: 4 }}>Design a voice</Text>
      <Dim style={{ marginBottom: 10 }}>Describe a brand-new voice and Gemini creates it. Start from a preset and change the words: age, accent, tone, texture, pace.</Dim>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {DESIGN_PRESETS.map((d, i) => <Chip key={d.name} label={d.name} on={preset === i && desc === d.text} onPress={() => choosePreset(i)} />)}
      </View>
      <Field label="Description" multiline value={desc} onChangeText={setDesc} />
      <Field label="Name" value={name} onChangeText={setName} />
      <Btn title={busy ? 'Creating voice…' : 'Create voice'} busy={busy} onPress={create} />

      {mine.length ? <Dim style={{ marginTop: 14, marginBottom: 4 }}>My voices — tap to use for the {p.target === 'voice' ? 'narrator' : 'dialogue'}, long-press to delete</Dim> : null}
      {mine.map((v) => (
        <Pressable
          key={v.id}
          onPress={() => p.pickVoice({ id: v.id, label: v.label, prebuilt: false })}
          onLongPress={() => remove(v.id)}
          style={{ paddingVertical: 10, borderBottomWidth: 1, borderColor: C.line }}
        >
          <Text style={{ color: p.current.id === v.id ? C.accent : C.text, fontWeight: '600' }}>{v.label}</Text>
          <Dim numberOfLines={2}>{v.description}</Dim>
        </Pressable>
      ))}
    </Card>
  );
}
