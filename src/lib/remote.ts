import { playback, SKIP_SEC } from './playback';

/**
 * bookvoice:// links — used by Siri Shortcuts (Open URL action), Android Assistant routines,
 * home-screen shortcuts, NFC tags… e.g.
 *   bookvoice://rewind        (40 s back)     bookvoice://rewind?s=60
 *   bookvoice://forward       bookvoice://next      bookvoice://previous
 *   bookvoice://play          bookvoice://pause     bookvoice://toggle
 */
export const REMOTE_LINKS: [string, string][] = [
  ['Rewind 40 seconds', 'bookvoice://rewind'],
  ['Forward 40 seconds', 'bookvoice://forward'],
  ['Next chapter', 'bookvoice://next'],
  ['Previous chapter', 'bookvoice://previous'],
  ['Resume my book', 'bookvoice://play'],
  ['Pause', 'bookvoice://pause'],
];

export async function handleRemoteUrl(url: string | null | undefined) {
  if (!url || !url.startsWith('bookvoice://')) return;
  const [, rest = ''] = url.split('://');
  const [action, query = ''] = rest.split('?');
  const sec = Number(new URLSearchParams(query).get('s')) || SKIP_SEC;
  if (!playback.state.book) await playback.restore();
  switch (action.replace(/\/$/, '').toLowerCase()) {
    case 'rewind':
    case 'back':
      return playback.seekBy(-sec);
    case 'forward':
      return playback.seekBy(sec);
    case 'next':
      return playback.next(1);
    case 'previous':
    case 'prev':
      return playback.next(-1);
    case 'pause':
      return playback.pause();
    case 'toggle':
      return playback.toggle();
    case 'play':
    case 'resume':
      return playback.play();
  }
}
