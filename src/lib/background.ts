// Keeps converting while the app is in the background, the way iTorrent / Now Feed+ do:
// a silent audio track that mixes with your music keeps the app alive, a Live Activity shows
// progress on the Lock Screen and Dynamic Island (iPhone), and the media notification shows
// the percentage on Android.
import { AppState, Platform } from 'react-native';
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as LiveActivity from 'expo-live-activity';
import { converter, Progress } from './converter';
import { playback } from './playback';
import { accentHex } from '../ui/kit';

let player: AudioPlayer | null = null;
let activityId: string | undefined;
let lastLine = '';
let lastPush = 0;

function summary(p: Progress) {
  const books = Object.values(p.books).filter((b) => b.state !== 'done');
  const active = books.filter((b) => b.state === 'reading' || b.state === 'recording');
  const main = active[0] || books[0];
  if (!main) return null;
  const pct = Math.round(main.percent * 100);
  const eta = main.eta && main.eta > 30 ? ` · ~${fmtEta(main.eta)} left` : '';
  const others = books.length > 1 ? ` · +${books.length - 1} more` : '';
  return {
    title: `${main.title}`,
    subtitle: `${main.state === 'waiting' ? 'Waiting' : `${pct}% converted`}${eta}${others}`,
    progress: Math.max(0, Math.min(1, main.percent)),
    line: `${pct}% · ${main.title}`,
  };
}

export function fmtEta(sec: number) {
  if (sec < 90) return `${Math.round(sec)} s`;
  if (sec < 5400) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1)} h`;
}

async function startKeepAlive() {
  if (player) return;
  if (playback.state.playing) return; // listening to a book already keeps the app alive
  await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'mixWithOthers' }).catch(() => {});
  player = createAudioPlayer(require('../../assets/silence.wav'));
  player.loop = true;
  player.volume = 0.01;
  player.play();
}

function stopKeepAlive() {
  if (!player) return;
  try {
    player.clearLockScreenControls();
    player.remove();
  } catch {}
  player = null;
}

function showOnLockScreen(s: { title: string; subtitle: string }) {
  // Android: this is the ongoing notification that keeps the app running, with the percentage.
  if (!player || playback.state.playing) return;
  try {
    if (!lastLine) player.setActiveForLockScreen(true, { title: s.title, artist: s.subtitle, albumTitle: 'BookVoice' });
    else player.updateLockScreenMetadata({ title: s.title, artist: s.subtitle, albumTitle: 'BookVoice' });
  } catch {}
}

function liveActivity(s: { title: string; subtitle: string; progress: number } | null) {
  if (Platform.OS !== 'ios') return;
  try {
    if (!s) {
      if (activityId) LiveActivity.stopActivity(activityId, { title: 'Books converted', subtitle: 'Ready to listen', progressBar: { progress: 1 } });
      activityId = undefined;
      return;
    }
    const state = { title: s.title, subtitle: s.subtitle, progressBar: { progress: s.progress } };
    if (!activityId) {
      if (AppState.currentState !== 'active') return; // iOS only allows starting one from the foreground
      activityId =
        LiveActivity.startActivity(state, {
          backgroundColor: '#000000',
          titleColor: '#FFFFFF',
          subtitleColor: '#B0B0B5',
          progressViewTint: accentHex(),
          progressViewLabelColor: '#FFFFFF',
          deepLinkUrl: 'bookvoice://queue',
        }) || undefined;
    } else {
      LiveActivity.updateActivity(activityId, state);
    }
  } catch {}
}

/** Wire it up once at app start. */
export function initBackground() {
  converter.subscribe((p) => {
    const s = summary(p);
    const working = Object.values(p.books).some((b) => b.state === 'reading' || b.state === 'recording' || b.state === 'queued');
    if (working && s) {
      void startKeepAlive();
      const now = Date.now();
      if (s.line !== lastLine || now - lastPush > 15000) {
        showOnLockScreen(s);
        liveActivity(s);
        lastLine = s.line;
        lastPush = now;
      }
    } else {
      stopKeepAlive();
      liveActivity(null);
      lastLine = '';
    }
  });
  // When a book starts playing, its own audio keeps the app alive.
  playback.subscribe((st) => {
    if (st.playing && player) stopKeepAlive();
    else if (!st.playing && converter.progress.running && !player) void startKeepAlive();
  });
  AppState.addEventListener('change', (st) => {
    if (st === 'active' && converter.progress.running) {
      const s = summary(converter.progress);
      if (s) liveActivity(s);
    }
  });
}
