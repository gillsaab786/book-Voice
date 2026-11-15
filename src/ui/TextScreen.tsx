import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { chapterScriptFile, chapterTextFile, loadBook, loadSettings } from '../lib/storage';
import { ReadTheme, resolveTheme, THEMES } from './readThemes';
import { Segment } from '../lib/types';
import { C, Chip, Dim, Header } from './kit';

/** Reader view: the original chapter text, or the narration script Gemini prepared. */
export function TextScreen(p: { bookId: string; index: number; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [original, setOriginal] = useState<string | null>(null);
  const [script, setScript] = useState<Segment[] | null>(null);
  const [mode, setMode] = useState<'original' | 'script'>('original');
  const [size, setSize] = useState(18);
  const [theme, setTheme] = useState<ReadTheme>(THEMES.dark);
  useEffect(() => void loadSettings().then((c) => { setTheme(resolveTheme(c.readTheme)); setSize(c.readFontSize); }), []);

  useEffect(() => {
    (async () => {
      const b = await loadBook(p.bookId);
      setTitle(b.chapters[p.index]?.title || '');
      const t = chapterTextFile(p.bookId, p.index);
      if (t.exists) setOriginal(await t.text());
      const s = chapterScriptFile(p.bookId, p.index);
      if (s.exists) setScript(JSON.parse(await s.text()));
      if (!t.exists) setMode('script');
    })();
  }, [p.bookId, p.index]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <Header title={title} onBack={p.onBack} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16 }}>
        {original !== null ? <Chip label="Book text" on={mode === 'original'} onPress={() => setMode('original')} /> : null}
        <Chip label="Narration script" on={mode === 'script'} onPress={() => setMode('script')} />
        <Chip label="A−" onPress={() => setSize((s) => Math.max(13, s - 2))} />
        <Chip label="A+" onPress={() => setSize((s) => Math.min(30, s + 2))} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        {mode === 'original' ? (
          <Text selectable style={{ color: theme.text, fontSize: size, lineHeight: size * 1.6 }}>{original}</Text>
        ) : script ? (
          script.map((s, i) => (
            <Text key={i} selectable style={{ color: s.speaker === 'DIALOGUE' ? theme.heading : theme.text, fontSize: size, lineHeight: size * 1.55, marginBottom: 10 }}>
              {s.style ? <Text style={{ color: theme.body, fontSize: 12 }}>[{s.style}] </Text> : null}
              {s.speaker === 'DIALOGUE' ? `“${s.text}”` : s.text}
            </Text>
          ))
        ) : (
          <Dim>The narration script is created when this chapter is converted.{original === null ? ' (PDF text is read by Gemini during conversion.)' : ''}</Dim>
        )}
      </ScrollView>
    </View>
  );
}
