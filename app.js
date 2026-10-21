import {
  cleanOcrText, splitSentences, wordIndexAt, parseDictionary, lookupIpa, compareWords,
} from './lib/text.js';

// ---------------------------------------------------------------- config
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const TESSDATA_URL = new URL('./tessdata/', document.baseURI).href;
const DICT_URL = new URL('./data/cmudict.txt', document.baseURI).href;
const MAX_SIDE = 2000; // downscale big phone photos before OCR (faster, same accuracy)

// tess = Tesseract model file in /tessdata, speech = BCP-47 tag for voices and recognition.
const LANGS = [
  { id: 'en-US', label: 'English (US)', tess: 'eng', speech: 'en-US', ipa: true },
  { id: 'en-GB', label: 'English (UK)', tess: 'eng', speech: 'en-GB', ipa: true },
  { id: 'ru', label: 'Russian — Русский', tess: 'rus', speech: 'ru-RU' },
  { id: 'uz-latn', label: 'Uzbek (Latin) — Oʻzbek', tess: 'uzb', speech: 'uz-UZ' },
  { id: 'uz-cyrl', label: 'Uzbek (Cyrillic) — Ўзбек', tess: 'uzb_cyrl', speech: 'uz-UZ' },
  { id: 'tr', label: 'Turkish — Türkçe', tess: 'tur', speech: 'tr-TR' },
  { id: 'de', label: 'German — Deutsch', tess: 'deu', speech: 'de-DE' },
  { id: 'fr', label: 'French — Français', tess: 'fra', speech: 'fr-FR' },
  { id: 'es', label: 'Spanish — Español', tess: 'spa', speech: 'es-ES' },
  { id: 'it', label: 'Italian — Italiano', tess: 'ita', speech: 'it-IT' },
  { id: 'pt', label: 'Portuguese — Português', tess: 'por', speech: 'pt-BR' },
  { id: 'ar', label: 'Arabic — العربية', tess: 'ara', speech: 'ar-SA' },
  { id: 'hi', label: 'Hindi — हिन्दी', tess: 'hin', speech: 'hi-IN' },
  { id: 'zh', label: 'Chinese (Simplified) — 中文', tess: 'chi_sim', speech: 'zh-CN' },
  { id: 'ja', label: 'Japanese — 日本語', tess: 'jpn', speech: 'ja-JP' },
  { id: 'ko', label: 'Korean — 한국어', tess: 'kor', speech: 'ko-KR' },
];

const SAMPLE_TEXT =
  'Learning a new language takes patience. Listen carefully to each word, then say it out loud. ' +
  'The weather was beautiful, so we walked through the old library.';

// ---------------------------------------------------------------- dom
const $ = (id) => document.getElementById(id);
const el = {
  status: $('status'), dropzone: $('dropzone'), preview: $('preview'), dropEmpty: $('drop-empty'),
  fileInput: $('file-input'), cameraInput: $('camera-input'), sampleBtn: $('sample-btn'), rotateBtn: $('rotate-btn'),
  ocrBtn: $('ocr-btn'), ocrProgress: $('ocr-progress'), ocrStage: $('ocr-stage'), ocrPct: $('ocr-pct'), ocrBar: $('ocr-bar'),
  text: $('text-input'), textNote: $('text-note'), lang: $('lang-select'), voice: $('voice-select'),
  voiceWarning: $('voice-warning'), learnBtn: $('learn-btn'),
  study: $('study'), sampleBadge: $('sample-badge'), sentences: $('sentences'),
  playBtn: $('play-btn'), pauseBtn: $('pause-btn'), stopBtn: $('stop-btn'), ipaToggle: $('ipa-toggle'), playerState: $('player-state'),
  wcWord: $('wc-word'), wcIpa: $('wc-ipa'), wcNormal: $('wc-normal'), wcSlow: $('wc-slow'), wcLoop: $('wc-loop'),
  practiceSelect: $('practice-select'), practiceTarget: $('practice-target'),
  shadowBtn: $('shadow-btn'), shadowStop: $('shadow-stop'), shadowState: $('shadow-state'),
  recSupported: $('rec-supported'), recUnsupported: $('rec-unsupported'), recListen: $('rec-listen'), recBtn: $('rec-btn'),
  recLive: $('rec-live'), recResult: $('rec-result'), recScore: $('rec-score'), recWords: $('rec-words'), recExtra: $('rec-extra'),
  supportList: $('support-list'),
};

// ---------------------------------------------------------------- state
const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const state = {
  lang: LANGS[0],
  rate: 1,
  voices: [],
  voiceURI: '',
  sentences: [],
  isSample: true,
  dict: null,
  dictPromise: null,
  worker: null,
  workerLang: '',
  imageSource: null, // ImageBitmap or HTMLImageElement
  rotation: 0,
  play: { token: 0, mode: 'idle', index: 0 }, // mode: idle | playing | paused | shadow
  selectedWord: null,
  boundarySeen: false,
};

