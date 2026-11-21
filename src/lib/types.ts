export type BookFormat = 'epub' | 'pdf' | 'txt' | 'docx' | 'html' | 'md';

export type ChapterStatus = 'pending' | 'scripting' | 'scripted' | 'speaking' | 'done' | 'error';

/** One narrated unit. `speaker` DIALOGUE = words spoken aloud by a character. */
export type Segment = { speaker: 'NARRATOR' | 'DIALOGUE'; style?: string; text: string; /** paragraph index in the chapter (set when chunking) */ i?: number };

export type Chapter = {
  id: string;
  title: string;
  /** PDF only: 1-based physical page range */
  pages?: [number, number];
  status: ChapterStatus;
  error?: string;
  /** chunks of TTS completed (for resume) */
  chunksDone?: number;
  chunksTotal?: number;
  /** bytes of PCM written into the partial wav (for resume) */
  pcmBytes?: number;
  sampleRate?: number;
  durationSec?: number;
  /** label of the voice used, e.g. "Sulafat · warm audiobook narrator" */
  voiceLabel?: string;
};

export type Book = {
  id: string;
  title: string;
  author?: string;
  format: BookFormat;
  sourceName: string;
  addedAt: number;
  chapters: Chapter[];
  geminiFile?: { uri: string; mimeType: string; expiresAt: number };
  /** PDFs whose text was extracted (on the phone or by OCR) are converted like EPUBs. */
  pdfText?: boolean;
  /** How this book is voiced (chosen when queued). */
  profile?: VoiceProfile;
  position?: { chapter: number; time: number };
};

export type VoiceChoice = { id: string; label: string; prebuilt: boolean };

/** Which service speaks a book. */
export type Engine = 'gemini' | 'device' | 'azure' | 'elevenlabs';

/** Everything that decides how a book sounds. Snapshotted onto a book when it's queued. */
export type VoiceProfile = {
  engine: Engine;
  voice: VoiceChoice; // Gemini voice / phone voice id / Azure voice name / ElevenLabs voice id
  dialogueMode: boolean;
  dialogueVoice: VoiceChoice;
  style: string;
  languageCode: string;
  narration: 'faithful' | 'storyteller';
  adaptText: boolean;
  rate: number; // phone / Azure speaking speed (1 = normal)
  /** Gemini only: which speech model (each has its own daily allowance) */
  ttsModel?: string;
};

export type Settings = {
  provider: 'gemini' | 'elevenlabs';
  engine: Engine;
  deviceVoice: VoiceChoice;
  azureVoice: VoiceChoice;
  azureRegion: string;
  speechRate: number;
  accent: string;
  appIcon: string;
  ttsModel: string;
  textModel: string;
  voice: VoiceChoice;
  style: string;
  languageCode: string; // '' = auto
  adaptText: boolean;
  /** faithful = every word of the book; storyteller = told aloud like a person telling you the story */
  narration: 'faithful' | 'storyteller';
  dialogueMode: boolean;
  dialogueVoice: VoiceChoice;
  concurrency: number;
  chunkChars: number;
  elevenVoiceId: string;
  elevenModel: string;
  playbackRate: number;
  lastBookId?: string;
  readTheme: 'auto' | 'oled' | 'red' | 'dark' | 'sepia' | 'paper';
  readDim: number; // 0..0.7 extra darkening of the reading page
  readFontSize: number;
  keepAwake: boolean; // keep screen on while the read-along page is open
  backgroundWork: boolean; // keep converting with the app in the background
  liveActivity: boolean; // progress on Lock Screen / Dynamic Island
  previewDownloads: boolean; // fetch voice samples a few a day
  myVoices: { id: string; label: string; description: string; createdAt: number }[];
};

