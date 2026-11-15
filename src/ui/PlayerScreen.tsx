import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useEffect, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { loadSettings, saveSettings } from '../lib/storage';
import { Settings } from '../lib/types';
import { resolveTheme, THEME_ORDER, ThemeId, themeLabel, THEMES } from './readThemes';
import { formatDuration } from '../lib/bytes';
import { playback, SKIP_SEC } from '../lib/playback';
import { usePlayback } from './hooks';
import { C, Dim, Header } from './kit';
import { ReadAlong } from './ReadAlong';

const RATES = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const SLEEP: (number | 'chapter' | null)[] = [null, 15, 30, 45, 60, 'chapter'];

export function PlayerScreen(p: { onBack: () => void; openText: (bookId: string, i: number) => void }) {
  const st = usePlayback();
  const insets = useSafeAreaInsets();
  const [w, setW] = useState(1);
  const [sleepIdx, setSleepIdx] = useState(0);
  const [cfg, setCfg] = useState<Settings | null>(null);
  const [showLook, setShowLook] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => void loadSettings().then(setCfg), []);
  // re-check auto theme every minute (switches to OLED Night at 8 pm)
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 60e3);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!cfg?.keepAwake) return;
    void activateKeepAwakeAsync('reader').catch(() => {});
    return () => {
      void deactivateKeepAwake('reader');
    };
  }, [cfg?.keepAwake]);
  const set = (patch: Partial<Settings>) => {
    if (!cfg) return;
    const n = { ...cfg, ...patch };
    setCfg(n);
    void saveSettings(n);
  };
  if (!st.book || !cfg) return <View style={{ flex: 1, paddingTop: insets.top }}><Header title="Nothing playing" onBack={p.onBack} /></View>;
  const theme = resolveTheme(cfg.readTheme as ThemeId);
  const font = cfg.readFontSize;
  const setFont = (f: (x: number) => number) => set({ readFontSize: f(font) });
  const ch = st.book.chapters[st.chapter];
  const frac = st.duration ? Math.min(1, st.time / st.duration) : 0;

  const Ctl = (q: { label: string; sub?: string; onPress: () => void; big?: boolean }) => (
    <Pressable onPress={q.onPress} hitSlop={8} style={({ pressed }) => ({ padding: 8, alignItems: 'center', minWidth: 56, opacity: pressed ? 0.5 : 1 })}>
      <Text style={{ color: q.big ? theme.heading : theme.panelText, fontSize: q.big ? 44 : 24, fontWeight: '700' }}>{q.label}</Text>
      {q.sub ? <Text style={{ color: theme.panelText, opacity: 0.6, fontSize: 11, marginTop: -2 }}>{q.sub}</Text> : null}
    </Pressable>
  );
  const Pill = (q: { label: string; onPress: () => void; on?: boolean }) => (
    <Pressable onPress={q.onPress} style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: theme.line, backgroundColor: q.on ? theme.wordBg : 'transparent' }}>
      <Text style={{ color: q.on ? theme.wordText : theme.panelText, fontSize: 13, fontWeight: '700' }}>{q.label}</Text>
    </Pressable>
  );

  const cycleRate = () => {
    const i = RATES.findIndex((r) => Math.abs(r - st.rate) < 0.01);
    void playback.setRate(RATES[(i + 1) % RATES.length]);
  };
  const cycleSleep = () => {
    const n = (sleepIdx + 1) % SLEEP.length;
    setSleepIdx(n);
    playback.setSleep(SLEEP[n]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <StatusBar style={theme.statusBar} />
      <Header
        title=""
        onBack={p.onBack}
        right={
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Pill label="◐" onPress={() => setShowLook((v) => !v)} on={showLook} />
            <Pill label="A−" onPress={() => setFont((f) => Math.max(15, f - 2))} />
            <Pill label="A+" onPress={() => setFont((f) => Math.min(34, f + 2))} />
          </View>
        }
      />
      <View style={{ paddingHorizontal: 22, marginTop: -6 }}>
        <Dim numberOfLines={1} style={{ color: theme.panelText, opacity: 0.6 }}>
          {st.book.title} · Chapter {st.chapter + 1} of {st.book.chapters.length}
        </Dim>
      </View>

      <ReadAlong
        bookId={st.book.id}
        chapter={st.chapter}
        time={st.time}
        duration={st.duration}
        fontSize={font}
        theme={theme}
        onSeek={(t) => playback.seekTo(t)}
        onDoubleTap={(side) => playback.seekBy(side === 'left' ? -SKIP_SEC : SKIP_SEC)}
      />

      {showLook ? (
        <View style={{ backgroundColor: theme.panel, borderTopWidth: 1, borderColor: theme.line, padding: 14 }}>
          <Text style={{ color: theme.panelText, fontWeight: '700', marginBottom: 8 }}>Reading theme</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {THEME_ORDER.map((id) => {
              const t = id === 'auto' ? resolveTheme('auto') : THEMES[id];
              const on = cfg.readTheme === id;
              return (
                <Pressable key={id} onPress={() => set({ readTheme: id })}
                  style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: t.bg, borderWidth: on ? 2 : 1, borderColor: on ? theme.heading : theme.line }}>
                  <Text style={{ color: t.text, fontWeight: '700', fontSize: 13 }}>{themeLabel(id)}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={{ color: theme.panelText, fontWeight: '700', marginTop: 14, marginBottom: 8 }}>Extra dimming {Math.round(cfg.readDim * 100)}%</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[0, 0.2, 0.35, 0.5, 0.65].map((d) => <Pill key={d} label={d ? `${Math.round(d * 100)}%` : 'Off'} on={Math.abs(cfg.readDim - d) < 0.01} onPress={() => set({ readDim: d })} />)}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14 }}>
            <Text style={{ color: theme.panelText, flex: 1 }}>Keep screen on while reading along</Text>
            <Switch value={cfg.keepAwake} onValueChange={(v) => set({ keepAwake: v })} trackColor={{ true: theme.heading }} />
          </View>
        </View>
      ) : null}

      <View style={{ backgroundColor: theme.panel, borderTopWidth: 1, borderColor: theme.line, paddingHorizontal: 18, paddingTop: 6, paddingBottom: 10 }}>
        <Text numberOfLines={1} style={{ color: theme.panelText, fontWeight: '700', marginTop: 4 }}>{ch?.title}</Text>
        <Pressable
          onLayout={(e) => setW(e.nativeEvent.layout.width)}
          onPress={(e) => playback.seekTo((e.nativeEvent.locationX / w) * st.duration)}
          style={{ paddingVertical: 10 }}
        >
          <View style={{ height: 5, borderRadius: 3, backgroundColor: theme.line }}>
            <View style={{ height: 5, borderRadius: 3, width: `${frac * 100}%`, backgroundColor: theme.heading }} />
          </View>
        </Pressable>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 }}>
          <Dim style={{ fontVariant: ['tabular-nums'], color: theme.panelText, opacity: 0.6 }}>{formatDuration(st.time)}</Dim>
          <Dim style={{ fontVariant: ['tabular-nums'], color: theme.panelText, opacity: 0.6 }}>-{formatDuration(Math.max(0, st.duration - st.time) / st.rate)}</Dim>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
          <Ctl label="⏮" sub="chapter" onPress={() => playback.next(-1)} />
          <Ctl label="⟲" sub={`${SKIP_SEC}s`} onPress={() => playback.seekBy(-SKIP_SEC)} />
          <Ctl big label={st.playing ? '❚❚' : '▶'} onPress={() => playback.toggle()} />
          <Ctl label="⟳" sub={`${SKIP_SEC}s`} onPress={() => playback.seekBy(SKIP_SEC)} />
          <Ctl label="⏭" sub="chapter" onPress={() => playback.next(1)} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 6 }}>
          <Pill label={`${st.rate}×`} onPress={cycleRate} on={st.rate !== 1} />
          <Pill label={st.sleepLabel ? `☾ ${st.sleepLabel}` : '☾ Sleep'} onPress={cycleSleep} on={!!st.sleepLabel} />
          <Pill label="Book text" onPress={() => p.openText(st.book!.id, st.chapter)} />
        </View>
        <Dim style={{ textAlign: 'center', fontSize: 11, marginTop: 8, color: theme.panelText, opacity: 0.5 }}>Double-tap left or right of the page to jump {SKIP_SEC}s · tap a sentence to play from it</Dim>
      </View>
      {cfg.readDim > 0 ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#000', opacity: cfg.readDim }} />
      ) : null}
    </View>
  );
}
