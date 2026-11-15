import { useEffect, useState } from 'react';
import { converter, Progress } from '../lib/converter';
import { playback, PlayState } from '../lib/playback';
import { listBooks, loadBook, onBookSaved } from '../lib/storage';
import { Book } from '../lib/types';

export function useConverter(): Progress {
  const [p, setP] = useState(converter.progress);
  useEffect(() => converter.subscribe(setP), []);
  return p;
}

export function usePlayback(): PlayState {
  const [p, setP] = useState(playback.state);
  useEffect(() => playback.subscribe(setP), []);
  return p;
}

export function useBook(id: string): Book | null {
  const [b, setB] = useState<Book | null>(null);
  useEffect(() => {
    loadBook(id).then(setB).catch(() => setB(null));
    return onBookSaved((nb) => nb.id === id && setB({ ...nb, chapters: nb.chapters.map((c) => ({ ...c })) }));
  }, [id]);
  return b;
}

export function useBooks(): [Book[], () => void] {
  const [books, setBooks] = useState<Book[]>([]);
  const reload = () => void listBooks().then(setBooks);
  useEffect(() => {
    reload();
    let t: any;
    const off = onBookSaved(() => {
      clearTimeout(t);
      t = setTimeout(reload, 400);
    });
    return () => {
      off();
      clearTimeout(t);
    };
  }, []);
  return [books, reload];
}
