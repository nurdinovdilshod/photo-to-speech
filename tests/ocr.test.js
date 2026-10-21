// End-to-end check of the bundled OCR language models and the text pipeline.
// Uses the native `tesseract` CLI (same LSTM engine and .traineddata files that
// Tesseract.js loads in the browser). Skipped automatically if the CLI is missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanOcrText, splitSentences, compareWords } from '../lib/text.js';

const root = fileURLToPath(new URL('..', import.meta.url));
let hasTesseract = true;
try { execFileSync('tesseract', ['--version'], { stdio: 'ignore' }); } catch { hasTesseract = false; }

function ocr(file, lang) {
  return execFileSync('tesseract', [`${root}tests/fixtures/${file}`, '-', '--tessdata-dir', `${root}tessdata`, '-l', lang], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
}

const cases = [
  ['english.jpg', 'eng', 'en-US', 'Learning a new language takes patience. Listen carefully to each word, then say it out loud. The weather was beautiful.', 3],
  ['russian.jpg', 'rus', 'ru-RU', 'Учить новый язык нужно терпеливо. Слушайте каждое слово внимательно.', 2],
  ['uzbek.jpg', 'uzb', 'uz-UZ', "Yangi tilni o'rganish sabr talab qiladi. Har bir so'zni diqqat bilan tinglang.", 2],
];

for (const [file, lang, bcp, expected, nSentences] of cases) {
  test(`photo → text → sentences (${lang})`, { skip: !hasTesseract && 'tesseract CLI not installed' }, () => {
    const text = cleanOcrText(ocr(file, lang));
    const sentences = splitSentences(text, bcp);
    assert.equal(sentences.length, nSentences, text);
    const match = compareWords(expected.replace(/[ʻ‘’]/g, "'"), text.replace(/[ʻ‘’]/g, "'"), bcp);
    assert.ok(match.score >= 90, `word accuracy ${match.score}%: ${text}`);
  });
}
