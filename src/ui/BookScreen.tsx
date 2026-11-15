import React, { useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, FlatList, Platform, Pressable, Text, View } from 'react-native';
import { formatBytes, formatDuration } from '../lib/bytes';
import { converter, resetChapter, voiceLabel } from '../lib/converter';
import { exportToFolder, shareChapter } from '../lib/exporter';
import { playback } from '../lib/playback';
import { bookAudioBytes, loadSettings } from '../lib/storage';
import { Chapter } from '../lib/types';
import { useBook, useConverter, usePlayback } from './hooks';
import { Bar, Btn, C, Card, Dim, Header } from './kit';

export function BookScreen(p: { id: string; onBack: () => void; openPlayer: () => void; openText: (i: number) => void }) {
  const book = useBook(p.id);
  const conv = useConverter();
  const play = usePlayback();
  const [voice, setVoice] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);
  useEffect(() => void loadSettings().then((s) => setVoice(voiceLabel(s))), [conv.running]);
  if (!book) return <Header title="" onBack={p.onBack} />;

  const done = book.chapters.filter((c) => c.status === 'done').length;
  const total = book.chapters.length;
  const mine = conv.running && conv.bookId === book.id;
  const queued = converter.isQueued(book.id);
  const dur = book.chapters.reduce((s, c) => s + (c.durationSec || 0), 0);

  const resume = async () => {
    try {
      await playback.resumeBook(book.id);
      p.openPlayer();
    } catch (e: any) {
      Alert.alert('Not ready', e.message);
    }
  };
  const playFrom = async (i: number) => {
    try {
      await playback.open(book.id, i);
      p.openPlayer();
    } catch (e: any) {
      Alert.alert('Not ready', e.message);
    }
  };

  const chapterMenu = (i: number) => {
    const ch = book.chapters[i];
    const opts: [string, () => void][] = [
      ['View text', () => p.openText(i)],
      ['Record this chapter now', () => converter.enqueue({ bookId: book.id, chapters: [i] })],
      ['Re-record with current voice', () => { resetChapter(book, i, true); converter.enqueue({ bookId: book.id, chapters: [i] }); }],
      ['Re-adapt text + re-record', () => { resetChapter(book, i, false); converter.enqueue({ bookId: book.id, chapters: [i] }); }],
    ];
    if (ch.status === 'done') opts.push(['Share / save audio file', () => shareChapter(book, i).catch((e) => Alert.alert('Share failed', e.message))]);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ title: ch.title, options: [...opts.map((o) => o[0]), 'Cancel'], cancelButtonIndex: opts.length }, (k) => opts[k]?.[1]());
    } else {
      Alert.alert(ch.title, undefined, [...opts.map(([text, onPress]) => ({ text, onPress })), { text: 'Cancel', style: 'cancel' as const }]);
    }
  };

  const doExport = async () => {
    try {
      setExporting('Choose a folder…');
      const n = await exportToFolder(book, (d, t) => setExporting(`Copying ${d}/${t}…`));
      Alert.alert('Exported', `${n} chapter files saved (lossless WAV).`);
    } catch (e: any) {
      if (!/cancel/i.test(e?.message || '')) Alert.alert('Export failed', e?.message || String(e));
    } finally {
      setExporting(null);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Header title="" onBack={p.onBack} />
      <FlatList
        contentContainerStyle={{ padding: 16, paddingTop: 0 }}
        data={book.chapters}
        keyExtractor={(c) => c.id}
        ListHeaderComponent={
          <View>
            <Text style={{ color: C.text, fontSize: 24, fontWeight: '800' }}>{book.title}</Text>
            {book.author ? <Dim style={{ fontSize: 15, marginTop: 2 }}>{book.author}</Dim> : null}
            <Dim style={{ marginTop: 6 }}>
              {done}/{total} chapters recorded{dur ? ` · ${formatDuration(dur)}` : ''}{done ? ` · ${formatBytes(bookAudioBytes(book))}` : ''}
            </Dim>
            <Card style={{ marginTop: 14 }}>
              <Dim style={{ marginBottom: 10 }} numberOfLines={2}>Voice: {voice}</Dim>
              {mine ? (
                <>
                  <Text style={{ color: C.text, marginBottom: 8 }} numberOfLines={2}>{conv.message}</Text>
                  <Bar value={conv.total ? (conv.done || 0) / conv.total : 0} />
                  <Dim style={{ marginTop: 6, marginBottom: 12 }}>
                    {conv.phase === 'script' ? 'Adapting text' : 'Recording'} {conv.done}/{conv.total} · keep the app open while converting
                  </Dim>
                  <Btn title="Pause converting" kind="ghost" onPress={() => converter.stop(book.id)} />
                </>
              ) : queued ? (
                <Btn title="Queued — tap to cancel" kind="ghost" onPress={() => converter.stop(book.id)} />
              ) : (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Btn
                    style={{ flex: 1 }}
                    title={done === total ? (book.position ? `▶  Continue · Ch ${book.position.chapter + 1}` : '▶  Play') : done ? 'Continue converting' : 'Convert to audio'}
                    onPress={() => (done === total ? resume() : converter.enqueue({ bookId: book.id }))}
                  />
                  {done > 0 && done < total ? <Btn title="▶" kind="ghost" onPress={resume} /> : null}
                </View>
              )}
              {conv.error && (mine || !conv.running) ? <Dim style={{ color: C.red, marginTop: 10 }}>{conv.error}</Dim> : null}
            </Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Dim>Tap to play · long-press for options</Dim>
              {done ? <Btn small kind="ghost" title={exporting || 'Export audio'} disabled={!!exporting} onPress={doExport} /> : null}
            </View>
          </View>
        }
        renderItem={({ item, index }) => (
          <ChapterRow
            ch={item}
            index={index}
            active={mine && conv.chapter === index}
            playing={play.book?.id === book.id && play.chapter === index}
            onPress={() => (item.status === 'done' ? playFrom(index) : chapterMenu(index))}
            onLong={() => chapterMenu(index)}
          />
        )}
      />
    </View>
  );
}

function ChapterRow(p: { ch: Chapter; index: number; active: boolean; playing: boolean; onPress: () => void; onLong: () => void }) {
  const { ch } = p;
  const status =
    ch.status === 'done' ? formatDuration(ch.durationSec || 0)
    : ch.status === 'error' ? 'Failed — long-press to retry'
    : ch.status === 'speaking' ? `Recording ${ch.chunksDone || 0}/${ch.chunksTotal || '?'}`
    : ch.status === 'scripting' ? 'Adapting text…'
    : ch.status === 'scripted' ? 'Text ready'
    : ch.pages ? `Pages ${ch.pages[0]}–${ch.pages[1]}` : 'Not recorded';
  return (
    <Pressable onPress={p.onPress} onLongPress={p.onLong} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderColor: C.line }}>
      <Text style={{ color: C.dim, width: 34, fontVariant: ['tabular-nums'] }}>{p.index + 1}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: p.playing ? C.accent : C.text, fontSize: 15, fontWeight: '600' }} numberOfLines={2}>{ch.title}</Text>
        <Dim style={{ marginTop: 2, color: ch.status === 'error' ? C.red : p.active ? C.accent : C.dim }} numberOfLines={2}>
          {ch.status === 'error' && ch.error ? `${status}: ${ch.error}` : status}
        </Dim>
      </View>
      <Text style={{ color: ch.status === 'done' ? C.green : C.line, fontSize: 18, marginLeft: 8 }}>{ch.status === 'done' ? '▶' : '○'}</Text>
    </Pressable>
  );
}