// ---------------------------------------------------------------- helpers
const store = {
  get(k) { try { return localStorage.getItem('p2s:' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('p2s:' + k, v); } catch { /* storage unavailable */ } },
};

let statusTimer;
function setStatus(msg, kind = 'info', ms = 0) {
  clearTimeout(statusTimer);
  if (!msg) { el.status.hidden = true; return; }
  el.status.textContent = msg;
  el.status.className = 'status' + (kind === 'info' ? '' : ' ' + kind);
  el.status.hidden = false;
  if (ms) statusTimer = setTimeout(() => (el.status.hidden = true), ms);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

function icon(path) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
}
const ICON_PLAY = icon('<path d="M7 5l12 7-12 7z" class="fill"/>');
const ICON_SLOW = icon('<circle cx="12" cy="13" r="7"/><path d="M12 9v4l2 2M10 3h4"/>');
const ICON_MIC = icon('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>');

// ---------------------------------------------------------------- image input
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

async function handleFile(file) {
  if (!file) return;
  const typeOk = ACCEPTED.includes(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
  // Camera captures on some phones report an empty type; let the decoder decide in that case.
  if (!typeOk && file.type) {
    setStatus(`“${file.name}” is ${file.type || 'an unknown type'}. Please use a JPG, PNG or WebP image. On iPhone, set Camera → Formats → Most Compatible, or take the photo with the “Take photo” button.`, 'error');
    return;
  }
  try {
    let img;
    if ('createImageBitmap' in window) {
      try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { img = null; }
    }
    if (!img) img = await loadImageElement(file);
    state.imageSource = img;
    state.rotation = 0;
    drawPreview();
    setStatus('Photo ready. Choose the language of the text, then press “Extract text”.', 'info', 6000);
    prefetchOcr();
  } catch (err) {
    console.error(err);
    setStatus('This image could not be opened. It may be damaged or in a format your browser cannot read (for example HEIC). Try a JPG or PNG.', 'error');
  }
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}

function drawPreview() {
  const src = state.imageSource;
  if (!src) return;
  const w0 = src.width || src.naturalWidth;
  const h0 = src.height || src.naturalHeight;
  const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);
  const rotated = state.rotation % 180 !== 0;
  const c = el.preview;
  c.width = rotated ? h : w;
  c.height = rotated ? w : h;
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((state.rotation * Math.PI) / 180);
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
  ctx.restore();
  c.hidden = false;
  el.dropEmpty.hidden = true;
  el.ocrBtn.disabled = false;
  el.rotateBtn.disabled = false;
}

function makeSamplePhoto() {
  // A printed-page style image so OCR can be tried without a camera.
  const c = document.createElement('canvas');
  c.width = 1400; c.height = 820;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fbfaf6'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#1d1d1f';
  ctx.font = 'bold 54px Georgia, "Times New Roman", serif';
  ctx.fillText('Everyday English', 90, 130);
  ctx.font = '42px Georgia, "Times New Roman", serif';
  const lines = [
    'Learning a new language takes patience.',
    'Listen carefully to each word, then say it',
    'out loud. The weather was beautiful, so we',
    'walked through the old library and read',
    'until the evening.',
  ];
  lines.forEach((t, i) => ctx.fillText(t, 90, 240 + i * 72));
  ctx.strokeStyle = '#c9c4b8'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(90, 165); ctx.lineTo(1310, 165); ctx.stroke();
  state.imageSource = c;
  state.rotation = 0;
  drawPreview();
  selectLang('en-US');
  setStatus('Sample photo loaded. Press “Extract text” to run recognition on it.', 'info', 6000);
  prefetchOcr();
}

// ---------------------------------------------------------------- OCR
let tesseractPromise;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  tesseractPromise ||= loadScript(TESSERACT_URL).then(() => {
    if (!window.Tesseract) throw new Error('Tesseract did not load');
    return window.Tesseract;
  }).catch((e) => { tesseractPromise = null; throw e; });
  return tesseractPromise;
}
function prefetchOcr() { loadTesseract().catch(() => {}); }

const STAGES = {
  'loading tesseract core': 'Loading recognition engine',
  'initializing tesseract': 'Starting engine',
  'initialized tesseract': 'Engine ready',
  'loading language traineddata': 'Loading language model',
  'loading language traineddata (from cache)': 'Loading language model (cached)',
  'loaded language traineddata': 'Language model ready',
  'initializing api': 'Preparing',
  'initialized api': 'Prepared',
  'recognizing text': 'Reading text',
};

function onOcrLog(m) {
  const label = STAGES[m.status] || m.status;
  el.ocrStage.textContent = label.charAt(0).toUpperCase() + label.slice(1);
  const pct = Math.round((m.progress || 0) * 100);
  el.ocrPct.textContent = pct + '%';
  el.ocrBar.style.width = pct + '%';
}

