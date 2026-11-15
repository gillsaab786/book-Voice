// Reading themes for the read-along page and book text.
// OLED themes use true black (#000) so unused pixels are fully off: no glow, less battery.

export type ThemeId = 'auto' | 'oled' | 'red' | 'dark' | 'sepia' | 'paper';

export type ReadTheme = {
  name: string;
  bg: string;
  text: string; // sentence being read
  body: string; // rest of the page
  sentenceBg: string;
  wordBg: string;
  wordText: string;
  heading: string;
  panel: string; // player controls background
  panelText: string;
  line: string;
  statusBar: 'light' | 'dark';
};

export const THEMES: Record<Exclude<ThemeId, 'auto'>, ReadTheme> = {
  // Warm, low-glare text on true black: the night default. No pure white anywhere.
  oled: {
    name: 'OLED Night', bg: '#000000', text: '#E8D9C0', body: '#7E7568', sentenceBg: '#1A1206', wordBg: '#7A4B00', wordText: '#FFE7BF',
    heading: '#B07A2A', panel: '#000000', panelText: '#BFB3A0', line: '#1A1A1A', statusBar: 'light',
  },
  // Red only: least disruptive to night vision and sleep (like astronomers' red torches).
  red: {
    name: 'Red Night', bg: '#000000', text: '#FF6B5E', body: '#7A2A24', sentenceBg: '#1C0503', wordBg: '#6E140C', wordText: '#FFB3AA',
    heading: '#A8352B', panel: '#000000', panelText: '#B5463C', line: '#1A0806', statusBar: 'light',
  },
  dark: {
    name: 'Dark', bg: '#000000', text: '#F5F5F7', body: '#C7C7CC', sentenceBg: 'rgba(255,159,10,0.16)', wordBg: '#FF9F0A', wordText: '#000000',
    heading: '#FF9F0A', panel: '#111113', panelText: '#F5F5F7', line: '#2A2A2E', statusBar: 'light',
  },
  sepia: {
    name: 'Sepia', bg: '#F4ECD8', text: '#3B2F1E', body: '#6B5A42', sentenceBg: '#E8D7AE', wordBg: '#B8862F', wordText: '#FFF8E8',
    heading: '#8A5A12', panel: '#EADFC4', panelText: '#3B2F1E', line: '#D9CBA6', statusBar: 'dark',
  },
  paper: {
    name: 'Paper', bg: '#FFFFFF', text: '#111111', body: '#444444', sentenceBg: '#FFF1D6', wordBg: '#FF9F0A', wordText: '#000000',
    heading: '#B06A00', panel: '#F2F2F7', panelText: '#111111', line: '#E5E5EA', statusBar: 'dark',
  },
};

export const THEME_ORDER: ThemeId[] = ['auto', 'oled', 'red', 'dark', 'sepia', 'paper'];

/** Auto: OLED Night from 8 pm to 6 am, Dark during the day. */
export function resolveTheme(id: ThemeId, now = new Date()): ReadTheme {
  if (id !== 'auto') return THEMES[id];
  const h = now.getHours();
  return h >= 20 || h < 6 ? THEMES.oled : THEMES.dark;
}

export const themeLabel = (id: ThemeId) => (id === 'auto' ? 'Auto (night after 8 pm)' : THEMES[id].name);