/** Starting points for Design a voice — edit freely. */
export const DESIGN_PRESETS: { name: string; gender: string; lang: string; text: string }[] = [
  // ---- signature female narrators ----
  { name: '✦ Gulab — Punjabi silk', gender: 'female', lang: 'pa-IN', text: 'A young Punjabi woman in her mid-twenties with a beautiful, silky, honey-warm voice. Natural Majha Punjabi accent, soft rounded vowels, a gentle melodic lilt that rises and falls like folk singing. Bright on top, velvety underneath. Smiles through happy lines, softens to almost a whisper in tender moments. Unhurried, intimate storytelling, as if sitting close beside the listener.' },
  { name: '✦ Noor — Punjabi glow', gender: 'female', lang: 'pa-IN', text: 'A Punjabi woman around thirty with a clear, luminous, ringing voice that carries effortlessly. Confident and spirited, playful sparkle in her tone, crisp consonants, a hint of laughter always near. Rich mid-range warmth, effortless breath control, beautifully expressive in emotional scenes without ever sounding forced.' },
  { name: '✦ Meera — Hindi moonlight', gender: 'female', lang: 'hi-IN', text: 'A young Indian woman with an exquisitely sweet, pure, high-clarity Hindi voice. Delicate and airy like a classical vocalist speaking, very precise diction, soft breathy edges on gentle words. Calm, graceful and deeply soothing; every sentence flows like a slow melody.' },
  { name: '✦ Zoya — Urdu velvet', gender: 'female', lang: 'ur-PK', text: 'A woman in her early thirties with a deep, velvety, poetic voice and refined Urdu-Hindustani pronunciation. Slightly low and smoky, elegant and romantic, measured pace with graceful pauses, like reciting ghazals. Warm, intimate and quietly powerful.' },
  { name: '✦ Aria — English warm honey', gender: 'female', lang: 'en-GB', text: 'A woman in her late twenties with a gorgeous warm, honeyed voice and a soft, refined British accent. Smooth and resonant with a gentle breathiness, light smile in the tone. Unhurried, elegant audiobook narration that feels like a close friend reading by the fire.' },
  { name: '✦ Lila — English bright crystal', gender: 'female', lang: 'en-US', text: 'A young American woman with a crystal-clear, bright, sparkling voice. Light and musical with a natural upward lilt, warm and kind, effortlessly expressive. Quick wit when the story is fun, tender and hushed when it is sad.' },
  { name: '✦ Sienna — English smoky soul', gender: 'female', lang: 'en-AU', text: 'A woman in her thirties with a soft Australian accent and a beautiful husky, smoky voice with a slight rasp. Soulful and emotional, intimate low register, aching vulnerability in quiet moments and real power when the story builds.' },
  { name: '✦ Isha — Indian-English soft', gender: 'female', lang: 'en-IN', text: 'A young woman with a gentle Indian-English accent and a soft, sweet, melodic voice. Clear and graceful, caring and calm, slight musical cadence from Hindi and Punjabi; perfect for long, relaxing listening.' },
  // ---- taste-test set: deliberately different from each other ----
  { name: '◆ Chandni — high & airy (Punjabi)', gender: 'female', lang: 'pa-IN', text: 'A young Punjabi woman with a high, light, floating voice. Airy and sweet, delicate head-voice quality, gentle and dreamy, soft melodic lilt on every line.' },
  { name: '◆ Tara — bright & cheeky (Punjabi)', gender: 'female', lang: 'pa-IN', text: 'A young Punjabi woman with a bright, slightly nasal, sharp and distinctive voice. Cheeky, confident, full of attitude and fun, fast lively rhythm, strong Punjabi accent.' },
  { name: '◆ Jasmeet — folk power (Punjabi)', gender: 'female', lang: 'pa-IN', text: 'A Punjabi woman in her thirties with a full, strong, open-throated voice. Bold and earthy, ringing power like a folk singer, proud and emotional, big dynamic range.' },
  { name: '◆ Raina — deep & smoky (Hindi)', gender: 'female', lang: 'hi-IN', text: 'A Hindi-speaking woman with a low, deep, smoky voice. Slow, sensual and mysterious, dark velvet tone, long pauses, quietly commanding.' },
  { name: '◆ Kavya — calm & pure (Hindi)', gender: 'female', lang: 'hi-IN', text: 'A young woman with a calm, pure, perfectly clear Hindi voice. Mid pitch, no breathiness, serene and kind, steady gentle pace, very relaxing.' },
  { name: '◆ Jade — raspy & powerful (English)', gender: 'female', lang: 'en-AU', text: 'A woman with an Australian accent and a raspy, gritty, cracking voice full of raw emotion. Powerful and dramatic, breaks slightly on intense words, vulnerable when quiet.' },
  { name: '◆ Willow — breathy whisper (English)', gender: 'female', lang: 'en-US', text: 'A young woman with a very soft, breathy, close-to-the-microphone voice. Hushed and intimate, almost whispering, slow and calming.' },
  { name: '◆ Rose — mid & cheerful (English)', gender: 'female', lang: 'en-GB', text: 'A woman in her late twenties with a mid-pitched, warm, cheerful voice and a light British accent. Natural, conversational and upbeat, like a favourite radio host.' },
  // ---- more storytellers ----
  { name: '◆ Simran — late-night stories (Punjabi)', gender: 'female', lang: 'pa-IN', text: 'A Punjabi woman in her late twenties telling stories late at night to someone she loves. Soft, warm, slightly husky, smiling voice, natural little laughs and sighs, slow and cosy.' },
  { name: '◆ Biji — grandmother (Punjabi)', gender: 'female', lang: 'pa-IN', text: 'A loving Punjabi grandmother in her seventies. Gentle, slightly creaky, very warm voice, village accent, unhurried, full of affection and wisdom, pauses to let a moment sink in.' },
  { name: '◆ Anjali — big sister (Hindi)', gender: 'female', lang: 'hi-IN', text: 'A friendly young Hindi-speaking woman like a fun older sister. Bright, natural, conversational voice, animated and expressive, does little character voices, laughs easily.' },
  { name: '◆ Nadia — radio drama (English)', gender: 'female', lang: 'en-GB', text: 'A British woman in her thirties with a rich, theatrical radio-drama voice. Warm mid-low tone, superb control, builds tension beautifully, brings every character to life.' },
  { name: '◆ Mia — best friend (English)', gender: 'female', lang: 'en-AU', text: 'A young Australian woman chatting with her best friend. Relaxed, natural, slightly breathy, real human rhythm with tiny hesitations and smiles, honest and warm.' },
  { name: '◆ Veer — campfire (Punjabi)', gender: 'male', lang: 'pa-IN', text: 'A Punjabi man in his thirties telling stories around a fire. Warm, rich, slightly gravelly voice, strong accent, dramatic pauses, real laughter, pulls the listener in.' },
  { name: '◆ Arjun — calm (Hindi)', gender: 'male', lang: 'hi-IN', text: 'A Hindi-speaking man with a calm, deep, soothing voice. Clear diction, gentle warmth, slow pace, trustworthy and peaceful.' },
  { name: '◆ Jack — mate at the pub (English)', gender: 'male', lang: 'en-AU', text: 'An Australian man in his forties telling a yarn to a mate. Easy-going, warm, slightly rough voice, dry humour, natural pauses and chuckles, completely unscripted feel.' },
  // ---- other starting points ----
  { name: 'Punjabi female storyteller', gender: 'female', lang: 'pa-IN', text: 'Young adult woman with a natural Punjabi accent. Bright, clear, melodic tone with a lot of warmth. Expressive and lively, but unhurried — a gifted storyteller who smiles while she talks.' },
  { name: 'Punjabi male, rustic', gender: 'male', lang: 'pa-IN', text: 'Man in his thirties with a strong rural Punjabi accent. Deep, slightly rough, resonant voice. Confident and heartfelt, steady storytelling pace, emotion carried in the low notes.' },
  { name: 'Punjabi elder', gender: 'male', lang: 'pa-IN', text: 'Grandfatherly Punjabi man in his sixties. Warm, slightly husky, wise and affectionate. Slow, deliberate pace with natural pauses, like telling stories in the evening.' },
  { name: 'Hindi female, soft', gender: 'female', lang: 'hi-IN', text: 'Woman with a soft, sweet Hindi voice. Gentle and airy with very clear diction. Tender, calm and soothing, ideal for long listening.' },
  { name: 'Hindi female, powerful', gender: 'female', lang: 'hi-IN', text: 'Woman with a strong, full, ringing Hindi voice. Bold and dramatic, wide emotional range, crisp and energetic delivery.' },
  { name: 'English female, husky', gender: 'female', lang: 'en-US', text: 'Woman with a husky, breathy, slightly raspy voice. Intimate and emotional, dramatic narration that leans into feelings.' },
  { name: 'English female, sparkly', gender: 'female', lang: 'en-US', text: 'Young woman with a bright, light, playful voice. Friendly and confident, quick smile in the tone, clear and lively.' },
  { name: 'English male, deep', gender: 'male', lang: 'en-GB', text: 'Older man with a deep, warm, gravelly voice. Calm, measured, classic audiobook narrator with rich resonance.' },
];