// ---- language models
// The page downloads the model itself (so it can show real download progress and use
// hosts that serve it under a different file name), then stores it in the same IndexedDB
// key-value store Tesseract.js reads its cache from ("keyval-store"/"keyval", as idb-keyval does).
const CACHE_PATH = 'p2s-tessdata-fast';

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('keyval-store');
    open.onupgradeneeded = () => open.result.createObjectStore('keyval');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('keyval', mode);
      const req = fn(tx.objectStore('keyval'));
      tx.oncomplete = () => { db.close(); resolve(req.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

async function fetchModel(tessLang) {
  // Static hosts serve "<lang>.traineddata"; the claude.ai artifact host needs a ".wasm" suffix.
  let resp;
  for (const suffix of ['', '.wasm']) {
    resp = await fetch(`${TESSDATA_URL}${tessLang}.traineddata${suffix}`);
    if (resp.ok) break;
  }
  if (!resp.ok) throw new Error(`Language model “${tessLang}” could not be downloaded (HTTP ${resp.status}).`);
  const total = Number(resp.headers.get('content-length')) || 0;
  if (!resp.body || !total) return new Uint8Array(await resp.arrayBuffer());
  const reader = resp.body.getReader();
  const out = new Uint8Array(total);
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > out.length) return new Uint8Array(await new Blob([out.subarray(0, got), value]).arrayBuffer());
    out.set(value, got);
    got += value.length;
    onOcrLog({ status: `Downloading language model (${(total / 1048576).toFixed(1)} MB)`, progress: got / total });
  }
  return out.subarray(0, got);
}

async function preloadModel(tessLang) {
  const key = `${CACHE_PATH}/${tessLang}.traineddata`;
  const cached = await idb('readonly', (s) => s.get(key));
  if (cached && cached.length > 1000) return true;
  const data = await fetchModel(tessLang);
  await idb('readwrite', (s) => s.put(data, key));
  return true;
}

async function getWorker(tessLang) {
  if (state.worker && state.workerLang === tessLang) return state.worker;
  const T = await loadTesseract();
  if (state.worker) { await state.worker.terminate().catch(() => {}); state.worker = null; }
  let preloaded = false;
  try {
    preloaded = await preloadModel(tessLang);
  } catch (err) {
    if (/could not be downloaded/.test(err?.message)) throw err;
    console.warn('Model cache unavailable; Tesseract will download the model directly', err);
  }
  const worker = await T.createWorker(tessLang, 1, preloaded
    ? { cachePath: CACHE_PATH, cacheMethod: 'readOnly', langPath: TESSDATA_URL, gzip: false, logger: onOcrLog }
    : { langPath: TESSDATA_URL, gzip: false, cacheMethod: 'none', logger: onOcrLog });
  state.worker = worker;
  state.workerLang = tessLang;
  return worker;
}

async function runOcr() {
  if (el.preview.hidden) { setStatus('Add a photo first.', 'error'); return; }
  stopAll();
  el.ocrBtn.disabled = true;
  el.ocrProgress.hidden = false;
  onOcrLog({ status: 'loading tesseract core', progress: 0 });
  setStatus(`Reading text (${state.lang.label})…`);
  try {
    const worker = await getWorker(state.lang.tess);
    await worker.setParameters({ tessedit_pageseg_mode: '3' });
    let { data } = await worker.recognize(el.preview);
    let text = cleanOcrText(data.text);
    if (!text || data.confidence < 30) {
      // Signs and scattered labels read better as "sparse text".
      onOcrLog({ status: 'recognizing text', progress: 0 });
      await worker.setParameters({ tessedit_pageseg_mode: '11' });
      const second = (await worker.recognize(el.preview)).data;
      const t2 = cleanOcrText(second.text);
      if (t2 && second.confidence > data.confidence) { data = second; text = t2; }
    }
    if (!text) {
      setStatus('No readable text was found. Try a sharper, well-lit photo taken straight on, crop closer to the text, check the language setting, or rotate the photo if it is sideways.', 'error');
      return;
    }
    el.text.value = text;
    state.isSample = false;
    const conf = Math.round(data.confidence);
    el.textNote.textContent = `Recognition confidence: ${conf}%. ${conf < 70 ? 'Several words may be wrong — compare with the photo and correct them.' : 'Check the text against the photo before listening.'}`;
    setStatus(`Text extracted (${text.split(/\s+/).length} words). Review it, then press “Listen and Learn”.`, 'success', 8000);
    buildStudy();
    el.text.focus({ preventScroll: true });
  } catch (err) {
    console.error(err);
    const offline = !navigator.onLine;
    setStatus(offline
      ? 'You appear to be offline. The first text recognition needs an internet connection to download the engine and language model.'
      : `Text recognition failed: ${err?.message || err}. Reload the page and try again; if it keeps failing, try another browser (Chrome, Edge, Firefox or Safari 15+).`, 'error');
    state.worker = null; state.workerLang = '';
  } finally {
    el.ocrBtn.disabled = false;
    el.ocrProgress.hidden = true;
  }
}

