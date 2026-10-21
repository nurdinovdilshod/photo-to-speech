// Browser end-to-end test: real Chromium, real Tesseract.js, real photo fixtures.
// Run with a static server on :8080 (python3 -m http.server 8080) and `node tests/e2e.mjs`.
// Requires the `playwright` package (installed in CI only; the app itself has no dependencies).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080/';
mkdirSync('e2e-output', { recursive: true });

const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(BASE, { waitUntil: 'load' });
  // Sample text renders as a study sheet with English IPA from the CMU dictionary.
  await page.waitForFunction(() => document.querySelectorAll('.sentence').length === 3);
  await page.waitForFunction(() => document.querySelector('.word[data-word="Learning"] .i')?.textContent === '/ˈlɝnɪŋ/', null, { timeout: 30000 });
  console.log('✓ study view + IPA');

  // 1. English photo -> OCR -> editable text -> sentences
  await page.setInputFiles('#file-input', 'tests/fixtures/english.jpg');
  await page.waitForFunction(() => !document.querySelector('#ocr-btn').disabled);
  await page.click('#ocr-btn');
  await page.waitForFunction(() => document.querySelector('#text-input').value.includes('patience'), null, { timeout: 180000 });
  const en = await page.inputValue('#text-input');
  console.log('✓ English OCR:', JSON.stringify(en));
  assert.match(en, /Learning a new language takes patience\./);
  await page.waitForFunction(() => document.querySelectorAll('.sentence').length === 3);
  console.log('✓ 3 sentences built from OCR text');
  await page.screenshot({ path: 'e2e-output/desktop-after-ocr.png', fullPage: true });

  // 2. Russian photo with language switch (loads a second model)
  await page.selectOption('#lang-select', 'ru');
  await page.setInputFiles('#file-input', 'tests/fixtures/russian.jpg');
  await page.click('#ocr-btn');
  await page.waitForFunction(() => document.querySelector('#text-input').value.includes('терпеливо'), null, { timeout: 180000 });
  console.log('✓ Russian OCR:', JSON.stringify(await page.inputValue('#text-input')));

  // 3. Sample photo button (canvas source) works too
  await page.selectOption('#lang-select', 'en-US');
  await page.click('#sample-btn');
  await page.click('#ocr-btn');
  await page.waitForFunction(() => /library/i.test(document.querySelector('#text-input').value), null, { timeout: 180000 });
  console.log('✓ Sample photo OCR');

  // 4. Edited text rebuilds the study view; word click selects the word card
  await page.fill('#text-input', 'Thought is free. Say it slowly!');
  await page.waitForFunction(() => document.querySelectorAll('.sentence').length === 2, null, { timeout: 5000 });
  await page.click('.word[data-word="Thought"]');
  assert.equal(await page.textContent('#wc-word'), 'Thought');
  assert.equal(await page.textContent('#wc-ipa'), '/θɔt/');
  console.log('✓ editing + word card');

  // 5. Speech API presence and practice wiring
  assert.equal(await page.evaluate(() => 'speechSynthesis' in window), true);
  assert.equal(await page.locator('#practice-select option').count(), 2);

  // 6. Mobile layout: no horizontal scroll
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.goto(BASE, { waitUntil: 'load' });
  await mobile.waitForFunction(() => document.querySelectorAll('.sentence').length === 3);
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `page scrolls horizontally by ${overflow}px on mobile`);
  await mobile.screenshot({ path: 'e2e-output/mobile.png', fullPage: true });
  console.log('✓ mobile layout fits 390px');

  const realErrors = errors.filter((e) => !/fonts\.g|favicon/i.test(e));
  assert.deepEqual(realErrors, [], 'console errors');
  console.log('All browser checks passed.');
} finally {
  await browser.close();
}
