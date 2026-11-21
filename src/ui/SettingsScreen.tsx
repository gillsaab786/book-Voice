import React, { useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { refreshBackgroundOptions } from '../lib/background';
import { makeBackup, restoreBackup } from '../lib/backup';
import { previewCount } from '../lib/previews';
import { setAccent } from './kit';
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
  const [prev, setPrev] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    void loadSettings().then(setS);
    void previewCount().then((c) => setPrev(`${c.have}/${c.total} Gemini voice samples saved`));
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
    void saveSettings(n).then(refreshBackgroundOptions);
  };
  const Toggle = (t: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={{ color: C.text, fontWeight: '600' }}>{t.label}</Text>
        <Dim style={{ marginTop: 2 }}>{t.hint}</Dim>
      </View>
      <Switch value={t.value} onValueChange={t.onChange} trackColor={{ true: C.accent }} />
    </View>
  );
  const backup = async () => {
    setBusy('backup');
    try {
      await makeBackup();
    } catch (e: any) {
      Alert.alert('Backup failed', e?.message || String(e));
    } finally {
      setBusy(null);
    }
  };
  const restore = async () => {
    setBusy('restore');
    try {
      const msg = await restoreBackup();
      if (msg) {
        const n = await loadSettings();
        setS(n);
        setAccent(n.accent);
        await refreshBackgroundOptions();
        Alert.alert('Restored', msg + ' Close and reopen the app to see every change.');
      }
    } catch (e: any) {
      Alert.alert('Restore failed', e?.message || String(e));
    } finally {
      setBusy(null);
    }
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

        <H>Background</H>
        <Card>
          <Toggle
            label="Keep converting in the background"
            hint="On by default — there’s no button to press. While books convert, the app keeps going when you switch apps or lock the phone (it plays silent audio, like iTorrent). Music from other apps still plays."
            value={s.backgroundWork !== false}
            onChange={(v) => update({ backgroundWork: v })}
          />
          {Platform.OS === 'ios' ? (
            <Toggle
              label="Progress on Lock Screen & Dynamic Island"
              hint="Shows each book’s percentage as a Live Activity while converting."
              value={s.liveActivity !== false}
              onChange={(v) => update({ liveActivity: v })}
            />
          ) : null}
          <Toggle
            label="Download voice samples"
            hint={`A few Gemini voice samples a day while the app is open, saved for free replay. ${prev}`}
            value={s.previewDownloads !== false}
            onChange={(v) => update({ previewDownloads: v })}
          />
          <Dim style={{ marginBottom: 10 }}>
            {Platform.OS === 'ios'
              ? 'If progress doesn’t show: iPhone Settings ▸ BookVoice ▸ turn on Live Activities (and Background App Refresh).'
              : 'If converting stops in the background: Phone settings ▸ Apps ▸ BookVoice ▸ Battery ▸ Unrestricted, and allow notifications.'}
          </Dim>
          <Btn title="Open phone settings for BookVoice" kind="ghost" onPress={() => void Linking.openSettings()} />
        </Card>

        <H>Backup & restore</H>
        <Card>
          <Dim style={{ marginBottom: 10 }}>
            One file with all your settings, voices you made and every key (Gemini, Azure, ElevenLabs and AI keys). Save it to Files, iCloud Drive or Google Drive. It contains your keys, so keep it private.
          </Dim>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Btn title="Back up" busy={busy === 'backup'} onPress={backup} style={{ flex: 1 }} />
            <Btn title="Restore" kind="ghost" busy={busy === 'restore'} onPress={restore} style={{ flex: 1 }} />
          </View>
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
