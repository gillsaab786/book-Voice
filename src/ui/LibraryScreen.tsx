import React, { useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { converter } from '../lib/converter';
import { importBook, pickBooks } from '../lib/importer';
import { playback } from '../lib/playback';
import { deleteBook, getKey } from '../lib/storage';
import { Book } from '../lib/types';
import { formatDuration } from '../lib/bytes';
import { useBooks, useConverter } from './hooks';
import { Bar, Btn, C, Card, Dim, Header } from './kit';

export function LibraryScreen(p: { openBook: (id: string) => void; openSettings: () => void }) {
  const [books, reload] = useBooks();
  const conv = useConverter();
  const [status, setStatus] = useState<string | null>(null);

  const add = async () => {
    if (!(await getKey('gemini'))) {
      Alert.alert('Gemini key needed', 'Add your Gemini API key in Settings first.', [{ text: 'Open Settings', onPress: p.openSettings }]);
      return;
    }
    const assets = await pickBooks();
    for (const a of assets) {
      try {
        setStatus(`Adding ${a.name}…`);
        const b = await importBook(a, (s) => setStatus(s));
        reload();
        if (assets.length === 1) p.openBook(b.id);
      } catch (e: any) {
        Alert.alert(`Couldn't add ${a.name}`, e?.message || String(e));
      }
    }
    setStatus(null);
  };

  const remove = (b: Book) =>
    Alert.alert('Delete book?', `“${b.title}” and all its audio will be removed from this phone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          converter.stop(b.id);
          if (playback.state.book?.id === b.id) playback.toggle();
          deleteBook(b.id);
          reload();
        },
      },
    ]);

  return (
    <View style={{ flex: 1 }}>
      <Header
        title="BookVoice"
        right={<Btn title="⚙︎" kind="ghost" small onPress={p.openSettings} />}
      />
      <FlatList
        contentContainerStyle={{ padding: 16, paddingTop: 4 }}
        data={books}
        keyExtractor={(b) => b.id}
        ListHeaderComponent={
          <View style={{ marginBottom: 12 }}>
            <Btn title={status ? status : '+  Add books'} busy={!!status && false} disabled={!!status} onPress={add} />
            <Dim style={{ marginTop: 8, textAlign: 'center' }}>EPUB · PDF · DOCX · TXT · HTML · Markdown</Dim>
          </View>
        }
        ListEmptyComponent={
          <Card>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', marginBottom: 6 }}>Your library is empty</Text>
            <Dim>Add a book, pick a narrator voice in Settings, then tap Convert. Gemini rewrites each chapter for listening and records it; the audio stays on your phone.</Dim>
          </Card>
        }
        renderItem={({ item: b }) => {
          const done = b.chapters.filter((c) => c.status === 'done').length;
          const total = b.chapters.length;
          const dur = b.chapters.reduce((s, c) => s + (c.durationSec || 0), 0);
          const active = conv.running && conv.bookId === b.id;
          return (
            <Pressable onPress={() => p.openBook(b.id)} onLongPress={() => remove(b)}>
              <Card>
                <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }} numberOfLines={2}>{b.title}</Text>
                <Dim style={{ marginTop: 2, marginBottom: 10 }} numberOfLines={1}>
                  {[b.author, b.format.toUpperCase(), `${done}/${total} chapters`, dur ? formatDuration(dur) : null].filter(Boolean).join(' · ')}
                </Dim>
                <Bar value={total ? done / total : 0} color={done === total && total ? C.green : C.accent} />
                {active ? <Dim style={{ marginTop: 8, color: C.accent }}>{conv.message}</Dim> : null}
              </Card>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