// ---------------------------------------------------------------- languages & voices
function fillLangs() {
  el.lang.innerHTML = LANGS.map((l) => `<option value="${l.id}">${l.label}</option>`).join('');
}

function selectLang(id) {
  const l = LANGS.find((x) => x.id === id) || LANGS[0];
  state.lang = l;
  el.lang.value = l.id;
  store.set('lang', l.id);
  fillVoices();
  if (l.ipa) loadDict();
}

function loadVoices() {
  if (!synth) return;
  state.voices = synth.getVoices();
  fillVoices();
}

function voicesFor(lang) {
  const tag = lang.speech.toLowerCase();
  const base = tag.split('-')[0];
  const norm = (v) => (v.lang || '').toLowerCase().replace('_', '-');
  const exact = state.voices.filter((v) => norm(v) === tag);
  const family = state.voices.filter((v) => norm(v) !== tag && norm(v).split('-')[0] === base);
  const quality = (v) => (/natural|neural|premium|enhanced|online|google/i.test(v.name) ? 0 : 1) + (v.localService ? 0 : 0.1);
  return [...exact.sort((a, b) => quality(a) - quality(b)), ...family.sort((a, b) => quality(a) - quality(b))];
}

function fillVoices() {
  const list = voicesFor(state.lang);
  const saved = store.get('voice:' + state.lang.id);
  if (!synth) {
    el.voice.innerHTML = '<option>Speech not supported</option>';
    el.voice.disabled = true;
    showVoiceWarning('This browser has no speech synthesis. Try Chrome, Edge, Safari or Firefox.');
    return;
  }
  if (!list.length) {
    el.voice.innerHTML = '<option value="">Default voice</option>';
    state.voiceURI = '';
    showVoiceWarning(state.voices.length
      ? `No ${state.lang.label.split(' — ')[0]} voice is installed on this device, so the default voice will read it with the wrong accent. Install one in your system’s speech or language settings (Windows: Settings → Time & language → Speech; Android: Settings → Text-to-speech; iOS: Settings → Accessibility → Spoken Content → Voices), then reload.`
      : 'Loading voices…');
    return;
  }
  showVoiceWarning('');
  el.voice.innerHTML = list.map((v) =>
    `<option value="${v.voiceURI}">${v.name.replace(/</g, '&lt;')} (${v.lang})${v.localService ? '' : ' · online'}</option>`).join('');
  const pick = list.find((v) => v.voiceURI === saved) || list[0];
  el.voice.value = pick.voiceURI;
  state.voiceURI = pick.voiceURI;
}

function showVoiceWarning(msg) {
  el.voiceWarning.textContent = msg;
  el.voiceWarning.hidden = !msg;
}

function currentVoice() {
  return state.voices.find((v) => v.voiceURI === state.voiceURI) || null;
}

// ---------------------------------------------------------------- speech
function speak(text, { rate = state.rate, onStart, onBoundary, onEnd } = {}) {
  if (!synth) { setStatus('Speech is not supported in this browser.', 'error'); return null; }
  const u = new SpeechSynthesisUtterance(text);
  const v = currentVoice();
  if (v) u.voice = v;
  u.lang = v?.lang || state.lang.speech;
  u.rate = rate;
  u.onstart = () => onStart?.();
  u.onboundary = (e) => onBoundary?.(e);
  u.onend = () => onEnd?.(true);
  u.onerror = (e) => {
    if (e.error !== 'interrupted' && e.error !== 'canceled') {
      console.warn('speech error', e.error);
      if (e.error === 'not-allowed') setStatus('The browser blocked audio. Tap a play button again to start speech.', 'error', 6000);
      else if (e.error === 'language-unavailable' || e.error === 'voice-unavailable') setStatus('No voice is available for this language on this device.', 'error', 8000);
    }
    onEnd?.(false);
  };
  // Chrome can stay "paused" after a tab switch; resume before speaking.
  if (synth.paused) synth.resume();
  synth.speak(u);
  return u;
}

function cancelSpeech() {
  state.play.token++;
  if (synth) synth.cancel();
  clearHighlight();
}

function clearHighlight() {
  document.querySelectorAll('.sentence.current').forEach((n) => n.classList.remove('current'));
  document.querySelectorAll('.word.speaking').forEach((n) => n.classList.remove('speaking'));
}

