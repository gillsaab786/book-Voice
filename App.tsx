import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { AppState, BackHandler, Linking, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { initBackground } from './src/lib/background';
import { converter } from './src/lib/converter';
import { playback } from './src/lib/playback';
import { handleRemoteUrl } from './src/lib/remote';
import { loadSettings } from './src/lib/storage';
import { AppearanceScreen } from './src/ui/AppearanceScreen';
import { BookScreen } from './src/ui/BookScreen';
import { KeysScreen } from './src/ui/KeysScreen';
import { C, setAccent } from './src/ui/kit';
import { LibraryScreen } from './src/ui/LibraryScreen';
import { MiniPlayer } from './src/ui/MiniPlayer';
import { PlayerScreen } from './src/ui/PlayerScreen';
import { QueueScreen } from './src/ui/QueueScreen';
import { SettingsScreen } from './src/ui/SettingsScreen';
import { TextScreen } from './src/ui/TextScreen';
import { VoicesScreen } from './src/ui/VoicesScreen';

type Route =
  | { name: 'library' }
  | { name: 'book'; id: string }
  | { name: 'player' }
  | { name: 'settings' }
  | { name: 'keys' }
  | { name: 'voices' }
  | { name: 'appearance' }
  | { name: 'queue' }
  | { name: 'text'; bookId: string; index: number };

let started = false;

export default function App() {
  const [stack, setStack] = useState<Route[]>([{ name: 'library' }]);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState(0); // bumps when the accent colour changes
  const route = stack[stack.length - 1];
  const push = (r: Route) => setStack((s) => [...s, r]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  useEffect(() => {
    void loadSettings().then((s) => {
      setAccent(s.accent);
      setReady(true);
    });
    if (!started) {
      started = true;
      initBackground();
      void converter.restore(); // carries on with the queue from last time
    }
    const onUrl = (url: string | null | undefined) => {
      if (url?.startsWith('bookvoice://queue')) return push({ name: 'queue' });
      void handleRemoteUrl(url);
    };
    // Pick up exactly where you left off, and obey Siri Shortcut / deep-link commands.
    void playback.restore().then(() => Linking.getInitialURL().then(onUrl));
    const link = Linking.addEventListener('url', (e) => onUrl(e.url));
    const app = AppState.addEventListener('change', (st) => st !== 'active' && void playback.savePosition());
    return () => {
      link.remove();
      app.remove();
    };
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) {
        back();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack.length]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: '#000' }} />;

  let screen: React.ReactNode;
  switch (route.name) {
    case 'library':
      screen = (
        <LibraryScreen
          openBook={(id) => push({ name: 'book', id })}
          openSettings={() => push({ name: 'settings' })}
          openQueue={() => push({ name: 'queue' })}
        />
      );
      break;
    case 'book':
      screen = (
        <BookScreen
          id={route.id}
          onBack={back}
          openPlayer={() => push({ name: 'player' })}
          openText={(index) => push({ name: 'text', bookId: route.id, index })}
        />
      );
      break;
    case 'player':
      screen = <PlayerScreen onBack={back} openText={(bookId, index) => push({ name: 'text', bookId, index })} />;
      break;
    case 'settings':
      screen = <SettingsScreen onBack={back} open={(page) => push({ name: page })} />;
      break;
    case 'keys':
      screen = <KeysScreen onBack={back} />;
      break;
    case 'voices':
      screen = <VoicesScreen onBack={back} />;
      break;
    case 'appearance':
      screen = <AppearanceScreen onBack={back} onAccentChange={() => setTheme((t) => t + 1)} />;
      break;
    case 'queue':
      screen = <QueueScreen onBack={back} openBook={(id) => push({ name: 'book', id })} />;
      break;
    case 'text':
      screen = <TextScreen bookId={route.bookId} index={route.index} onBack={back} />;
      break;
  }

  const full = route.name === 'player' || route.name === 'text';
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView key={theme} style={{ flex: 1, backgroundColor: C.bg }} edges={full ? ['left', 'right'] : ['top', 'left', 'right', 'bottom']}>
        <View style={{ flex: 1 }}>{screen}</View>
        {!full && !['settings', 'keys', 'voices', 'appearance'].includes(route.name) ? <MiniPlayer onOpen={() => push({ name: 'player' })} /> : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
