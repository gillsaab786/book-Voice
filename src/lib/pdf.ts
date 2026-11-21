// Reading PDFs: text straight from the file on the phone; OCR for scanned pages.
import { File } from 'expo-file-system';
import { pdfPagesText } from '../../modules/bookvoice-native/src';
import { keyFor } from './ai';
import { bytesToBase64 } from './bytes';

const letters = (t: string) => t.replace(/[^\p{L}]/gu, '').length;

function enoughText(pages: string[]) {
  const nonEmpty = pages.filter((p) => letters(p) > 20);
  if (!nonEmpty.length) return false;
  const avg = nonEmpty.reduce((a, p) => a + letters(p), 0) / pages.length;
  return avg >= 120 && nonEmpty.length >= pages.length * 0.5;
}

/** Text of each page, or null when the PDF is scanned and no OCR key is available. */
export async function readPdfPages(src: File, say: (m: string) => void): Promise<string[] | null> {
  let why = '';
  try {
    say('Reading the PDF on your phone…');
    const pages = await pdfPagesText(src.uri);
    if (enoughText(pages)) return pages;
    why = 'scanned';
  } catch (e: any) {
    why = e?.message || 'unreadable';
    if (/password|locked|encrypt/i.test(why)) throw new Error('This PDF is password-protected. Remove the password, then add it again.');
  }
  const mistral = await keyFor('mistral');
  if (mistral) {
    say('Scanned pages — reading them with Mistral OCR…');
    return mistralOcr(mistral, src);
  }
  return null;
}

async function mistralOcr(key: string, src: File): Promise<string[]> {
  const b64 = bytesToBase64(await src.bytes());
  const res = await fetch('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mistral-ocr-latest',
      document: { type: 'document_url', document_url: `data:application/pdf;base64,${b64}` },
      include_image_base64: false,
    }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Mistral OCR: ${j?.message || j?.detail || res.status}`);
  return (j.pages || [])
    .sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0))
    .map((p: any) => String(p.markdown || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/^#+\s*/gm, ''));
}

export { pdfToBook } from './pdfText';