function highlightSentence(i) {
  clearHighlight();
  const li = el.sentences.children[i];
  if (!li) return;
  li.classList.add('current');
  const r = li.getBoundingClientRect();
  if (r.top < 0 || r.bottom > window.innerHeight) {
    li.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}

function highlightWord(si, wi) {
  const li = el.sentences.children[si];
  if (!li) return;
  li.querySelectorAll('.word.speaking').forEach((n) => n.classList.remove('speaking'));
  li.querySelectorAll('.word')[wi]?.classList.add('speaking');
}

function speakSentence(i, { rate, onDone } = {}) {
  const s = state.sentences[i];
  if (!s) return;
  const token = state.play.token;
  highlightSentence(i);
  speak(s.text, {
    rate,
    onBoundary: (e) => {
      if (token !== state.play.token) return;
      if (e.name && e.name !== 'word') return;
      state.boundarySeen = true;
      highlightWord(i, wordIndexAt(s.words, e.charIndex));
    },
    onEnd: (ok) => {
      if (token !== state.play.token) return;
      el.sentences.children[i]?.querySelectorAll('.word.speaking').forEach((n) => n.classList.remove('speaking'));
      onDone?.(ok);
    },
  });
}

function playFrom(i) {
  if (!state.sentences.length) buildStudy();
  if (!state.sentences.length) return;
  cancelSpeech();
  state.play.mode = 'playing';
  state.play.index = i;
  updatePlayer();
  const step = (idx) => {
    if (state.play.mode !== 'playing') return;
    if (idx >= state.sentences.length) { stopAll(); el.playerState.textContent = 'Finished'; return; }
    state.play.index = idx;
    updatePlayer();
    speakSentence(idx, { onDone: () => step(idx + 1) });
  };
  step(i);
}

function pausePlayback() {
  if (state.play.mode === 'playing') {
    const idx = state.play.index;
    cancelSpeech();
    state.play.mode = 'paused';
    state.play.index = idx;
    highlightSentence(idx);
  } else if (state.play.mode === 'paused') {
    playFrom(state.play.index);
    return;
  }
  updatePlayer();
}

function stopAll() {
  cancelSpeech();
  state.play.mode = 'idle';
  stopShadow(true);
  updatePlayer();
}

function updatePlayer() {
  const m = state.play.mode;
  el.pauseBtn.disabled = !(m === 'playing' || m === 'paused');
  el.stopBtn.disabled = m === 'idle';
  el.pauseBtn.querySelector('span').textContent = m === 'paused' ? 'Resume' : 'Pause';
  el.playBtn.querySelector('span').textContent = m === 'playing' ? 'Restart' : 'Play all';
  const n = state.sentences.length;
  el.playerState.textContent =
    m === 'playing' ? `Sentence ${state.play.index + 1} of ${n}` :
    m === 'paused' ? `Paused at sentence ${state.play.index + 1}` :
    m === 'shadow' ? 'Listen and repeat' : '';
}

function speakWord(text, rate) {
  cancelSpeech();
  state.play.mode = 'idle';
  updatePlayer();
  speak(text, { rate });
}

// ---------------------------------------------------------------- dictionary (English IPA)
function loadDict() {
  if (state.dict) return Promise.resolve(state.dict);
  state.dictPromise ||= fetch(DICT_URL)
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then((t) => { state.dict = parseDictionary(t); renderIpa(); return state.dict; })
    .catch((e) => { console.warn('IPA dictionary unavailable', e); state.dictPromise = null; return null; });
  return state.dictPromise;
}

function ipaFor(word) {
  if (!state.lang.ipa || !state.dict) return '';
  return lookupIpa(state.dict, word);
}

function renderIpa() {
  document.querySelectorAll('.word').forEach((b) => {
    const i = b.querySelector('.i');
    const ipa = ipaFor(b.dataset.word);
    i.textContent = state.lang.ipa ? (ipa ? `/${ipa}/` : '·') : '';
    i.classList.toggle('unknown', !ipa);
  });
  if (state.selectedWord) showWordCard(state.selectedWord);
}

// ---------------------------------------------------------------- study view
function buildStudy() {
  stopAll();
  const text = el.text.value.trim();
  state.sentences = splitSentences(text, state.lang.speech);
  el.sampleBadge.hidden = !state.isSample;
  el.sentences.innerHTML = '';
  if (!state.sentences.length) {
    el.sentences.innerHTML = '<li class="empty-study">No text yet. Add a photo and extract its text, or type text in step 2.</li>';
    fillPractice();
    return;
  }
  const frag = document.createDocumentFragment();
  state.sentences.forEach((s, si) => {
    const li = document.createElement('li');
    li.className = 'sentence';
    li.lang = state.lang.speech;
    const words = document.createElement('div');
    words.className = 'words';
    s.words.forEach((w, wi) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'word';
      b.dataset.word = w.text;
      b.dataset.s = si;
      b.dataset.w = wi;
      b.innerHTML = '<span class="w"></span><span class="i"></span>';
      b.querySelector('.w').textContent = w.text;
      b.setAttribute('aria-label', `Hear “${w.text}”`);
      words.appendChild(b);
    });
    const actions = document.createElement('div');
    actions.className = 's-actions';
    actions.innerHTML =
      `<button type="button" class="btn" data-act="play" data-s="${si}">${ICON_PLAY}Play</button>` +
      `<button type="button" class="btn" data-act="slow" data-s="${si}">${ICON_SLOW}Slow</button>` +
      `<button type="button" class="btn btn-quiet" data-act="practice" data-s="${si}">${ICON_MIC}Practise</button>`;
    li.append(words, actions);
    frag.appendChild(li);
  });
  el.sentences.appendChild(frag);
  renderIpa();
  if (state.lang.ipa) loadDict();
  fillPractice();
}

