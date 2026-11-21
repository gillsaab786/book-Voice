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
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { listBooks } from '../lib/storage';
import { loadUsage } from '../lib/ai';
import { ModelRanking } from './ModelRanking';

export type SettingsPage = 'keys' | 'voices' | 'appearance';
type Sub = 'background' | 'backup' | 'shortcuts' | 'advanced' | 'models';
type Stats = { books: number; hours: number; gTts: number; gText: number; azure: number; keys: number };

export function SettingsScreen({ onBack, open }: { onBack: () => void; open: (p: SettingsPage) => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [sub, setSub] = useState<Sub | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [keyLine, setKeyLine] = useState('');
  const [prev, setPrev] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    void loadSettings().then(setS);
    void previewCount().then((c) => setPrev(`${c.have}/${c.total} Gemini voice samples saved`));
    void (async () => {
      const bs = await listBooks();
      const u = await loadUsage();
      const secs = bs.reduce((a, b) => a + b.chapters.reduce((x, c) => x + (c.durationSec || 0), 0), 0);
      setStats({
        books: bs.filter((b) => b.chapters.length && b.chapters.every((c) => c.status === 'done')).length,
        hours: secs / 3600,
        gTts: u.counts['gemini-tts'] || 0,
        gText: u.counts['gemini-text'] || 0,
        azure: u.counts['azure-tts'] || 0,
        keys: (await loadKeys()).length,
      });
    })();
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

  const TITLES: Record<Sub, string> = {
    background: 'Background',
    backup: 'Backup & restore',
    shortcuts: Platform.OS === 'ios' ? 'Siri & Shortcuts' : 'Assistant & shortcuts',
    advanced: 'Advanced',
    models: 'Compare voices',
  };

  if (sub) {
    return (
      <View style={{ flex: 1 }}>
        <Header title={TITLES[sub]} onBack={() => setSub(null)} />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
          {sub === 'background' ? (
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

          ) : null}
          {sub === 'backup' ? (
        <Card>
          <Dim style={{ marginBottom: 10 }}>
            One file with all your settings, voices you made and every key (Gemini, Azure, ElevenLabs and AI keys). Save it to Files, iCloud Drive or Google Drive. It contains your keys, so keep it private.
          </Dim>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Btn title="Back up" busy={busy === 'backup'} onPress={backup} style={{ flex: 1 }} />
            <Btn title="Restore" kind="ghost" busy={busy === 'restore'} onPress={restore} style={{ flex: 1 }} />
          </View>
        </Card>

          ) : null}
          {sub === 'shortcuts' ? (
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

          ) : null}
          {sub === 'advanced' ? (
          <Card>
            <Field label="Speech model" value={s.ttsModel} onChangeText={(t) => update({ ttsModel: t.trim() })} autoCapitalize="none" />
            <Field label="Text model (adapting + PDF reading)" value={s.textModel} onChangeText={(t) => update({ textModel: t.trim() })} autoCapitalize="none" />
            <Dim style={{ marginBottom: 8 }}>Parallel requests (raise if your quota allows; lower if you hit rate limits)</Dim>
            <View style={{ flexDirection: 'row' }}>
              {[1, 2, 3, 4].map((n) => <Chip key={n} label={String(n)} on={s.concurrency === n} onPress={() => update({ concurrency: n })} />)}
            </View>
            <Dim style={{ marginBottom: 8 }}>Characters per Gemini voice request — bigger = more audio from the same daily allowance. If Gemini cuts one short, the app splits it and lowers this by itself. Now: {s.chunkChars}</Dim>
            <View style={{ flexDirection: 'row' }}>
              {[2000, 3000, 4500, 6000].map((n) => <Chip key={n} label={String(n)} on={s.chunkChars === n} onPress={() => update({ chunkChars: n })} />)}
            </View>
            <Dim>Audio is saved as lossless 16-bit WAV at the voice's native sample rate (24 kHz), about 170 MB per hour.</Dim>
          </Card>
          ) : null}
          {sub === 'models' ? (
            <>
              <Dim style={{ marginBottom: 12 }}>Best to worst, judged on how human the voice sounds and how fast a whole book gets done on free allowances. You choose the voice for each book when you queue it.</Dim>
              <Card>
                <ModelRanking />
              </Card>
              <Dim>Tip: run books on different services at the same time — e.g. one on Gemini Flash, one on Flash-Lite, one on Azure.</Dim>
            </>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  /** iOS-style grouped row with a coloured icon tile (like Now Feed+). */
  const Item = (r: { icon: any; color: string; title: string; sub?: string; onPress: () => void; last?: boolean }) => (
    <Pressable onPress={r.onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 14 }}>
        <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: r.color, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
          <Ionicons name={r.icon} size={18} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontSize: 16, fontWeight: '600' }}>{r.title}</Text>
          {r.sub ? <Dim numberOfLines={1} style={{ marginTop: 1 }}>{r.sub}</Dim> : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={C.dim} />
      </View>
      {!r.last ? <View style={{ height: 0.5, backgroundColor: 'rgba(255,255,255,0.12)', marginLeft: 58 }} /> : null}
    </Pressable>
  );
  const Group = (g: { title: string; children: React.ReactNode }) => (
    <>
      <Text style={{ color: C.dim, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, marginTop: 14, marginBottom: 6, marginLeft: 6 }}>{g.title.toUpperCase()}</Text>
      <Glass style={{ marginBottom: 4 }}>{g.children}</Glass>
    </>
  );
  const prof = profileFromSettings(s);

  return (
    <View style={{ flex: 1 }}>
      <Header title="Settings" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
        {stats ? <Dashboard st={stats} /> : null}

        <Group title="Voices & AI">
          <Item icon="sparkles" color="#8E5CF7" title="AI keys" sub={keyLine} onPress={() => open('keys')} />
          <Item icon="mic" color="#FF9F0A" title="Voices" sub={`${ENGINE_NAMES[prof.engine]} · ${profileLabel(prof)}`} onPress={() => open('voices')} />
          <Item icon="stats-chart" color="#0A84FF" title="Compare voices" sub="Best to worst · quality and speed" onPress={() => setSub('models')} last />
        </Group>

        <Group title="Converting">
          <Item icon="moon" color="#5E5CE6" title="Background" sub={s.backgroundWork !== false ? 'Keeps converting in the background' : 'Only while the app is open'} onPress={() => setSub('background')} last />
        </Group>

        <Group title="Listening">
          <Item icon="mic-circle" color="#FF375F" title={TITLES.shortcuts} sub="Rewind 40 s, next chapter, play / pause" onPress={() => setSub('shortcuts')} last />
        </Group>

        <Group title="Look">
          <Item icon="color-palette" color="#FF2D55" title="Appearance & app icon" sub={`${s.accent} accent · 36 icons`} onPress={() => open('appearance')} last />
        </Group>

        <Group title="Data">
          <Item icon="cloud-upload" color="#30D158" title="Backup & restore" sub="All settings and keys in one file" onPress={() => setSub('backup')} />
          <Item icon="construct" color="#8E8E93" title="Advanced" sub="Models, parallel requests, request size" onPress={() => setSub('advanced')} last />
        </Group>

        <Dim style={{ textAlign: 'center', marginTop: 18 }}>BookVoice · build for Jas</Dim>
      </ScrollView>
    </View>
  );
}

/** Today at a glance: rings and bars in a dark terminal style. */
function Dashboard({ st }: { st: Stats }) {
  const Ring = (r: { value: number; max: number; label: string; color: string }) => {
    const pct = Math.min(1, r.value / r.max);
    const R = 28;
    const L = 2 * Math.PI * R;
    return (
      <View style={{ alignItems: 'center', flex: 1 }}>
        <View style={{ width: 70, height: 70, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={70} height={70} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
            <Circle cx={35} cy={35} r={R} stroke="rgba(255,255,255,0.08)" strokeWidth={7} fill="none" />
            <Circle cx={35} cy={35} r={R} stroke={r.color} strokeWidth={7} fill="none" strokeLinecap="round" strokeDasharray={`${L * pct} ${L}`} />
          </Svg>
          <Text style={{ color: C.text, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{r.value}</Text>
        </View>
        <Dim style={{ fontSize: 11, marginTop: 6, textAlign: 'center' }}>{r.label}</Dim>
      </View>
    );
  };
  return (
    <Glass style={{ padding: 14, marginBottom: 6 }}>
      <Text style={{ color: C.dim, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, marginBottom: 12 }}>TODAY</Text>
      <View style={{ flexDirection: 'row' }}>
        <Ring value={st.gTts} max={100} label={'Gemini voice\nrequests'} color="#30D158" />
        <Ring value={st.gText} max={500} label={'Gemini text\nrequests'} color="#0A84FF" />
        <Ring value={st.azure} max={200} label={'Azure\nrequests'} color="#FF9F0A" />
      </View>
      <View style={{ flexDirection: 'row', marginTop: 14, borderTopWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)', paddingTop: 12 }}>
        <Stat n={String(st.books)} label="books ready" />
        <Stat n={st.hours >= 10 ? st.hours.toFixed(0) : st.hours.toFixed(1)} label="hours of audio" />
        <Stat n={String(st.keys)} label="AI keys" />
      </View>
    </Glass>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ color: C.text, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{n}</Text>
      <Dim style={{ fontSize: 11 }}>{label}</Dim>
    </View>
  );
}