export const DEFAULT_SETTINGS: Settings = {
  provider: 'gemini',
  engine: 'gemini',
  deviceVoice: { id: '', label: 'Phone default voice', prebuilt: false },
  azureVoice: { id: 'pa-IN-VaaniNeural', label: 'Vaani (Punjabi)', prebuilt: false },
  azureRegion: 'australiaeast',
  speechRate: 1,
  accent: 'Amber',
  appIcon: '',
  ttsModel: 'gemini-3.8-flash-tts',
  textModel: 'gemini-3.5-flash-lite',
  voice: { id: 'Sulafat', label: 'Sulafat — warm', prebuilt: true },
  style: 'warm, natural storyteller talking to one listener; relaxed pace; follows the emotion of the scene',
  languageCode: '',
  adaptText: true,
  narration: 'storyteller',
  dialogueMode: false,
  dialogueVoice: { id: 'Achird', label: 'Achird — friendly', prebuilt: true },
  concurrency: 2,
  chunkChars: 1800,
  elevenVoiceId: '',
  elevenModel: 'eleven_multilingual_v2',
  playbackRate: 1,
  myVoices: [],
  readTheme: 'auto',
  readDim: 0,
  readFontSize: 21,
  keepAwake: false,
  backgroundWork: true,
  liveActivity: true,
  previewDownloads: true,
};

