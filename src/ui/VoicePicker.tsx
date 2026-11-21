import { AudioPlayer, createAudioPlayer } from 'expo-audio';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Switch, Text, View } from 'react-native';
import { DeviceVoice, listDeviceVoices, nativeAvailable } from '../../modules/bookvoice-native/src';
import { cachedPreview, previewCached } from '../lib/previews';
import { AzureVoice, ENGINE_NAMES, listAzureVoices } from '../lib/speech';
import { getKey, loadSettings } from '../lib/storage';
import { Engine, GEMINI_TTS_MODELS, LANGUAGES, PREBUILT_VOICES, Settings, STYLE_PRESETS, VoiceChoice, VoiceProfile } from '../lib/types';
import { Btn, C, Chip, Dim, Field } from './kit';

const LANG_FILTERS: [string, string][] = [['', 'All'], ['en', 'English'], ['hi', 'Hindi'], ['pa', 'Punjabi'], ['ur', 'Urdu']];
const AZURE_LOCALES = ['pa-IN', 'hi-IN', 'en-IN', 'en-AU', 'en-GB', 'en-US', 'ur-PK', 'ur-IN'];
const RATES = [0.8, 0.9, 1, 1.1, 1.2];

const ENGINE_HINT: Record<Engine, string> = {
  gemini: 'Most human-like. Free keys have a small daily speech allowance, so long books take a few days.',
  device: 'Built into your phone: unlimited, offline and fast. Choose “Enhanced” or “Premium” voices for the best sound (download more in iPhone Settings ▸ Accessibility ▸ Spoken Content ▸ Voices).',
  azure: 'Microsoft neural voices incl. Punjabi and Hindi. Free tier: 500,000 characters a month (about 9–10 hours). Needs an Azure Speech key.',
  elevenlabs: 'Voices from your own ElevenLabs account.',
};

