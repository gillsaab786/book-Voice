import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, FlatList, Platform, Pressable, Text, View } from 'react-native';
import { chapterScriptFile, chapterTimingFile, loadBook } from '../lib/storage';
import { Cue, cueAt, cuesFromScript, wordAt } from '../lib/timing';
import { Dim } from './kit';
import { ReadTheme } from './readThemes';

type Para = { first: number; last: number };

const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: undefined });

/** The book page that follows the voice: current sentence lit, current word marked, auto-scrolling. */
export function ReadAlong(p: {
  bookId: string;
  chapter: number;
  time: number;
  duration: number;
  fontSize: number;
  theme: ReadTheme;
  onSeek: (t: number) => void;
  onDoubleTap: (side: 'left' | 'right') => void;
}) {
  const [cues, setCues] = useState<Cue[] | null>(null);
  const [title, setTitle] = useState('');
  const list = useRef<FlatList<Para>>(null);
  const userScrollAt = useRef(0);
  const lastTap = useRef({ t: 0, x: 0 });
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ripple, setRipple] = useState<'left' | 'right' | null>(null);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let alive = true;
    setCues(null);
    (async () => {
      const b = await loadBook(p.bookId);
      if (!alive) return;
      setTitle(b.chapters[p.chapter]?.title || '');
      const tf = chapterTimingFile(p.bookId, p.chapter);
      if (tf.exists) return setCues(JSON.parse(await tf.text()));
      const sf = chapterScriptFile(p.bookId, p.chapter);
      if (sf.exists) return setCues(cuesFromScript(JSON.parse(await sf.text()), b.chapters[p.chapter]?.durationSec || p.duration));
      setCues([]);
    })().catch(() => setCues([]));
    return () => {
      alive = false;
    };
  }, [p.bookId, p.chapter]);

  const paras = useMemo<Para[]>(() => {
    const out: Para[] = [];
    (cues || []).forEach((c, i) => {
      const last = out[out.length - 1];
      if (last && cues![last.first].p === c.p) last.last = i;
      else out.push({ first: i, last: i });
    });
    return out;
  }, [cues]);

  const active = cues ? cueAt(cues, p.time + 0.15) : -1;
  const activePara = useMemo(() => paras.findIndex((x) => active >= x.first && active <= x.last), [paras, active]);
  const word =
    cues && active >= 0
      ? wordAt(cues[active].s, cues[active].t, cues[active + 1]?.t ?? p.duration, p.time + 0.15)
      : -1;

  useEffect(() => {
    if (activePara < 0 || Date.now() - userScrollAt.current < 4000) return;
    list.current?.scrollToIndex({ index: activePara, viewPosition: 0.3, animated: true });
  }, [activePara]);

  const tap = (pageX: number, single?: () => void) => {
    const now = Date.now();
    const w = Dimensions.get('window').width;
    if (now - lastTap.current.t < 300 && Math.abs(pageX - lastTap.current.x) < 80) {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      lastTap.current.t = 0;
      const side = pageX < w / 2 ? 'left' : 'right';
      p.onDoubleTap(side);
      setRipple(side);
      fade.setValue(1);
      Animated.timing(fade, { toValue: 0, duration: 700, useNativeDriver: true }).start(() => setRipple(null));
      return;
    }
    lastTap.current = { t: now, x: pageX };
    if (single) {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      tapTimer.current = setTimeout(single, 300);
    }
  };

  if (cues === null) return <View style={{ flex: 1 }} />;
  if (!cues.length)
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <Dim style={{ textAlign: 'center' }}>Text for this chapter isn’t available yet.</Dim>
      </View>
    );

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={list}
        data={paras}
        keyExtractor={(x) => String(x.first)}
        contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 12, paddingBottom: 220 }}
        ListHeaderComponent={<Text style={{ color: p.theme.heading, fontSize: p.fontSize * 0.8, fontWeight: '800', marginBottom: 18 }}>{title}</Text>}
        onScrollBeginDrag={() => (userScrollAt.current = Date.now())}
        onScrollToIndexFailed={(e) => {
          list.current?.scrollToOffset({ offset: e.averageItemLength * e.index, animated: false });
          setTimeout(() => list.current?.scrollToIndex({ index: e.index, viewPosition: 0.3, animated: true }), 120);
        }}
        initialNumToRender={20}
        windowSize={11}
        renderItem={({ item, index }) => (
          <Paragraph
            cues={cues}
            para={item}
            active={index === activePara ? active : -1}
            word={index === activePara ? word : -1}
            fontSize={p.fontSize}
            theme={p.theme}
            onSentence={(t, x) => tap(x, () => p.onSeek(t))}
            onBlank={(x) => tap(x)}
          />
        )}
      />
      {ripple ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute', top: '35%', [ripple]: 24, opacity: fade,
            backgroundColor: 'rgba(128,128,128,0.22)', borderRadius: 60, width: 120, height: 120, alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ color: p.theme.text, fontSize: 22, fontWeight: '800' }}>{ripple === 'left' ? '⟲ 40s' : '40s ⟳'}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const Paragraph = memo(function Paragraph(p: {
  cues: Cue[];
  para: Para;
  active: number;
  word: number;
  fontSize: number;
  theme: ReadTheme;
  onSentence: (t: number, pageX: number) => void;
  onBlank: (pageX: number) => void;
}) {
  const fs = p.fontSize;
  const isDialogue = p.cues[p.para.first].d;
  const parts: React.ReactNode[] = [];
  for (let i = p.para.first; i <= p.para.last; i++) {
    const c = p.cues[i];
    const on = i === p.active;
    parts.push(
      <Text
        key={i}
        onPress={(e) => p.onSentence(c.t, e.nativeEvent.pageX)}
        style={on ? { color: p.theme.text, backgroundColor: p.theme.sentenceBg } : { color: p.theme.body }}
      >
        {on && p.word >= 0
          ? c.s.split(' ').map((w, k, arr) => (
              <Text key={k} style={k === p.word ? { color: p.theme.wordText, backgroundColor: p.theme.wordBg } : undefined}>
                {w}
                {k < arr.length - 1 ? ' ' : ''}
              </Text>
            ))
          : c.s}
        {i < p.para.last ? ' ' : ''}
      </Text>
    );
  }
  return (
    <Pressable onPress={(e) => p.onBlank(e.nativeEvent.pageX)} style={{ marginBottom: fs * 0.9 }}>
      <Text
        style={{
          fontSize: fs,
          lineHeight: Math.round(fs * 1.62),
          fontFamily: SERIF,
          color: p.theme.body,
          ...(isDialogue ? { fontStyle: 'italic' as const } : {}),
        }}
      >
        {isDialogue ? '“' : ''}
        {parts}
        {isDialogue ? '”' : ''}
      </Text>
    </Pressable>
  );
});