export const GEMINI_TTS_MODELS: [string, string, string][] = [
  ['gemini-3.8-flash-tts', 'Flash TTS', 'Best quality'],
  ['gemini-3.8-flash-lite-tts', 'Flash-Lite TTS', 'Lighter model with its own daily allowance'],
];

export const PREBUILT_VOICES: [string, string][] = [
  ['Zephyr', 'bright'], ['Puck', 'upbeat'], ['Charon', 'informative'], ['Kore', 'firm'],
  ['Fenrir', 'excitable'], ['Leda', 'youthful'], ['Orus', 'firm'], ['Aoede', 'breezy'],
  ['Callirrhoe', 'easy-going'], ['Autonoe', 'bright'], ['Enceladus', 'breathy'], ['Iapetus', 'clear'],
  ['Umbriel', 'easy-going'], ['Algieba', 'smooth'], ['Despina', 'smooth'], ['Erinome', 'clear'],
  ['Algenib', 'gravelly'], ['Rasalgethi', 'informative'], ['Laomedeia', 'upbeat'], ['Achernar', 'soft'],
  ['Alnilam', 'firm'], ['Schedar', 'even'], ['Gacrux', 'mature'], ['Pulcherrima', 'forward'],
  ['Achird', 'friendly'], ['Zubenelgenubi', 'casual'], ['Vindemiatrix', 'gentle'], ['Sadachbia', 'lively'],
  ['Sadaltager', 'knowledgeable'], ['Sulafat', 'warm'],
];

export const STYLE_PRESETS: [string, string][] = [
  ['Storyteller', 'warm, natural storyteller talking to one listener; relaxed pace; follows the emotion of the scene'],
  ['Cosy & close', 'intimate and cosy, as if sitting right beside me late at night; soft, smiling, unhurried'],
  ['Audiobook', 'warm, natural audiobook narrator; relaxed pace; follows the emotion of the scene'],
  ['Punjabi storyteller', 'expressive Punjabi storyteller with a natural Punjabi accent; heartfelt and lively'],
  ['Hindi kahaani', 'gentle Hindi storyteller, soft and expressive, unhurried'],
  ['Bedtime', 'calm, soft and slow, soothing bedtime reading'],
  ['Thriller', 'low, tense and dramatic; builds suspense; quickens in action scenes'],
  ['Non-fiction', 'clear, confident and engaging, like a great lecturer'],
];

export const LANGUAGES: [string, string][] = [
  ['', 'Auto'], ['en-AU', 'English (AU)'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-IN', 'English (India)'],
  ['pa-IN', 'Punjabi'], ['hi-IN', 'Hindi'], ['ur-PK', 'Urdu'],
];
