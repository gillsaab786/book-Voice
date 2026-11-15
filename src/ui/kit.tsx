import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';

export const C = {
  bg: '#000000',
  card: '#111113',
  card2: '#1C1C1F',
  line: '#2A2A2E',
  text: '#F5F5F7',
  dim: '#8E8E93',
  accent: '#FF9F0A',
  green: '#30D158',
  red: '#FF453A',
  blue: '#0A84FF',
};

export function Btn(p: {
  title: string; onPress?: () => void; kind?: 'primary' | 'ghost' | 'danger'; small?: boolean; disabled?: boolean; busy?: boolean; style?: ViewStyle;
}) {
  const k = p.kind || 'primary';
  return (
    <Pressable
      onPress={p.onPress}
      disabled={p.disabled || p.busy}
      style={({ pressed }) => [
        s.btn,
        p.small && s.btnSmall,
        k === 'primary' && { backgroundColor: C.accent },
        k === 'ghost' && { backgroundColor: C.card2 },
        k === 'danger' && { backgroundColor: '#3A1210' },
        (pressed || p.disabled) && { opacity: 0.55 },
        p.style,
      ]}
    >
      {p.busy ? (
        <ActivityIndicator color={k === 'primary' ? '#000' : C.text} />
      ) : (
        <Text style={[s.btnText, p.small && { fontSize: 13 }, { color: k === 'primary' ? '#000' : k === 'danger' ? C.red : C.text }]}>{p.title}</Text>
      )}
    </Pressable>
  );
}

export function Chip(p: { label: string; on?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={p.onPress} style={[s.chip, p.on && { backgroundColor: C.accent, borderColor: C.accent }]}>
      <Text style={{ color: p.on ? '#000' : C.text, fontSize: 13, fontWeight: '600' }}>{p.label}</Text>
    </Pressable>
  );
}

export function Card(p: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, p.style]}>{p.children}</View>;
}

export function H(p: { children: React.ReactNode }) {
  return <Text style={s.h}>{p.children}</Text>;
}

export function Dim(p: { children: React.ReactNode; style?: any; numberOfLines?: number }) {
  return <Text numberOfLines={p.numberOfLines} style={[{ color: C.dim, fontSize: 13 }, p.style]}>{p.children}</Text>;
}

export function Field(p: TextInputProps & { label?: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      {p.label ? <Dim style={{ marginBottom: 6 }}>{p.label}</Dim> : null}
      <TextInput placeholderTextColor="#555" {...p} style={[s.input, p.multiline && { minHeight: 70, textAlignVertical: 'top' }, p.style]} />
    </View>
  );
}

export function Bar(p: { value: number; color?: string }) {
  return (
    <View style={s.barBg}>
      <View style={[s.barFg, { width: `${Math.max(0, Math.min(1, p.value)) * 100}%`, backgroundColor: p.color || C.accent }]} />
    </View>
  );
}

export function Header(p: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <View style={s.header}>
      {p.onBack ? (
        <Pressable onPress={p.onBack} hitSlop={12} style={{ paddingRight: 12 }}>
          <Text style={{ color: C.accent, fontSize: 28, lineHeight: 30 }}>‹</Text>
        </Pressable>
      ) : null}
      <Text style={s.title} numberOfLines={1}>{p.title}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>{p.right}</View>
    </View>
  );
}

const s = StyleSheet.create({
  btn: { borderRadius: 12, paddingVertical: 13, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  btnSmall: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  btnText: { fontSize: 16, fontWeight: '700' },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 18, paddingVertical: 7, paddingHorizontal: 12, marginRight: 8, marginBottom: 8, backgroundColor: C.card2 },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  h: { color: C.text, fontSize: 13, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 8, marginBottom: 10 },
  input: { backgroundColor: C.card2, color: C.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, borderWidth: 1, borderColor: C.line },
  barBg: { height: 4, borderRadius: 2, backgroundColor: C.line, overflow: 'hidden' },
  barFg: { height: 4, borderRadius: 2 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  title: { flex: 1, color: C.text, fontSize: 22, fontWeight: '800' },
});