function showWordCard(w) {
  state.selectedWord = w;
  el.wcWord.textContent = w;
  const ipa = ipaFor(w);
  el.wcIpa.textContent = state.lang.ipa
    ? (ipa ? `/${ipa}/` : (state.dict ? 'Not in dictionary' : 'Loading IPA…'))
    : 'IPA is available for English only';
  [el.wcNormal, el.wcSlow, el.wcLoop].forEach((b) => (b.disabled = false));
}

el.sentences.addEventListener('click', (e) => {
  const word = e.target.closest('.word');
  if (word) {
    document.querySelectorAll('.word.selected').forEach((n) => n.classList.remove('selected'));
    word.classList.add('selected');
    showWordCard(word.dataset.word);
    speakWord(word.dataset.word, Math.min(state.rate, 1));
    return;
  }
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const si = Number(btn.dataset.s);
  if (btn.dataset.act === 'play' || btn.dataset.act === 'slow') {
    cancelSpeech();
    state.play.mode = 'idle';
    updatePlayer();
    speakSentence(si, { rate: btn.dataset.act === 'slow' ? 0.5 : state.rate, onDone: () => clearHighlight() });
  } else if (btn.dataset.act === 'practice') {
    el.practiceSelect.value = String(si);
    updatePracticeTarget();
    el.practiceSelect.closest('section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

el.wcNormal.addEventListener('click', () => state.selectedWord && speakWord(state.selectedWord, 1));
el.wcSlow.addEventListener('click', () => state.selectedWord && speakWord(state.selectedWord, 0.5));
el.wcLoop.addEventListener('click', () => {
  if (!state.selectedWord) return;
  cancelSpeech();
  const token = state.play.token;
  let n = 0;
  const again = () => {
    if (token !== state.play.token || n++ >= 3) return;
    speak(state.selectedWord, { rate: n === 2 ? 0.5 : 0.85, onEnd: (ok) => ok && setTimeout(again, 600) });
  };
  again();
});

// ---------------------------------------------------------------- practice
function fillPractice() {
  const prev = el.practiceSelect.value;
  el.practiceSelect.innerHTML = state.sentences.length
    ? state.sentences.map((s, i) => `<option value="${i}">${i + 1}. ${escapeHtml(s.text.length > 70 ? s.text.slice(0, 67) + '…' : s.text)}</option>`).join('')
    : '<option value="">No sentences yet</option>';
  if (prev && Number(prev) < state.sentences.length) el.practiceSelect.value = prev;
  updatePracticeTarget();
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function practiceIndex() { return Number(el.practiceSelect.value || 0); }

function updatePracticeTarget() {
  const s = state.sentences[practiceIndex()];
  el.practiceTarget.textContent = s ? s.text : 'Add some text first.';
  el.practiceTarget.lang = state.lang.speech;
  el.recResult.hidden = true;
  el.recLive.textContent = '';
}
el.practiceSelect.addEventListener('change', updatePracticeTarget);

// Listen-and-repeat loop: play, pause long enough to repeat, continue.
let shadowTimer;
function startShadow() {
  if (!state.sentences.length) return;
  cancelSpeech();
  state.play.mode = 'shadow';
  updatePlayer();
  el.shadowBtn.hidden = true;
  el.shadowStop.hidden = false;
  const token = state.play.token;
  const step = (i) => {
    if (token !== state.play.token || state.play.mode !== 'shadow') return;
    if (i >= state.sentences.length) { stopShadow(); el.shadowState.textContent = 'Done. Well practised!'; return; }
    el.practiceSelect.value = String(i);
    el.practiceTarget.textContent = state.sentences[i].text;
    el.shadowState.className = 'shadow-state';
    el.shadowState.textContent = `Listen… (sentence ${i + 1} of ${state.sentences.length})`;
    const started = performance.now();
    speakSentence(i, {
      onDone: (ok) => {
        if (!ok || token !== state.play.token) return;
        const spoken = performance.now() - started;
        const gap = Math.max(2000, Math.min(spoken * 1.4 + 800, 15000));
        let left = Math.ceil(gap / 1000);
        el.shadowState.className = 'shadow-state your-turn';
        const tick = () => {
          if (token !== state.play.token) return;
          el.shadowState.textContent = `Your turn — say it aloud (${left}s)`;
          if (left-- <= 0) { step(i + 1); return; }
          shadowTimer = setTimeout(tick, 1000);
        };
        tick();
      },
    });
  };
  step(practiceIndex());
}

function stopShadow(silent) {
  clearTimeout(shadowTimer);
  if (state.play.mode === 'shadow') { state.play.mode = 'idle'; if (!silent) cancelSpeech(); }
  el.shadowBtn.hidden = false;
  el.shadowStop.hidden = true;
  if (!silent) el.shadowState.textContent = '';
  el.shadowState.className = 'shadow-state';
  updatePlayer();
}
el.shadowBtn.addEventListener('click', startShadow);
el.shadowStop.addEventListener('click', () => stopShadow(false));

// Speech recognition check
let rec = null;
function setupRecognition() {
  if (!SR) {
    el.recSupported.hidden = true;
    el.recUnsupported.hidden = false;
    el.recUnsupported.textContent = 'Speech recognition is not available in this browser (it works in Chrome, Edge and Safari; not in Firefox). Use “Listen and repeat” and compare by ear instead.';
    return;
  }
  el.recBtn.addEventListener('click', toggleRecording);
  el.recListen.addEventListener('click', () => {
    const i = practiceIndex();
    if (!state.sentences[i]) return;
    cancelSpeech();
    speakSentence(i, { onDone: () => clearHighlight() });
  });
}

function toggleRecording() {
  if (rec) { rec.stop(); return; }
  const s = state.sentences[practiceIndex()];
  if (!s) return;
  cancelSpeech();
  rec = new SR();
  rec.lang = state.lang.speech;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 3;
  let finalAlts = [];
  el.recResult.hidden = true;
  el.recLive.textContent = 'Listening… say the sentence now.';
  el.recBtn.classList.add('recording');
  el.recBtn.querySelector('span').textContent = 'Stop';
  rec.onresult = (e) => {
    let interim = '';
    const finals = [];
    for (let k = 0; k < e.results.length; k++) {
      const r = e.results[k];
      if (r.isFinal) finals.push(Array.from(r, (a) => a.transcript));
      else interim += r[0].transcript;
    }
    if (finals.length) finalAlts = finals;
    const shown = finals.map((alts) => alts[0]).join(' ') + ' ' + interim;
    el.recLive.textContent = '“' + shown.trim() + '”';
  };
  rec.onerror = (e) => {
    const msg = {
      'not-allowed': 'Microphone access was blocked. Allow the microphone for this site in your browser settings and try again.',
      'service-not-allowed': 'Speech recognition is not allowed here. In some embedded viewers the microphone is unavailable; open the site directly in your browser.',
      'no-speech': 'No speech was heard. Move closer to the microphone and try again.',
      'audio-capture': 'No microphone was found.',
      'network': 'Speech recognition needs an internet connection in this browser.',
      'language-not-supported': 'Your browser cannot recognise this language.',
    }[e.error] || `Recognition error: ${e.error}`;
    el.recLive.textContent = msg;
  };
  rec.onend = () => {
    el.recBtn.classList.remove('recording');
    el.recBtn.querySelector('span').textContent = 'Record';
    rec = null;
    if (!finalAlts.length) return;
    // Join the alternatives of each final chunk and keep the best-matching combination.
    const candidates = [finalAlts.map((a) => a[0]).join(' ')];
    if (finalAlts.length === 1) candidates.push(...finalAlts[0].slice(1));
    let best = null;
    for (const c of candidates) {
      const r = compareWords(s.text, c, state.lang.speech);
      if (!best || r.score > best.score) best = { ...r, heard: c };
    }
    el.recLive.textContent = 'Heard: “' + best.heard.trim() + '”';
    el.recScore.textContent = best.score;
    el.recWords.innerHTML = best.words.map((w) => `<span class="${w.matched ? 'hit' : 'miss'}">${escapeHtml(w.text)}</span>`).join('');
    el.recExtra.textContent = best.extra.length ? 'Extra words heard: ' + best.extra.join(', ') : '';
    el.recResult.hidden = false;
  };
  try { rec.start(); } catch (err) { el.recLive.textContent = 'Could not start recognition: ' + err.message; rec = null; }
}

// ---------------------------------------------------------------- support check
function checkSupport() {
  const items = [];
  const add = (ok, label, detail) => items.push({ ok, label, detail });
  const wasm = typeof WebAssembly === 'object';
  add(wasm && 'Worker' in window ? 'yes' : 'no', 'Text recognition (OCR)', wasm ? 'WebAssembly and Web Workers available.' : 'Needs WebAssembly; update your browser.');
  add(synth ? 'yes' : 'no', 'Speech playback', synth ? `${state.voices.length || 'Loading'} voices on this device.` : 'Not available.');
  const lv = voicesFor(state.lang).length;
  add(lv ? 'yes' : 'maybe', `Voice for ${state.lang.label.split(' — ')[0]}`, lv ? `${lv} matching voice${lv > 1 ? 's' : ''}.` : 'None installed; the default voice will be used.');
  add(state.boundarySeen ? 'yes' : 'maybe', 'Word highlighting', state.boundarySeen ? 'This voice reports word positions.' : 'Shows after playback starts if the voice supports it; otherwise the sentence is highlighted.');
  add(SR ? 'yes' : 'no', 'Speech recognition', SR ? 'Available (Chrome/Edge send audio to an online service).' : 'Not in this browser; use “Listen and repeat”.');
  const mobile = matchMedia('(pointer: coarse)').matches;
  add(mobile ? 'yes' : 'maybe', 'Camera capture', mobile ? '“Take photo” opens the camera.' : 'On desktop “Take photo” opens a file picker.');
  el.supportList.innerHTML = items.map((i) =>
    `<li><span class="pill ${i.ok}">${i.ok === 'yes' ? 'Yes' : i.ok === 'no' ? 'No' : 'Partly'}</span><span><strong>${i.label}.</strong> ${i.detail}</span></li>`).join('');
}

// ---------------------------------------------------------------- wiring
function init() {
  fillLangs();
  const savedRate = Number(store.get('rate'));
  if ([0.5, 0.75, 1, 1.25].includes(savedRate)) {
    state.rate = savedRate;
    document.querySelector(`#speed-group input[value="${savedRate}"]`).checked = true;
  }
  if (synth) {
    loadVoices();
    synth.addEventListener?.('voiceschanged', () => { loadVoices(); checkSupport(); });
    // Some browsers never fire voiceschanged; poll briefly.
    let tries = 0;
    const poll = setInterval(() => { if (state.voices.length || ++tries > 20) { clearInterval(poll); return; } loadVoices(); checkSupport(); }, 250);
  }
  selectLang(store.get('lang') || 'en-US');
  el.text.value = SAMPLE_TEXT;
  el.textNote.textContent = 'Sample text — replace it with text from your photo, or type your own.';
  buildStudy();
  setupRecognition();
  checkSupport();
  updatePlayer();
}

el.fileInput.addEventListener('change', () => { handleFile(el.fileInput.files[0]); el.fileInput.value = ''; });
el.cameraInput.addEventListener('change', () => { handleFile(el.cameraInput.files[0]); el.cameraInput.value = ''; });
el.sampleBtn.addEventListener('click', makeSamplePhoto);
el.rotateBtn.addEventListener('click', () => { state.rotation = (state.rotation + 90) % 360; drawPreview(); });
el.ocrBtn.addEventListener('click', runOcr);

['dragenter', 'dragover'].forEach((t) => el.dropzone.addEventListener(t, (e) => { e.preventDefault(); el.dropzone.classList.add('drag'); }));
['dragleave', 'drop'].forEach((t) => el.dropzone.addEventListener(t, (e) => { e.preventDefault(); el.dropzone.classList.remove('drag'); }));
el.dropzone.addEventListener('drop', (e) => handleFile(e.dataTransfer?.files?.[0]));
el.dropzone.addEventListener('click', (e) => { if (el.preview.hidden && e.target === el.dropzone || e.target.closest('.drop-empty')) el.fileInput.click(); });
el.dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.fileInput.click(); } });
document.addEventListener('paste', (e) => {
  const f = Array.from(e.clipboardData?.files || []).find((x) => x.type.startsWith('image/'));
  if (f) handleFile(f);
});

el.lang.addEventListener('change', () => { selectLang(el.lang.value); buildStudy(); checkSupport(); });
el.voice.addEventListener('change', () => { state.voiceURI = el.voice.value; store.set('voice:' + state.lang.id, el.voice.value); });
document.getElementById('speed-group').addEventListener('change', (e) => {
  state.rate = Number(e.target.value);
  store.set('rate', String(state.rate));
});
let editTimer;
el.text.addEventListener('input', () => {
  state.isSample = false;
  clearTimeout(editTimer);
  editTimer = setTimeout(buildStudy, 700);
});
el.learnBtn.addEventListener('click', () => {
  buildStudy();
  if (!state.sentences.length) { setStatus('There is no text to read yet.', 'error', 5000); return; }
  el.study.scrollIntoView({ behavior: 'smooth', block: 'start' });
  playFrom(0);
});
el.playBtn.addEventListener('click', () => playFrom(0));
el.pauseBtn.addEventListener('click', pausePlayback);
el.stopBtn.addEventListener('click', stopAll);
el.ipaToggle.addEventListener('change', () => el.sentences.classList.toggle('no-ipa', !el.ipaToggle.checked));
window.addEventListener('pagehide', () => synth?.cancel());

init();
