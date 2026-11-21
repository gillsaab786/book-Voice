import React, { useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { fmtEta } from '../lib/background';
import { formatDuration } from '../lib/bytes';
import { bookPercent, converter } from '../lib/converter';
import { importBook, pickBooks } from '../lib/importer';
import { playback } from '../lib/playback';
import { deleteBook } from '../lib/storage';
import { Book } from '../lib/types';
import { ConvertSheet } from './ConvertSheet';
import { useBooks, useConverter } from './hooks';
import { Bar, Btn, C, Card, Dim, Glass, Header } from './kit';

export function LibraryScreen(p: { openBook: (id: string) => void; openSettings: () => void; openQueue: () => void }) {
  const [books, reload] = useBooks();
  const conv = useConverter();
  const [status, setStatus] = useState<string | null>(null);
  const [convert, setConvert] = useState<string[] | null>(null);

  const add = async () => {
    const assets = await pickBooks();
    const added: string[] = [];
    for (const a of assets) {
      try {
        setStatus(`Adding ${a.name}…`);
        const b = await importBook(a, (s) => setStatus(s));
        added.push(b.id);
        reload();
      } catch (e: any) {
        Alert.alert(`Couldn't add ${a.name}`, e?.message || String(e));
      }
    }
    setStatus(null);
    if (added.length) setConvert(added); // straight to "choose a voice & queue"
  };

  const menu = (b: Book) =>
    Alert.alert(b.title, undefined, [
      { text: converter.isQueued(b.id) ? 'Change voice' : 'Convert to audio', onPress: () => setConvert([b.id]) },
      {
        text: 'Delete book',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Delete book?', `“${b.title}” and all its audio will be removed from this phone.`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => {
                converter.stop(b.id);
                if (playback.state.book?.id === b.id) playback.pause();
                deleteBook(b.id);
                reload();
              },
            },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const queued = conv.order.length;
  const active = Object.values(conv.books).filter((x) => x.state === 'recording' || x.state === 'reading');

  return (
    <View style={{ flex: 1 }}>
      <Header
        title="BookVoice"
        right={
          <>
            <Btn title={queued ? `Queue · ${queued}` : 'Queue'} kind="ghost" small onPress={p.openQueue} />
            <Btn title="⚙︎" kind="ghost" small onPress={p.openSettings} />
          </>
        }
      />
      <FlatList
        contentContainerStyle={{ padding: 16, paddingTop: 4 }}
        data={books}
        keyExtractor={(b) => b.id}
        ListHeaderComponent={
          <View style={{ marginBottom: 12 }}>
            <Btn title={status ? status : '+  Add books'} disabled={!!status} onPress={add} />
            <Dim style={{ marginTop: 8, textAlign: 'center' }}>EPUB · PDF · DOCX · TXT · HTML · Markdown — add several at once</Dim>
            {active.length ? (
              <Pressable onPress={p.openQueue}>
                <Glass style={{ padding: 12, marginTop: 12 }}>
                  <Text style={{ color: C.text, fontWeight: '700' }}>Converting {active.length} book{active.length > 1 ? 's' : ''}</Text>
                  {active.map((a) => (
                    <Dim key={a.bookId} numberOfLines={1} style={{ marginTop: 2 }}>
                      {Math.floor(a.percent * 100)}% · {a.title}{a.eta ? ` · ~${fmtEta(a.eta)} left` : ''}
                    </Dim>
                  ))}
                </Glass>
              </Pressable>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <Card>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', marginBottom: 6 }}>Your library is empty</Text>
            <Dim>Add books, choose a voice for them, and they’ll convert in the background — even with the app closed. The audio stays on your phone.</Dim>
          </Card>
        }
        renderItem={({ item: b }) => {
          const done = b.chapters.filter((c) => c.status === 'done').length;
          const total = b.chapters.length;
          const dur = b.chapters.reduce((s, c) => s + (c.durationSec || 0), 0);
          const pr = conv.books[b.id];
          const pct = pr ? pr.percent : bookPercent(b);
          return (
            <Pressable onPress={() => p.openBook(b.id)} onLongPress={() => menu(b)}>
              <Card>
                <View style={{ flexDirection: 'row' }}>
                  <Text style={{ color: C.text, fontSize: 17, fontWeight: '700', flex: 1 }} numberOfLines={2}>{b.title}</Text>
                  {pr && pr.state !== 'done' ? (
                    <Text style={{ color: pr.state === 'error' ? C.red : C.accent, fontWeight: '800', marginLeft: 8 }}>{Math.floor(pct * 100)}%</Text>
                  ) : null}
                </View>
                <Dim style={{ marginTop: 2, marginBottom: 10 }} numberOfLines={1}>
                  {[b.author, b.format.toUpperCase(), `${done}/${total} chapters`, dur ? formatDuration(dur) : null].filter(Boolean).join(' · ')}
                </Dim>
                <Bar value={pct} color={done === total && total ? C.green : C.accent} />
                {pr && pr.state !== 'done' ? (
                  <Dim style={{ marginTop: 8, color: pr.state === 'error' ? C.red : C.accent }} numberOfLines={2}>{pr.message}</Dim>
                ) : null}
              </Card>
            </Pressable>
          );
        }}
      />
      {convert ? <ConvertSheet bookIds={convert} onClose={() => setConvert(null)} /> : null}
    </View>
  );
}
