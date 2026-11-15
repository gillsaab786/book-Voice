import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { playback, SleepMode } from '../lib/playback';
import { ReadTheme } from './readThemes';

/** Sleep timer choices: minutes, a number of chapters, or the whole book. */
export function SleepPanel({ theme, onDone }: { theme: ReadTheme; onDone: () => void }) {
  const [mins, setMins] = useState('');
  const [chapters, setChapters] = useState(2);
  const cur = playback.sleep;

  const choose = (m: SleepMode) => {
    playback.setSleep(m);
    onDone();
  };
  const isOn = (m: SleepMode) => JSON.stringify(m) === JSON.stringify(cur);

  const Opt = ({ label, m }: { label: string; m: SleepMode }) => (
    <Pressable
      onPress={() => choose(m)}
      style={{
        paddingVertical: 9, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1,
        borderColor: isOn(m) ? theme.heading : theme.line, backgroundColor: isOn(m) ? theme.wordBg : 'transparent',
      }}
    >
      <Text style={{ color: isOn(m) ? theme.wordText : theme.panelText, fontWeight: '700', fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
  const H = ({ children }: { children: string }) => (
    <Text style={{ color: theme.panelText, opacity: 0.7, fontWeight: '700', marginTop: 12, marginBottom: 8 }}>{children}</Text>
  );

  return (
    <View style={{ backgroundColor: theme.panel, borderTopWidth: 1, borderColor: theme.line, padding: 14 }}>
      <Text style={{ color: theme.panelText, fontWeight: '800', fontSize: 16 }}>☾ Sleep timer</Text>
      <Text style={{ color: theme.panelText, opacity: 0.6, fontSize: 12, marginTop: 2 }}>
        Fades out gently, then stops and steps back 20 s so you can pick up from something you remember.
      </Text>

      <H>After minutes</H>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {[10, 15, 20, 30, 45, 60, 90, 120].map((n) => <Opt key={n} label={n < 60 ? `${n} min` : `${n / 60} h${n % 60 ? ' 30' : ''}`} m={{ kind: 'minutes', n }} />)}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <TextInput
            value={mins}
            onChangeText={(t) => setMins(t.replace(/[^0-9]/g, '').slice(0, 3))}
            placeholder="__"
            placeholderTextColor={theme.body}
            keyboardType="number-pad"
            style={{ color: theme.panelText, borderWidth: 1, borderColor: theme.line, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, minWidth: 54, textAlign: 'center' }}
          />
          <Pressable onPress={() => Number(mins) > 0 && choose({ kind: 'minutes', n: Number(mins) })}>
            <Text style={{ color: theme.heading, fontWeight: '800' }}>min ✓</Text>
          </Pressable>
        </View>
      </View>

      <H>After chapters</H>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Opt label="End of this chapter" m={{ kind: 'chapters', n: 1 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Pressable onPress={() => setChapters((c) => Math.max(2, c - 1))} hitSlop={8} style={{ padding: 6 }}>
            <Text style={{ color: theme.panelText, fontSize: 20 }}>−</Text>
          </Pressable>
          <Opt label={`${chapters} chapters`} m={{ kind: 'chapters', n: chapters }} />
          <Pressable onPress={() => setChapters((c) => Math.min(50, c + 1))} hitSlop={8} style={{ padding: 6 }}>
            <Text style={{ color: theme.panelText, fontSize: 20 }}>+</Text>
          </Pressable>
        </View>
      </View>

      <H>Or</H>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Opt label="Finish the whole book" m={{ kind: 'book' }} />
        <Opt label="Off" m={null} />
      </View>
    </View>
  );
}
