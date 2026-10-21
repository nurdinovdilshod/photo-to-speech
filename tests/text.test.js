import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  cleanOcrText, splitSentences, splitWords, wordIndexAt, normalizeWord,
  arpabetToIpa, parseDictionary, lookupIpa, compareWords,
} from '../lib/text.js';

const dict = parseDictionary(readFileSync(new URL('../data/cmudict.txt', import.meta.url), 'utf8'));

test('cleanOcrText joins wrapped lines and hyphenation, keeps paragraphs', () => {
  const raw = 'Learning a new lan-\nguage takes\npractice.\n\nSecond   paragraph.';
  assert.equal(cleanOcrText(raw), 'Learning a new language takes practice.\n\nSecond paragraph.');
  assert.equal(cleanOcrText(''), '');
});

test('splitSentences splits sentences and words with offsets', () => {
  const s = splitSentences('Hello world. How are you today? Fine!', 'en');
  assert.equal(s.length, 3);
  assert.equal(s[1].text, 'How are you today?');
  assert.deepEqual(s[1].words.map((w) => w.text), ['How', 'are', 'you', 'today']);
  const w = s[1].words[3];
  assert.equal(s[1].text.slice(w.start, w.end), 'today');
});

test('splitWords handles Cyrillic, Uzbek Latin apostrophes and CJK', () => {
  assert.deepEqual(splitWords('Привет, как дела?', 'ru').map((w) => w.text), ['Привет', 'как', 'дела']);
  assert.ok(splitWords('Oʻzbekiston goʻzal', 'uz').length >= 2);
  assert.ok(splitWords('我喜欢学习中文', 'zh').length >= 2);
});

test('wordIndexAt maps speech boundary char index to a word', () => {
  const words = splitWords('The quick brown fox');
  assert.equal(wordIndexAt(words, 0), 0);
  assert.equal(wordIndexAt(words, 4), 1);
  assert.equal(wordIndexAt(words, 16), 3);
});

test('normalizeWord strips punctuation and curly quotes', () => {
  assert.equal(normalizeWord('“Don’t,'), "don't");
  assert.equal(normalizeWord('Hello!'), 'hello');
});

test('arpabetToIpa converts with stress marks', () => {
  assert.equal(arpabetToIpa('P R AH0 N AH2 N S IY0 EY1 SH AH0 N'), 'pɹəˌnʌnsiˈeɪʃən');
  assert.equal(arpabetToIpa('K AE1 T'), 'kæt'); // one syllable: no stress mark
  assert.equal(arpabetToIpa('W AO1 T ER0'), 'ˈwɔtɚ');
  assert.equal(arpabetToIpa('IH0 K S P L EY1 N'), 'ɪkˈspleɪn');
});

test('dictionary lookup works for common words and possessives', () => {
  assert.ok(dict.size > 100000);
  assert.equal(lookupIpa(dict, 'Thought,'), 'θɔt');
  assert.equal(lookupIpa(dict, 'teacher'), 'ˈtitʃɚ');
  assert.ok(lookupIpa(dict, "teacher's").endsWith('z'));
  assert.equal(lookupIpa(dict, 'qwzxv'), '');
});

test('compareWords aligns spoken text to target', () => {
  const r = compareWords('The quick brown fox jumps', 'the quick fox jumps high');
  assert.deepEqual(r.words.map((w) => w.matched), [true, true, false, true, true]);
  assert.deepEqual(r.extra, ['high']);
  assert.equal(r.score, 80);
  assert.equal(compareWords('Hello', '').score, 0);
});
