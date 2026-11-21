// Back up / restore all keys and settings as one file you keep (Files, iCloud Drive, Google Drive…).
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { exportKeys, importKeys } from './ai';
import { getKey, loadSettings, saveSettings, setKey } from './storage';
import { DEFAULT_SETTINGS, Settings } from './types';

type Backup = {
  app: 'BookVoice';
  version: 1;
  createdAt: string;
  settings: Settings;
  keys: { gemini?: string | null; azure?: string | null; eleven?: string | null };
  aiKeys: Awaited<ReturnType<typeof exportKeys>>;
};

export async function makeBackup(): Promise<void> {
  const s = await loadSettings();
  const b: Backup = {
    app: 'BookVoice',
    version: 1,
    createdAt: new Date().toISOString(),
    settings: { ...s, lastBookId: undefined },
    keys: { gemini: await getKey('gemini'), azure: await getKey('azure'), eleven: await getKey('eleven') },
    aiKeys: await exportKeys(),
  };
  const stamp = new Date().toISOString().slice(0, 10);
  const f = new File(Paths.cache, `BookVoice-backup-${stamp}.json`);
  if (f.exists) f.delete();
  f.create();
  f.write(JSON.stringify(b, null, 2));
  await Sharing.shareAsync(f.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Save BookVoice backup' });
}

/** Returns a short summary of what was restored, or null if cancelled. */
export async function restoreBackup(): Promise<string | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
  if (r.canceled || !r.assets[0]) return null;
  let b: Backup;
  try {
    b = JSON.parse(await new File(r.assets[0].uri).text());
  } catch {
    throw new Error("That file isn't a BookVoice backup.");
  }
  if (b?.app !== 'BookVoice' || !b.settings) throw new Error("That file isn't a BookVoice backup.");
  const current = await loadSettings();
  await saveSettings({ ...DEFAULT_SETTINGS, ...b.settings, lastBookId: current.lastBookId });
  let restored = 0;
  for (const name of ['gemini', 'azure', 'eleven'] as const) {
    const v = b.keys?.[name];
    if (v) {
      await setKey(name, v);
      restored++;
    }
  }
  const n = await importKeys(b.aiKeys || []);
  return `Settings restored, ${restored} voice key${restored === 1 ? '' : 's'} and ${n} AI key${n === 1 ? '' : 's'} added.`;
}
