import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { converter } from '../lib/converter';
import { profileFromSettings } from '../lib/speech';
import { loadBook, loadSettings, saveSettings } from '../lib/storage';
import { VoiceProfile } from '../lib/types';
import { Btn, C, Dim, Glass } from './kit';
import { profileToSettings, VoicePicker } from './VoicePicker';

/** Choose the voice for one or more books, then add them to the conversion queue. */
export function ConvertSheet(p: { bookIds: string[]; onClose: (queued: boolean) => void }) {
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<VoiceProfile | null>(null);
  const [titles, setTitles] = useState<string[]>([]);
  const [makeDefault, setMakeDefault] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const s = await loadSettings();
      const books = await Promise.all(p.bookIds.map((id) => loadBook(id).catch(() => null)));
      setTitles(books.filter(Boolean).map((b) => b!.title));
      setProfile(books[0]?.profile || profileFromSettings(s));
    })();
  }, [p.bookIds.join(',')]);

  const go = async () => {
    if (!profile) return;
    setBusy(true);
    if (makeDefault) await saveSettings(profileToSettings(await loadSettings(), profile));
    for (const id of p.bookIds) await converter.enqueue(id, { profile });
    setBusy(false);
    p.onClose(true);
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => p.onClose(false)}>
      <View style={{ flex: 1, backgroundColor: '#0B0B0D', paddingBottom: insets.bottom }}>
        <View style={{ padding: 18, paddingBottom: 8 }}>
          <Text style={{ color: C.text, fontSize: 22, fontWeight: '800' }}>
            {titles.length > 1 ? `Convert ${titles.length} books` : 'Convert to audio'}
          </Text>
          <Dim numberOfLines={2} style={{ marginTop: 4 }}>{titles.join(' · ')}</Dim>
        </View>
        <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 4 }} keyboardShouldPersistTaps="handled">
          {profile ? <VoicePicker value={profile} onChange={setProfile} /> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16 }}>
            <Text style={{ color: C.text, flex: 1 }}>Make this my default voice</Text>
            <Switch value={makeDefault} onValueChange={setMakeDefault} trackColor={{ true: C.accent }} />
          </View>
        </ScrollView>
        <Glass radius={0} style={{ padding: 14, flexDirection: 'row', gap: 10 }}>
          <Btn title="Cancel" kind="ghost" onPress={() => p.onClose(false)} style={{ flex: 1 }} />
          <Btn title={titles.length > 1 ? `Queue ${titles.length} books` : 'Add to queue'} onPress={go} busy={busy} style={{ flex: 2 }} />
        </Glass>
      </View>
    </Modal>
  );
}
