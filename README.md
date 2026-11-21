# BookVoice

A personal e-reader that turns your books into natural-sounding audiobooks with your own Gemini API key, saves them on the phone as lossless audio, and plays them with lock-screen controls.

## What it does
- **Add books:** EPUB, PDF, DOCX, TXT, HTML and Markdown. Kindle formats (MOBI/AZW) need converting to EPUB first with Calibre.
- **Adapt for listening:** Gemini (`gemini-3.8-flash`) rewrites each chapter for the ear. It removes page numbers and footnote markers, expands abbreviations, describes tables, turns lists into sentences, and marks dialogue, emotion and pauses. It doesn't summarise anything. PDFs are read directly by Gemini, so scanned and multi-column books work too.
- **Recording:** `gemini-3.8-flash-tts` reads each chapter in your chosen voice and style. You can pick from 30 standard voices or search the 2,000+ voice library (Punjabi, Hindi and so on). There's an optional second voice for character dialogue.
- **Saving:** one lossless WAV per chapter (16-bit, 24 kHz, about 170 MB per hour) in `Documents/Books/<id>/`.
  - **iPhone:** visible in the Files app under *On My iPhone ▸ BookVoice*.
  - **Both platforms:** *Export audio* copies the whole book to any folder you choose.
- **Resuming:** conversion picks up where it stopped (chunk by chunk). Keep the app open while it converts, because phones pause background network work.
- **Player:** background playback, 0.8×–2× speed, sleep timer and auto-advance to the next chapter.
- **40-second skips:** buttons on screen and on the lock screen, plus YouTube-style double-tap left or right on the page.
- **Next chapter:** on screen, on the lock screen and on headphones, and Siri's "next track" works too.
- **Resume:** your exact spot (book, chapter, second) is saved, so reopening the app brings you straight back.
- **Read-along page:** the current sentence is lit and the current word highlighted, the page scrolls itself, and you can tap any sentence to jump there. Timing comes from detecting the narrator's pauses in the generated audio.
- **Siri Shortcuts and assistant routines:** `bookvoice://rewind`, `forward`, `next`, `previous`, `play`, `pause`. Add `?s=60` to a rewind or forward link to change the jump.
- **Optional ElevenLabs:** use a voice from your own ElevenLabs account instead of Gemini.

## Speed, keys and the queue
- **AI keys** (Settings ▸ AI keys): paste keys from any service (Groq, NVIDIA, Mistral, OpenRouter, SambaNova, GitHub Models, Cerebras, Hugging Face, DeepSeek…). The app detects the service and model, and every key adapts chapters in parallel.
- **Voice services:** Gemini (most human-like; small free daily speech allowance), phone voices (unlimited, offline, fast), Microsoft Azure (free 500k characters/month, Punjabi and Hindi), ElevenLabs.
- **Queue:** add many books, each with its own voice. Books on different voice services convert at the same time.
- **Background:** conversion keeps going with the app in the background (silent-audio keep-alive), with progress on the Lock Screen, in the Dynamic Island (Live Activity) and in the Android notification.
- **PDFs:** text is read on the phone (PDFKit / PDFBox). Scanned PDFs use Mistral OCR if you added a Mistral key, otherwise Gemini.
- **Appearance:** accent colours, and 36 app icons (4 designs in every accent). Liquid Glass on iOS 26.

## Copying a voice (with consent)
Settings ▸ Copy a real voice. You need two recordings of the same person: about 1 minute of them talking naturally, and them reading Google's consent statement aloud. Voice notes, M4A, MP3, WAV and video files are all converted on the phone to the WAV format Google requires (24 kHz, 16-bit, mono). Google checks that the consent recording matches the speaker, so only voices whose owners agree can be copied.

## Build with Codemagic
1. Push this folder to a GitHub, GitLab or Bitbucket repo.
2. At codemagic.io, add the app from that repo. Codemagic finds `codemagic.yaml` automatically.
3. Start **BookVoice Android APK** or **BookVoice iPhone IPA (unsigned)** (both also run on every push to `main`).
4. Download the artifacts: install `BookVoice.apk` on Android, and sideload `BookVoice-unsigned.ipa` with Sideloadly.

## Build with GitHub Actions (alternative)
Push to GitHub, and the **Build APK + IPA** Action produces:
- `BookVoice-android` → `BookVoice.apk`. Install it on Android (allow "install unknown apps").
- `BookVoice-ios` → `BookVoice-unsigned.ipa`. Install it with **Sideloadly** from Windows using your Apple ID. A free Apple ID needs re-signing every 7 days.

To run it locally: `npm install`, then `npx expo run:android` or `npx expo run:ios` (iOS needs a Mac).

## First run
Open Settings (⚙︎), paste your Gemini key, pick a voice, and tap **Preview**. Add a book, then tap **Convert to audio**.
