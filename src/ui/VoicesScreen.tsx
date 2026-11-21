import { AudioPlayer, createAudioPlayer } from 'expo-audio';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { audioToWavFile } from '../lib/converter';
import { profileFromSettings } from '../lib/speech';
import { profileToSettings, VoicePicker } from './VoicePicker';
import { deleteDesignedVoice, designVoice, LibraryVoice, searchVoices } from '../lib/gemini';
import { getKey, loadSettings, saveSettings, setKey } from '../lib/storage';
import { DESIGN_PRESETS, LANGUAGES, PREBUILT_VOICES, Settings, STYLE_PRESETS, VoiceChoice } from '../lib/types';
import { Btn, C, Card, Chip, Dim, Field, H, Header } from './kit';
import { CloneVoiceCard } from './CloneVoiceCard';

export function VoicesScreen({ onBack }: { onBack: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [gKey, setGKey] = useState('');
  const [target, setTarget] = useState<'voice' | 'dialogueVoice'>('voice');
  const [lib, setLib] = useState<LibraryVoice[] | null>(null);
  const [libQ, setLibQ] = useState({ language: 'pa-IN', gender: '', search: '' });
  const [libBusy, setLibBusy] = useState(false);
  const player = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    loadSettings().then(setS);
    getKey('gemini').then((k) => setGKey(k || ''));
    return () => player.current?.remove();
  }, []);
  if (!s) return null;

  const update = (patch: Partial<Settings>) => {
    const n = { ...s, ...patch };
    setS(n);
    void saveSettings(n);
  };
  const pickVoice = (v: VoiceChoice) => update({ [target]: v, engine: 'gemini', provider: 'gemini' } as Partial<Settings>);

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
      <Header title="Voices" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
        <H>Default voice for new books</H>
        <Card>
          <VoicePicker value={profileFromSettings(s)} onChange={(p) => { const n = profileToSettings(s, p); setS(n); void saveSettings(n); }} />
        </Card>

        <H>Gemini voice tools</H>
        <Dim style={{ marginBottom: 10 }}>Voices you design, copy or find here appear under “My voices” for Gemini.</Dim>
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
