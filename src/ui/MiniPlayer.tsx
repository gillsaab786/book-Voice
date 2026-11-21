import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { playback, SKIP_SEC } from '../lib/playback';
import { usePlayback } from './hooks';
import { Bar, C, Glass } from './kit';
import { formatDuration } from '../lib/bytes';

export function MiniPlayer({ onOpen }: { onOpen: () => void }) {
  const p = usePlayback();
  if (!p.book || p.chapter < 0) return null;
  const ch = p.book.chapters[p.chapter];
  return (
    <Pressable onPress={onOpen} style={{ paddingHorizontal: 10, paddingBottom: 6 }}>
      <Glass interactive radius={22} style={{ overflow: 'hidden' }}>
      <Bar value={p.duration ? p.time / p.duration : 0} />
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: C.text, fontWeight: '700' }}>{ch?.title}</Text>
          <Text numberOfLines={1} style={{ color: C.dim, fontSize: 12 }}>{p.playing ? (p.sleepLabel ? `☾ ${p.sleepLabel} · ${p.book.title}` : p.book.title) : `Paused · ${formatDuration(p.time)} · tap ▶ to continue`}</Text>
        </View>
        <Pressable onPress={() => playback.seekBy(-SKIP_SEC)} hitSlop={10} style={{ paddingHorizontal: 10 }}>
          <Text style={{ color: C.text, fontSize: 15 }}>⟲{SKIP_SEC}</Text>
        </Pressable>
        <Pressable onPress={() => playback.toggle()} hitSlop={10} style={{ paddingHorizontal: 10 }}>
          <Text style={{ color: C.accent, fontSize: 26 }}>{p.playing ? '❚❚' : '▶'}</Text>
        </Pressable>
        <Pressable onPress={() => playback.next(1)} hitSlop={10} style={{ paddingHorizontal: 8 }}>
          <Text style={{ color: C.text, fontSize: 18 }}>⏭</Text>
        </Pressable>
      </View>
      </Glass>
    </Pressable>
  );
}
