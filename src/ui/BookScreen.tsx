import React, { useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, FlatList, Platform, Pressable, Text, View } from 'react-native';
import { formatBytes, formatDuration } from '../lib/bytes';
import { bookPercent, converter, resetChapter } from '../lib/converter';
import { fmtEta } from '../lib/background';
import { timeLabel } from '../lib/errors';
import { profileFromSettings, profileLabel } from '../lib/speech';
import { ConvertSheet } from './ConvertSheet';
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
  const [pick, setPick] = useState(false);
  useEffect(() => void loadSettings().then((s) => setVoice(profileLabel(book?.profile || profileFromSettings(s)))), [book?.profile, pick]);
  if (!book) return <Header title="" onBack={p.onBack} />;

  const done = book.chapters.filter((c) => c.status === 'done').length;
  const total = book.chapters.length;
  const pr = conv.books[book.id];
  const mine = !!pr && (pr.state === 'reading' || pr.state === 'recording');
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
      ['Record this chapter', () => void converter.enqueue(book.id, { chapters: [i] })],
      ['Re-record with this book’s voice', () => { resetChapter(book, i, true); void converter.enqueue(book.id, { chapters: [i] }); }],
      ['Re-adapt text + re-record', () => { resetChapter(book, i, false); void converter.enqueue(book.id, { chapters: [i] }); }],
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
              <Pressable onPress={() => setPick(true)}>
                <Dim style={{ marginBottom: 10 }} numberOfLines={2}>Voice: {voice}  <Text style={{ color: C.accent }}>Change</Text></Dim>
              </Pressable>
              {pr && pr.state !== 'done' ? (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <Text style={{ color: C.text, flex: 1 }} numberOfLines={2}>{pr.message}</Text>
                    <Text style={{ color: C.accent, fontSize: 20, fontWeight: '800' }}>{Math.floor(pr.percent * 100)}%</Text>
                  </View>
                  <Bar value={pr.percent} color={pr.state === 'error' ? C.red : C.accent} />
                  <Dim style={{ marginTop: 6, marginBottom: 12, color: pr.state === 'error' ? C.red : C.dim }}>
                    {pr.state === 'waiting' && pr.waitUntil ? `Paused · carries on at ${timeLabel(pr.waitUntil)}` : pr.state === 'queued' ? 'In the queue' : pr.state === 'error' ? pr.error : `Keeps going in the background${pr.eta ? ` · ~${fmtEta(pr.eta)} left` : ''}`}
                  </Dim>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Btn style={{ flex: 1 }} title="Stop converting" kind="ghost" onPress={() => converter.stop(book.id)} />
                    {done > 0 ? <Btn title="▶" kind="ghost" onPress={resume} /> : null}
                  </View>
                </>
              ) : (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Btn
                    style={{ flex: 1 }}
                    title={done === total ? (book.position ? `▶  Continue · Ch ${book.position.chapter + 1}` : '▶  Play') : done ? 'Continue converting' : 'Convert to audio'}
                    onPress={() => (done === total ? resume() : done ? void converter.enqueue(book.id) : setPick(true))}
                  />
                  {done > 0 && done < total ? <Btn title="▶" kind="ghost" onPress={resume} /> : null}
                </View>
              )}
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
            active={mine && pr?.chapter === index}
            playing={play.book?.id === book.id && play.chapter === index}
            onPress={() => (item.status === 'done' ? playFrom(index) : chapterMenu(index))}
            onLong={() => chapterMenu(index)}
          />
        )}
      />
      {pick ? <ConvertSheet bookIds={[book.id]} onClose={() => setPick(false)} /> : null}
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
