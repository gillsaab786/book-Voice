import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { addKey, AiKey, keyStatus, loadKeys, loadUsage, onAiChange, providerById, removeKey, setKeyDisabled } from '../lib/ai';
import { nextPacificMidnight, timeLabel } from '../lib/errors';
import { getKey, loadSettings, saveSettings, setKey } from '../lib/storage';
import { Settings } from '../lib/types';
import { Bar, Btn, C, Card, Chip, Dim, Field, H, Header } from './kit';

const AZURE_REGIONS = ['australiaeast', 'southeastasia', 'centralindia', 'eastus', 'westeurope', 'uksouth'];

export function KeysScreen({ onBack }: { onBack: () => void }) {
  const [keys, setKeys] = useState<AiKey[]>([]);
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof loadUsage>> | null>(null);
  const [newKey, setNewKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [gKey, setGKey] = useState('');
  const [aKey, setAKey] = useState('');
  const [eKey, setEKey] = useState('');
  const [s, setS] = useState<Settings | null>(null);
  const [, tick] = useState(0);

  const reload = async () => {
    setKeys([...(await loadKeys())]);
    setUsage({ ...(await loadUsage()) });
  };
  useEffect(() => {
    void reload();
    void loadSettings().then(setS);
    void getKey('gemini').then((k) => setGKey(k || ''));
    void getKey('azure').then((k) => setAKey(k || ''));
    void getKey('eleven').then((k) => setEKey(k || ''));
    const off = onAiChange(() => void reload());
    const t = setInterval(() => tick((x) => x + 1), 5000);
    return () => {
      off();
      clearInterval(t);
    };
  }, []);

  const add = async () => {
    setBusy(true);
    try {
      const k = await addKey(newKey);
      setNewKey('');
      Alert.alert('Key added', `${providerById(k.provider)?.name} · ${k.models[0]}`);
    } catch (e: any) {
      Alert.alert("Couldn't add that key", e?.message || String(e));
    } finally {
      setBusy(false);
      void reload();
    }
  };

  const keyMenu = (k: AiKey) =>
    Alert.alert(providerById(k.provider)?.name || k.provider, k.models.join('\n'), [
      { text: k.disabled ? 'Switch on' : 'Switch off', onPress: () => void setKeyDisabled(k.id, !k.disabled) },
      { text: 'Remove key', style: 'destructive', onPress: () => void removeKey(k.id) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const back = async () => {
    await setKey('gemini', gKey);
    await setKey('azure', aKey);
    await setKey('eleven', eKey);
    onBack();
  };

  const gem = (id: string) => usage?.counts[id] || 0;

  return (
    <View style={{ flex: 1 }}>
      <Header title="AI keys" onBack={back} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
        <H>Gemini (voices + backup for text)</H>
        <Card>
          <Field value={gKey} onChangeText={setGKey} onBlur={() => setKey('gemini', gKey)} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="AIza…" />
          <Meter title="Speech" line={`${gem('gemini-tts')} requests today · resets ${timeLabel(nextPacificMidnight())}`} used={Math.min(1, gem('gemini-tts') / 100)} />
          <Meter title="Text" line={`${gem('gemini-text')} requests today`} used={Math.min(1, gem('gemini-text') / 500)} />
          <Dim style={{ marginTop: 8 }}>
            Google counts free use per project, not per key, so extra Gemini keys from the same account don’t add speed. Use one Gemini key here.
          </Dim>
        </Card>

        <H>More AI keys (text work, in parallel)</H>
        <Card>
          <Dim style={{ marginBottom: 10 }}>
            Paste a key from any service — Groq, NVIDIA, Mistral, OpenRouter, SambaNova, GitHub Models, Cerebras, Hugging Face, DeepSeek… The app works out which one it is and the best model. Every key adapts chapters at the same time, so the reading step goes many times faster. A Mistral key also reads scanned PDFs (OCR).
          </Dim>
          <Field value={newKey} onChangeText={setNewKey} placeholder="Paste a key" autoCapitalize="none" autoCorrect={false} secureTextEntry />
          <Btn title="Add key" busy={busy} onPress={add} />
        </Card>

        {keys.map((k) => {
          const st = usage ? keyStatus(k, usage) : { line: '', used: 0, ok: true };
          const p = providerById(k.provider);
          return (
            <Pressable key={k.id} onLongPress={() => keyMenu(k)} onPress={() => keyMenu(k)}>
              <Card style={{ opacity: k.disabled ? 0.5 : 1 }}>
                <Text style={{ color: C.text, fontSize: 17, fontWeight: '600' }} numberOfLines={2}>
                  {p?.name} · {k.models[0]}
                </Text>
                <Meter line={st.line} used={st.used} bad={!st.ok} />
              </Card>
            </Pressable>
          );
        })}

        <H>Microsoft Azure voices (optional)</H>
        <Card>
          <Dim style={{ marginBottom: 8 }}>
            Free tier: 500,000 characters a month of natural Punjabi, Hindi and English voices. Create a free “Speech” resource at portal.azure.com, then paste Key 1 and pick its region.
          </Dim>
          <Field value={aKey} onChangeText={setAKey} onBlur={() => setKey('azure', aKey)} secureTextEntry autoCapitalize="none" placeholder="Azure Speech key" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {AZURE_REGIONS.map((r) => (
              <Chip key={r} label={r} on={s?.azureRegion === r} onPress={() => { if (s) { const n = { ...s, azureRegion: r }; setS(n); void saveSettings(n); } }} />
            ))}
          </View>
          <Meter line={`${gem('azure-tts')} requests today`} used={0} />
        </Card>

        <H>ElevenLabs (optional)</H>
        <Card>
          <Field value={eKey} onChangeText={setEKey} onBlur={() => setKey('eleven', eKey)} secureTextEntry autoCapitalize="none" placeholder="ElevenLabs key" />
        </Card>
      </ScrollView>
    </View>
  );
}

function Meter(p: { title?: string; line: string; used: number; bad?: boolean }) {
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={{ color: p.bad ? C.red : C.dim, fontSize: 14, marginBottom: 8 }}>
        {p.title ? `${p.title} · ` : ''}
        {p.line}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Bar value={Math.max(0.01, p.used)} color={p.bad ? C.red : C.green} />
        </View>
        <Dim>{Math.round(p.used * 100)}% used today</Dim>
      </View>
    </View>
  );
}
