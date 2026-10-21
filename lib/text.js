// Pure text helpers shared by the app and the Node tests. No DOM access here.

/** Clean raw OCR output: fix hyphenated line breaks, join wrapped lines, tidy spaces. */
export function cleanOcrText(raw) {
  if (!raw) return '';
  let t = raw.replace(/\r\n?/g, '\n');
  t = t.replace(/[­]/g, '');                 // soft hyphens
  t = t.replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2');   // "pronun-\nciation" -> "pronunciation"
  // Keep blank lines as paragraph breaks, join single line breaks inside a paragraph.
  t = t
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
  return t;
}

const hasSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';

/**
 * Split text into sentences. Each sentence has its text and a list of words with
 * character offsets relative to the sentence, so speech "boundary" events
 * (which report a charIndex) can be mapped back to a word.
 */
export function splitSentences(text, lang = 'en') {
  const out = [];
  const paragraphs = String(text || '').split(/\n+/);
  for (const para of paragraphs) {
    const p = para.trim();
    if (!p) continue;
    let pieces = [];
    if (hasSegmenter) {
      try {
        const seg = new Intl.Segmenter(lang, { granularity: 'sentence' });
        pieces = Array.from(seg.segment(p), (s) => s.segment);
      } catch {
        pieces = [];
      }
    }
    if (!pieces.length) pieces = p.match(/[^.!?。！？]+[.!?。！？]*["')\]]*\s*/g) || [p];
    for (const piece of pieces) {
      const s = piece.trim();
      if (!s) continue;
      const words = splitWords(s, lang);
      if (words.length) out.push({ text: s, words });
    }
  }
  return out;
}

/** Split a sentence into word tokens with start/end offsets. */
export function splitWords(sentence, lang = 'en') {
  const words = [];
  if (hasSegmenter) {
    try {
      const seg = new Intl.Segmenter(lang, { granularity: 'word' });
      for (const s of seg.segment(sentence)) {
        if (s.isWordLike) words.push({ text: s.segment, start: s.index, end: s.index + s.segment.length });
      }
      return words;
    } catch {
      /* fall through to regex */
    }
  }
  const re = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}]+)*/gu;
  let m;
  while ((m = re.exec(sentence))) words.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return words;
}

/** Index of the word that contains (or follows) a character index. */
export function wordIndexAt(words, charIndex) {
  for (let i = 0; i < words.length; i++) {
    if (charIndex < words[i].end) return i;
  }
  return words.length - 1;
}

/** Normalise a word for comparison and dictionary lookup. */
export function normalizeWord(w) {
  return String(w || '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .normalize('NFKC')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

// ---------- ARPAbet (CMU dictionary) -> IPA, General American ----------

const ARPA = {
  AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ', ER: 'ɝ', EY: 'eɪ',
  IH: 'ɪ', IY: 'i', OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'u',
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', HH: 'h', JH: 'dʒ', K: 'k', L: 'l',
  M: 'm', N: 'n', NG: 'ŋ', P: 'p', R: 'ɹ', S: 's', SH: 'ʃ', T: 't', TH: 'θ', V: 'v',
  W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
};

// Consonant clusters allowed at the start of an English syllable (used to place stress marks).
const ONSETS = new Set([
  'P R', 'P L', 'B R', 'B L', 'T R', 'T W', 'D R', 'D W', 'K R', 'K L', 'K W', 'G R', 'G L', 'G W',
  'F R', 'F L', 'TH R', 'TH W', 'SH R', 'S P', 'S T', 'S K', 'S M', 'S N', 'S L', 'S W', 'S F',
  'S P R', 'S P L', 'S T R', 'S K R', 'S K W', 'S K L', 'P Y', 'B Y', 'K Y', 'F Y', 'M Y', 'HH Y', 'V Y',
]);

/** Convert a CMU ARPAbet string like "P R AH0 N AH2 N S IY0 EY1 SH AH0 N" to IPA. */
export function arpabetToIpa(arpabet) {
  const phones = String(arpabet || '').trim().split(/\s+/).filter(Boolean);
  if (!phones.length) return '';
  const parsed = phones.map((p) => {
    const m = /^([A-Z]+)([012])?$/.exec(p);
    if (!m) return { base: p, stress: null, vowel: false };
    return { base: m[1], stress: m[2] ?? null, vowel: m[2] !== undefined };
  });
  const vowelCount = parsed.filter((p) => p.vowel).length;
  const marks = new Array(parsed.length).fill('');

  if (vowelCount > 1) {
    parsed.forEach((p, i) => {
      if (!p.vowel || (p.stress !== '1' && p.stress !== '2')) return;
      // Walk back over consonants that can still form a legal onset.
      let start = i;
      let prevVowel = -1;
      for (let j = i - 1; j >= 0; j--) if (parsed[j].vowel) { prevVowel = j; break; }
      const cons = parsed.slice(prevVowel + 1, i).map((c) => c.base);
      for (let k = 0; k < cons.length; k++) {
        const cluster = cons.slice(k);
        if (cluster.length === 1 || ONSETS.has(cluster.join(' '))) { start = prevVowel + 1 + k; break; }
      }
      marks[start] = (p.stress === '1' ? 'ˈ' : 'ˌ') + marks[start];
    });
  }

  return parsed
    .map((p, i) => {
      let sym = ARPA[p.base] ?? p.base.toLowerCase();
      if (p.base === 'AH' && p.stress === '0') sym = 'ə';
      if (p.base === 'ER' && p.stress === '0') sym = 'ɚ';
      return marks[i] + sym;
    })
    .join('');
}

/** Parse the compact "word<TAB>PHONES" dictionary into a Map. */
export function parseDictionary(text) {
  const map = new Map();
  for (const line of String(text).split('\n')) {
    const tab = line.indexOf('\t');
    if (tab > 0) map.set(line.slice(0, tab), line.slice(tab + 1));
  }
  return map;
}

/** Look up an English word's IPA, with a few common fallbacks. Returns '' if unknown. */
export function lookupIpa(dict, word) {
  if (!dict) return '';
  const w = normalizeWord(word);
  if (!w) return '';
  let ph = dict.get(w);
  if (!ph && w.endsWith("'s")) {
    const base = dict.get(w.slice(0, -2));
    if (base) {
      const last = base.split(' ').pop();
      const suffix = /^(P|T|K|F|TH)$/.test(last) ? 'S' : /^(S|Z|SH|ZH|CH|JH)$/.test(last) ? 'IH0 Z' : 'Z';
      ph = base + ' ' + suffix;
    }
  }
  if (!ph && w.includes("'")) ph = dict.get(w.replace(/'/g, ''));
  return ph ? arpabetToIpa(ph) : '';
}

/**
 * Compare what the learner said with the target sentence (word level).
 * Uses a longest-common-subsequence alignment so one missed word does not
 * mark every later word as wrong.
 */
export function compareWords(targetText, spokenText, lang = 'en') {
  const target = splitWords(targetText, lang).map((w) => w.text);
  const spoken = splitWords(spokenText, lang).map((w) => w.text);
  const a = target.map(normalizeWord);
  const b = spoken.map(normalizeWord);
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const words = target.map((text) => ({ text, matched: false }));
  const extra = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { words[i].matched = true; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else { extra.push(spoken[j]); j++; }
  }
  while (j < m) extra.push(spoken[j++]);
  const matched = words.filter((w) => w.matched).length;
  return { words, extra, matched, total: n, score: n ? Math.round((matched / n) * 100) : 0 };
}
