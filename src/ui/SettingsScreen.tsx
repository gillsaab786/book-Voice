import React, { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { handleRemoteUrl, REMOTE_LINKS } from '../lib/remote';
import { ENGINE_NAMES, profileFromSettings, profileLabel } from '../lib/speech';
import { loadKeys } from '../lib/ai';
import { getKey, loadSettings, saveSettings } from '../lib/storage';
import { Settings } from '../lib/types';
import { Btn, C, Card, Chip, Dim, Field, Glass, H, Header } from './kit';

export type SettingsPage = 'keys' | 'voices' | 'appearance';

export function SettingsScreen({ onBack, open }: { onBack: () => void; open: (p: SettingsPage) => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [adv, setAdv] = useState(false);
  const [keyLine, setKeyLine] = useState('');
  useEffect(() => {
    void loadSettings().then(setS);
    void (async () => {
      const g = await getKey('gemini');
      const n = (await loadKeys()).length;
      setKeyLine(`${g ? 'Gemini' : 'No Gemini key'} · ${n} more key${n === 1 ? '' : 's'}`);
    })();
  }, []);
  if (!s) return null;
  const update = (patch: Partial<Settings>) => {
    const n = { ...s, ...patch };
    setS(n);
    void saveSettings(n);
  };

  const Row = (r: { title: string; sub: string; page: SettingsPage }) => (
    <Pressable onPress={() => open(r.page)}>
      <Glass style={{ padding: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>{r.title}</Text>
          <Dim numberOfLines={2} style={{ marginTop: 2 }}>{r.sub}</Dim>
        </View>
        <Text style={{ color: C.dim, fontSize: 22 }}>›</Text>
      </Glass>
    </Pressable>
  );

  return (
    <View style={{ flex: 1 }}>
      <Header title="Settings" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
        <Row title="AI keys" sub={keyLine} page="keys" />
        <Row title="Voices" sub={`${ENGINE_NAMES[profileFromSettings(s).engine]} · ${profileLabel(profileFromSettings(s))}`} page="voices" />
        <Row title="Appearance & app icon" sub={`${s.accent} accent`} page="appearance" />

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
