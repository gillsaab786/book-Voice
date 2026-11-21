import { getAppIconName, setAlternateAppIcon, supportsAlternateIcons } from 'expo-alternate-app-icons';
import React, { useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { loadSettings, saveSettings } from '../lib/storage';
import { Settings } from '../lib/types';
import { ICONS } from './iconList';
import { ACCENTS, C, Card, Dim, H, Header, setAccent } from './kit';

const DESIGN_NAMES: Record<string, string> = { Wave: 'Book wave', Listen: 'Headphones', Glass: 'Liquid glass', Moon: 'Night stories' };

export function AppearanceScreen({ onBack, onAccentChange }: { onBack: () => void; onAccentChange: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => {
    void loadSettings().then(setS);
    try {
      setIcon(getAppIconName());
    } catch {}
  }, []);
  if (!s) return null;

  const chooseAccent = (name: string) => {
    const n = { ...s, accent: name };
    setS(n);
    void saveSettings(n);
    setAccent(name);
    // keep the icon's colour in step with the accent
    const design = (ICONS.find((i) => i.name === icon) || ICONS[0]).design;
    void applyIcon(`${design}${name}`, false);
    onAccentChange();
  };

  const applyIcon = async (name: string, tell = true) => {
    if (!supportsAlternateIcons) {
      if (tell) Alert.alert('Not supported', 'This phone can’t change app icons.');
      return;
    }
    try {
      await setAlternateAppIcon(name === 'WaveAmber' ? null : name);
      setIcon(name === 'WaveAmber' ? null : name);
      const n = { ...(s as Settings), appIcon: name };
      setS(n);
      void saveSettings(n);
    } catch (e: any) {
      if (tell) Alert.alert('Couldn’t change the icon', e?.message || String(e));
    }
  };

  const designs = Array.from(new Set(ICONS.map((i) => i.design)));
  const current = icon || 'WaveAmber';

  return (
    <View style={{ flex: 1 }}>
      <Header title="Appearance" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        <H>Accent colour</H>
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {ACCENTS.map(([name, hex]) => (
              <Pressable key={name} onPress={() => chooseAccent(name)} style={{ alignItems: 'center', width: 62 }}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: hex, borderWidth: s.accent === name ? 3 : 0, borderColor: '#FFFFFF' }} />
                <Dim style={{ marginTop: 4, fontSize: 11 }}>{name}</Dim>
              </Pressable>
            ))}
          </View>
          <Dim style={{ marginTop: 10 }}>The app icon follows the colour you pick.</Dim>
        </Card>

        <H>App icon</H>
        {designs.map((d) => (
          <Card key={d}>
            <Text style={{ color: C.text, fontWeight: '700', marginBottom: 10 }}>{DESIGN_NAMES[d] || d}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {ICONS.filter((i) => i.design === d).map((i) => (
                <Pressable key={i.name} onPress={() => void applyIcon(i.name)} style={{ marginRight: 12, alignItems: 'center' }}>
                  <Image
                    source={i.img}
                    style={{ width: 64, height: 64, borderRadius: 15, borderWidth: current === i.name ? 3 : 0, borderColor: '#FFFFFF' }}
                  />
                  <Dim style={{ fontSize: 10, marginTop: 4 }}>{i.accent}</Dim>
                </Pressable>
              ))}
            </ScrollView>
          </Card>
        ))}
        <Dim>iPhone shows a short message when the icon changes — that’s normal.</Dim>
      </ScrollView>
    </View>
  );
}
