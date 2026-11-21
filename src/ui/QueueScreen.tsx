import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { fmtEta } from '../lib/background';
import { converter } from '../lib/converter';
import { timeLabel } from '../lib/errors';
import { ENGINE_NAMES } from '../lib/speech';
import { ConvertSheet } from './ConvertSheet';
import { useBooks, useConverter } from './hooks';
import { Bar, Btn, C, Card, Dim, H, Header } from './kit';

/** Every book waiting or converting, with its percentage. */
export function QueueScreen(p: { onBack: () => void; openBook: (id: string) => void }) {
  const conv = useConverter();
  const [books] = useBooks();
  const [picking, setPicking] = useState<string[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [choose, setChoose] = useState(false);

  const queued = conv.order.map((id) => conv.books[id]).filter(Boolean);
  const done = Object.values(conv.books).filter((b) => b.state === 'done' && !conv.order.includes(b.bookId));
  const notQueued = books.filter((b) => !conv.order.includes(b.id) && b.chapters.some((c) => c.status !== 'done'));

  const menu = (id: string, title: string) =>
    Alert.alert(title, undefined, [
      { text: 'Move up', onPress: () => converter.move(id, -1) },
      { text: 'Move down', onPress: () => converter.move(id, 1) },
      { text: 'Change voice', onPress: () => setPicking([id]) },
      { text: 'Remove from queue', style: 'destructive', onPress: () => converter.stop(id) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <View style={{ flex: 1 }}>
      <Header title="Queue" onBack={p.onBack} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        <Dim style={{ marginBottom: 12 }}>
          Books with different voice services convert at the same time. It keeps going in the background — watch the Lock Screen / Dynamic Island.
        </Dim>
        {!queued.length ? (
          <Card>
            <Text style={{ color: C.text, fontWeight: '700' }}>Nothing converting</Text>
            <Dim>Add books below, choose a voice for them, and they’ll convert one after another.</Dim>
          </Card>
        ) : null}
        {queued.map((b, i) => (
          <Pressable key={b.bookId} onPress={() => p.openBook(b.bookId)} onLongPress={() => menu(b.bookId, b.title)}>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <Text style={{ color: C.dim, width: 26, fontWeight: '700' }}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }} numberOfLines={2}>{b.title}</Text>
                  <Dim style={{ marginTop: 2 }}>{ENGINE_NAMES[b.engine]}</Dim>
                </View>
                <Text style={{ color: b.state === 'error' ? C.red : C.accent, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                  {Math.floor(b.percent * 100)}%
                </Text>
              </View>
              <View style={{ marginTop: 10 }}>
                <Bar value={b.percent} color={b.state === 'error' ? C.red : b.state === 'waiting' ? C.dim : C.accent} />
              </View>
              <Dim style={{ marginTop: 8, color: b.state === 'error' ? C.red : C.dim }} numberOfLines={3}>
                {b.state === 'waiting' && b.waitUntil ? `Paused until ${timeLabel(b.waitUntil)} · ${b.message}` : b.message}
                {b.eta && (b.state === 'recording' || b.state === 'reading') ? ` · ~${fmtEta(b.eta)} left` : ''}
              </Dim>
            </Card>
          </Pressable>
        ))}
        {done.map((b) => (
          <Card key={b.bookId}>
            <Text style={{ color: C.green, fontWeight: '700' }}>✓ {b.title}</Text>
            <Dim>Converted — ready to listen</Dim>
          </Card>
        ))}

        {notQueued.length ? (
          <>
            <H>Add to the queue</H>
            {notQueued.map((b) => {
              const on = sel.has(b.id);
              return (
                <Pressable
                  key={b.id}
                  onPress={() => {
                    const n = new Set(sel);
                    on ? n.delete(b.id) : n.add(b.id);
                    setSel(n);
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: C.line }}
                >
                  <Text style={{ color: on ? C.accent : C.dim, fontSize: 20, width: 32 }}>{on ? '◉' : '○'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.text, fontWeight: '600' }} numberOfLines={1}>{b.title}</Text>
                    <Dim>{b.chapters.filter((c) => c.status === 'done').length}/{b.chapters.length} chapters done</Dim>
                  </View>
                </Pressable>
              );
            })}
            <Btn title={sel.size ? `Choose voice & queue ${sel.size}` : 'Select books above'} disabled={!sel.size} onPress={() => setChoose(true)} style={{ marginTop: 12 }} />
          </>
        ) : null}
      </ScrollView>
      {choose ? <ConvertSheet bookIds={[...sel]} onClose={(q) => { setChoose(false); if (q) setSel(new Set()); }} /> : null}
      {picking ? <ConvertSheet bookIds={picking} onClose={() => setPicking(null)} /> : null}
    </View>
  );
}
