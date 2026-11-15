import * as DocumentPicker from 'expo-document-picker';
import {
  RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState,
} from 'expo-audio';
import React, { useState } from 'react';
import { Alert, Share, Text, View } from 'react-native';
import { audioToWavFile } from '../lib/converter';
import { replicateVoice, speak } from '../lib/gemini';
import { setKey } from '../lib/storage';
import { Settings, VoiceChoice } from '../lib/types';
import { CONSENT_EN, PreparedAudio, toReplicationWav } from '../lib/voiceClone';
import { Btn, C, Card, Dim, Field } from './kit';

type Slot = 'sample' | 'consent';

/** Copy the voice of someone who agrees: a talking sample + their spoken consent. */
export function CloneVoiceCard(p: {
  s: Settings;
  gKey: string;
  update: (patch: Partial<Settings>) => void;
  pickVoice: (v: VoiceChoice) => void;
  play: (uri: string) => void;
}) {
  const [name, setName] = useState('');
  const [statement, setStatement] = useState(CONSENT_EN);
  const [audio, setAudio] = useState<Record<Slot, PreparedAudio | null>>({ sample: null, consent: null });
  const [busy, setBusy] = useState<string | null>(null);
  const [recSlot, setRecSlot] = useState<Slot | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const rec = useAudioRecorderState(recorder, 250);

  const load = async (slot: Slot, uri: string) => {
    setBusy(slot === 'sample' ? 'Reading voice sample…' : 'Reading consent recording…');
    try {
      const a = await toReplicationWav(uri, slot === 'sample' ? 180 : 60);
      if (slot === 'sample' && a.seconds < 20) Alert.alert('Short sample', `Only ${Math.round(a.seconds)} s. Google recommends about 60 seconds of clear talking for the best copy.`);
      setAudio((x) => ({ ...x, [slot]: a }));
    } catch (e: any) {
      Alert.alert('Could not read that audio', e?.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  const pick = async (slot: Slot) => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['audio/*', 'video/*', 'application/ogg', '*/*'], copyToCacheDirectory: true });
    if (!r.canceled && r.assets[0]) await load(slot, r.assets[0].uri);
  };

  const toggleRecord = async (slot: Slot) => {
    if (recSlot === slot) {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' });
      setRecSlot(null);
      if (recorder.uri) await load(slot, recorder.uri);
      return;
    }
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) return Alert.alert('Microphone needed', 'Allow microphone access in Settings to record here.');
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecSlot(slot);
  };

  const sendStatement = () =>
    Share.share({
      message: `Hi! I'd like to make my audiobook app read stories in your voice. If you're happy with that, please record a voice note of yourself reading this sentence aloud, exactly as written, in a quiet place, and send it back to me:\n\n"${statement}"\n\nAlso send a separate voice note of about one minute of you just talking naturally (about anything). Thank you!`,
    });

  const create = async () => {
    if (!p.gKey) return Alert.alert('Gemini key needed', 'Add your Gemini API key above first.');
    if (!name.trim()) return Alert.alert('Name the voice', 'Whose voice is this? e.g. “Mum”.');
    if (!audio.sample || !audio.consent) return Alert.alert('Two recordings needed', 'Add the talking sample and the consent recording.');
    setBusy('Creating the voice…');
    try {
      await setKey('gemini', p.gKey);
      const voice = await replicateVoice(p.gKey, { name: name.trim(), sampleWavB64: audio.sample.base64, consentWavB64: audio.consent.base64 });
      p.update({ myVoices: [voice, ...(p.s.myVoices || [])] });
      const choice = { id: voice.id, label: voice.label, prebuilt: false };
      p.pickVoice(choice);
      setBusy('Making a preview…');
      const a = await speak({
        key: p.gKey,
        settings: { ...p.s, voice: choice, dialogueMode: false },
        parts: [{ speaker: 'NARRATOR', text: 'Once upon a time, in a small village by the river, there lived a girl who loved stories more than anything.' }],
      });
      p.play((await audioToWavFile(a)).uri);
      setAudio({ sample: null, consent: null });
      setName('');
    } catch (e: any) {
      const msg = e?.message || String(e);
      Alert.alert(
        'Voice not created',
        /consent|INVALID_ARGUMENT|match/i.test(msg)
          ? `Google couldn't confirm the consent recording. It must be the same person as the sample, reading the statement word for word, clearly.\n\n(${msg})`
          : msg
      );
    } finally {
      setBusy(null);
    }
  };

  const SlotRow = ({ slot, title, hint }: { slot: Slot; title: string; hint: string }) => {
    const a = audio[slot];
    const recording = recSlot === slot;
    return (
      <View style={{ marginTop: 12 }}>
        <Text style={{ color: C.text, fontWeight: '700' }}>{title}</Text>
        <Dim style={{ marginBottom: 8 }}>{a ? `✓ ${Math.round(a.seconds)} s ready` : hint}</Dim>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Btn small kind="ghost" title="Choose file" onPress={() => pick(slot)} disabled={!!recSlot || !!busy} />
          <Btn
            small
            kind={recording ? 'danger' : 'ghost'}
            title={recording ? `■ Stop ${Math.round(rec.durationMillis / 1000)}s` : '● Record here'}
            onPress={() => toggleRecord(slot)}
            disabled={(!!recSlot && !recording) || !!busy}
          />
        </View>
      </View>
    );
  };

  return (
    <Card>
      <Text style={{ color: C.text, fontWeight: '700', marginBottom: 4 }}>Copy a real voice (with their consent)</Text>
      <Dim style={{ marginBottom: 10 }}>
        Your own voice, or someone who agrees — family, friends. They don’t need to be with you: send them the statement, and they reply with two voice notes. Google checks that the consent recording is the same person, so recordings of anyone else won’t work.
      </Dim>
      <Field label="Whose voice?" value={name} onChangeText={setName} placeholder="e.g. Mum, Me, Simran" />

      <SlotRow slot="sample" title="1. Talking sample" hint="About 1 minute of them talking naturally, one person only, quiet room. Voice notes, m4a, mp3, wav, or video all work." />

      <View style={{ marginTop: 14 }}>
        <Text style={{ color: C.text, fontWeight: '700' }}>2. Consent recording</Text>
        <Dim style={{ marginBottom: 6 }}>They read this aloud, word for word, in their own voice:</Dim>
        <Field multiline value={statement} onChangeText={setStatement} />
        <Dim style={{ marginTop: -6, marginBottom: 8 }}>
          For Punjabi, Hindi or another language, replace this with Google’s official statement for that language and have them read that version.
        </Dim>
        <Btn small kind="ghost" title="Send statement to them (WhatsApp, SMS…)" onPress={sendStatement} />
      </View>
      <SlotRow slot="consent" title="Consent recording" hint="Their voice note of reading the statement." />

      <Btn title={busy || 'Create voice'} busy={!!busy} onPress={create} style={{ marginTop: 16 }} disabled={!!recSlot} />
    </Card>
  );
}