/** Pick how a book sounds: service, voice, style. Used for the default voice and per book. */
export function VoicePicker(p: { value: VoiceProfile; onChange: (v: VoiceProfile) => void }) {
  const v = p.value;
  const set = (patch: Partial<VoiceProfile>) => p.onChange({ ...v, ...patch });
  const [s, setS] = useState<Settings | null>(null);
  const [devVoices, setDevVoices] = useState<DeviceVoice[] | null>(null);
  const [azVoices, setAzVoices] = useState<AzureVoice[] | null>(null);
  const [azErr, setAzErr] = useState('');
  const [langF, setLangF] = useState('');
  const [azLocale, setAzLocale] = useState('pa-IN');
  const [target, setTarget] = useState<'voice' | 'dialogueVoice'>('voice');
  const [busy, setBusy] = useState(false);
  const player = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    void loadSettings().then(setS);
    return () => player.current?.remove();
  }, []);
  useEffect(() => {
    if (v.engine === 'device' && !devVoices) void listDeviceVoices().then(setDevVoices).catch(() => setDevVoices([]));
    if (v.engine === 'azure' && !azVoices && s) {
      void (async () => {
        const k = await getKey('azure');
        if (!k) return setAzErr('Add your Azure Speech key in Settings ▸ AI keys first.');
        try {
          setAzVoices(await listAzureVoices(k, s.azureRegion));
          setAzErr('');
        } catch (e: any) {
          setAzErr(e?.message || String(e));
        }
      })();
    }
  }, [v.engine, s]);

  if (!s) return null;
  const chooseEngine = (e: Engine) => {
    const voice: VoiceChoice =
      e === 'gemini' ? s.voice : e === 'device' ? s.deviceVoice : e === 'azure' ? s.azureVoice : { id: s.elevenVoiceId, label: `ElevenLabs ${s.elevenVoiceId}`, prebuilt: false };
    set({ engine: e, voice, dialogueMode: e === 'gemini' && v.dialogueMode });
  };
  const pickGemini = (c: VoiceChoice) => set({ [target]: c } as Partial<VoiceProfile>);
  const cur = target === 'dialogueVoice' ? v.dialogueVoice : v.voice;

  const play = (uri: string) => {
    player.current?.remove();
    player.current = createAudioPlayer({ uri });
    player.current.play();
  };
  const target_ = (c: VoiceChoice): VoiceProfile => (target === 'dialogueVoice' ? { ...v, voice: c } : { ...v, voice: c });
  const preview = async () => {
    setBusy(true);
    try {
      const r = await previewCached(s, target === 'dialogueVoice' ? { ...v, voice: v.dialogueVoice } : v);
      play(r.file.uri);
    } catch (e: any) {
      Alert.alert('Preview failed', e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };
  /** Tapping a Gemini voice plays its saved sample straight away (no credit used). */
  const tapGemini = (c: VoiceChoice) => {
    pickGemini(c);
    const hit = cachedPreview(s, { ...target_(c), dialogueMode: false });
    if (hit) play(hit.uri);
  };
  const has = (c: VoiceChoice) => !!cachedPreview(s, { ...target_(c), dialogueMode: false });

  const devList = (devVoices || []).filter((d) => !langF || d.language.toLowerCase().startsWith(langF));
  const azList = (azVoices || []).filter((a) => a.locale === azLocale);

  return (
    <View>
      <Dim style={{ marginBottom: 8 }}>Voice service</Dim>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {(['gemini', 'device', 'azure', 'elevenlabs'] as Engine[]).map((e) =>
          e === 'device' && !nativeAvailable ? null : <Chip key={e} label={ENGINE_NAMES[e]} on={v.engine === e} onPress={() => chooseEngine(e)} />
        )}
      </View>
      <Dim style={{ marginBottom: 12 }}>{ENGINE_HINT[v.engine]}</Dim>

      {v.engine === 'gemini' ? (
        <>
          <Dim style={{ marginBottom: 6 }}>Speech model</Dim>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {GEMINI_TTS_MODELS.map(([id, name]) => (
              <Chip key={id} label={name} on={(v.ttsModel || s.ttsModel) === id} onPress={() => set({ ttsModel: id })} />
            ))}
          </View>
          <Dim style={{ marginBottom: 10 }}>
            {(GEMINI_TTS_MODELS.find((m) => m[0] === (v.ttsModel || s.ttsModel)) || GEMINI_TTS_MODELS[0])[2]}. Books on different models convert at the same time. Voices marked ♪ have a saved sample: tap to hear it free.
          </Dim>
          {v.dialogueMode ? (
            <View style={{ flexDirection: 'row', marginBottom: 6 }}>
              <Chip label={`Narrator: ${v.voice.label.split(' ')[0]}`} on={target === 'voice'} onPress={() => setTarget('voice')} />
              <Chip label={`Dialogue: ${v.dialogueVoice.label.split(' ')[0]}`} on={target === 'dialogueVoice'} onPress={() => setTarget('dialogueVoice')} />
            </View>
          ) : null}
          {(s.myVoices || []).length ? <Dim style={{ marginBottom: 6 }}>My voices</Dim> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {(s.myVoices || []).map((m) => (
              <Chip key={m.id} label={`${has({ id: m.id, label: m.label, prebuilt: false }) ? '♪ ' : ''}${m.label}`} on={cur.id === m.id} onPress={() => tapGemini({ id: m.id, label: m.label, prebuilt: false })} />
            ))}
          </View>
          <Dim style={{ marginBottom: 6 }}>Standard voices</Dim>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {PREBUILT_VOICES.map(([id, d]) => (
              <Chip key={id} label={`${has({ id, label: id, prebuilt: true }) ? '♪ ' : ''}${id} · ${d}`} on={cur.prebuilt && cur.id === id} onPress={() => tapGemini({ id, label: `${id} — ${d}`, prebuilt: true })} />
            ))}
          </View>
          <Dim style={{ marginTop: 6, marginBottom: 6 }}>Delivery</Dim>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {STYLE_PRESETS.map(([n, st]) => <Chip key={n} label={n} on={v.style === st} onPress={() => set({ style: st })} />)}
          </View>
          <Field multiline value={v.style} onChangeText={(t) => set({ style: t })} />
          <Dim style={{ marginBottom: 6 }}>Language / accent</Dim>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {LANGUAGES.map(([c, n]) => <Chip key={c || 'auto'} label={n} on={v.languageCode === c} onPress={() => set({ languageCode: c })} />)}
          </View>
          <Row label="Separate voice for dialogue" hint="Characters' lines use a second standard voice.">
            <Switch value={v.dialogueMode} onValueChange={(d) => { set({ dialogueMode: d }); if (!d) setTarget('voice'); }} trackColor={{ true: C.accent }} />
          </Row>
        </>
      ) : null}

      {v.engine === 'device' ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {LANG_FILTERS.map(([c, n]) => <Chip key={c || 'all'} label={n} on={langF === c} onPress={() => setLangF(c)} />)}
          </View>
          {devVoices === null ? <Dim>Loading your phone’s voices…</Dim> : null}
          {devVoices && !devList.length ? <Dim>No voices for this language on your phone. You can download more in the phone’s settings.</Dim> : null}
          {devList.slice(0, 120).map((d) => (
            <Pressable key={d.id} onPress={() => set({ voice: { id: d.id, label: `${d.name} (${d.language})`, prebuilt: false } })} style={{ paddingVertical: 9, borderBottomWidth: 1, borderColor: C.line }}>
              <Text style={{ color: v.voice.id === d.id ? C.accent : C.text, fontWeight: '600' }}>
                {d.name} <Text style={{ color: C.dim, fontWeight: '400' }}>· {d.language}</Text>
              </Text>
              <Dim>{d.quality === 'premium' ? '★ Premium' : d.quality === 'enhanced' ? '★ Enhanced' : 'Standard'}{d.network ? ' · needs internet' : ''}</Dim>
            </Pressable>
          ))}
        </>
      ) : null}

      {v.engine === 'azure' ? (
        <>
          {azErr ? <Dim style={{ color: C.red, marginBottom: 8 }}>{azErr}</Dim> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {AZURE_LOCALES.map((l) => <Chip key={l} label={l} on={azLocale === l} onPress={() => setAzLocale(l)} />)}
          </View>
          {azVoices === null && !azErr ? <Dim>Loading Azure voices…</Dim> : null}
          {azList.map((a) => (
            <Pressable key={a.id} onPress={() => set({ voice: { id: a.id, label: a.label, prebuilt: false } })} style={{ paddingVertical: 9, borderBottomWidth: 1, borderColor: C.line }}>
              <Text style={{ color: v.voice.id === a.id ? C.accent : C.text, fontWeight: '600' }}>{a.label}</Text>
              <Dim>{a.gender}{a.styles.length ? ` · styles: ${a.styles.slice(0, 4).join(', ')}` : ''}</Dim>
            </Pressable>
          ))}
        </>
      ) : null}

      {v.engine === 'elevenlabs' ? (
        <Field label="ElevenLabs voice ID" value={v.voice.id} onChangeText={(t) => set({ voice: { id: t.trim(), label: `ElevenLabs ${t.trim()}`, prebuilt: false } })} autoCapitalize="none" />
      ) : null}

      {v.engine === 'device' || v.engine === 'azure' ? (
        <>
          <Dim style={{ marginTop: 10, marginBottom: 6 }}>Speaking speed</Dim>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {RATES.map((r) => <Chip key={r} label={`${r}×`} on={Math.abs((v.rate || 1) - r) < 0.01} onPress={() => set({ rate: r })} />)}
          </View>
        </>
      ) : null}

      <Dim style={{ marginTop: 12, marginBottom: 6 }}>How should it be told?</Dim>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Chip label="Storyteller" on={v.adaptText && v.narration === 'storyteller'} onPress={() => set({ narration: 'storyteller', adaptText: true })} />
        <Chip label="Faithful" on={v.adaptText && v.narration === 'faithful'} onPress={() => set({ narration: 'faithful', adaptText: true })} />
        <Chip label="Exactly as written (no AI)" on={!v.adaptText} onPress={() => set({ adaptText: false, narration: 'faithful' })} />
      </View>
      <Dim style={{ marginBottom: 10 }}>
        {!v.adaptText
          ? 'Reads the text as it is, with no AI step: fastest.'
          : v.narration === 'storyteller'
          ? 'Told like a person telling you the story: every event and line of dialogue kept, in natural spoken sentences. Uses your AI keys in parallel.'
          : 'The author’s exact words, only cleaned up for listening. Uses your AI keys in parallel.'}
      </Dim>

      <Btn title={busy ? 'Making a sample…' : `▶  Preview ${(cur.label || 'voice').split(' (')[0]}`} kind="ghost" busy={busy} onPress={preview} />
    </View>
  );
}

function Row(p: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={{ color: C.text, fontWeight: '600' }}>{p.label}</Text>
        {p.hint ? <Dim style={{ marginTop: 2 }}>{p.hint}</Dim> : null}
      </View>
      {p.children}
    </View>
  );
}

/** Save a profile back as the default voice settings. */
export function profileToSettings(s: Settings, v: VoiceProfile): Settings {
  const n: Settings = { ...s, engine: v.engine, style: v.style, languageCode: v.languageCode, narration: v.narration, adaptText: v.adaptText, speechRate: v.rate, dialogueMode: v.dialogueMode, dialogueVoice: v.dialogueVoice };
  if (v.engine === 'gemini') {
    n.voice = v.voice;
    if (v.ttsModel) n.ttsModel = v.ttsModel;
  }
  if (v.engine === 'device') n.deviceVoice = v.voice;
  if (v.engine === 'azure') n.azureVoice = v.voice;
  if (v.engine === 'elevenlabs') n.elevenVoiceId = v.voice.id;
  n.provider = v.engine === 'elevenlabs' ? 'elevenlabs' : 'gemini';
  return n;
}
