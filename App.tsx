import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { AppState, BackHandler, Linking, View } from 'react-native';
import { playback } from './src/lib/playback';
import { handleRemoteUrl } from './src/lib/remote';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { BookScreen } from './src/ui/BookScreen';
import { C } from './src/ui/kit';
import { LibraryScreen } from './src/ui/LibraryScreen';
import { MiniPlayer } from './src/ui/MiniPlayer';
import { PlayerScreen } from './src/ui/PlayerScreen';
import { SettingsScreen } from './src/ui/SettingsScreen';
import { TextScreen } from './src/ui/TextScreen';

type Route =
  | { name: 'library' }
  | { name: 'book'; id: string }
  | { name: 'player' }
  | { name: 'settings' }
  | { name: 'text'; bookId: string; index: number };

export default function App() {
  const [stack, setStack] = useState<Route[]>([{ name: 'library' }]);
  const route = stack[stack.length - 1];
  const push = (r: Route) => setStack((s) => [...s, r]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  // Pick up exactly where you left off, and obey Siri Shortcut / deep-link commands.
  useEffect(() => {
    void playback.restore().then(() => Linking.getInitialURL().then(handleRemoteUrl));
    const link = Linking.addEventListener('url', (e) => void handleRemoteUrl(e.url));
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

  let screen: React.ReactNode;
  switch (route.name) {
    case 'library':
      screen = <LibraryScreen openBook={(id) => push({ name: 'book', id })} openSettings={() => push({ name: 'settings' })} />;
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
      screen = <SettingsScreen onBack={back} />;
      break;
    case 'text':
      screen = <TextScreen bookId={route.bookId} index={route.index} onBack={back} />;
      break;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={route.name === 'player' || route.name === 'text' ? ['left', 'right'] : ['top', 'left', 'right', 'bottom']}>
        <View style={{ flex: 1 }}>{screen}</View>
        {route.name !== 'player' && route.name !== 'settings' ? <MiniPlayer onOpen={() => push({ name: 'player' })} /> : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
