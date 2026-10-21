# Photo to Speech — Pronunciation Trainer

Take or upload a photo of printed text, extract the text in the browser, correct it, then listen to it sentence by sentence and word by word, with IPA for English and a listen-and-repeat practice mode.

Everything runs in the browser. There is no backend, no database, no API key and no build step.

## Features

- **Photo input**: drag and drop, file picker (JPG, PNG, WebP), phone camera (`capture="environment"`), paste from clipboard, a sample photo, and 90° rotation for sideways photos. Large photos are downscaled to 2000 px before recognition.
- **OCR**: [Tesseract.js](https://github.com/naptha/tesseract.js) 5.1.1 in a Web Worker. Language models (Tesseract `tessdata_fast`) for 15 languages are **hosted with the site** in `tessdata/`; the model for the chosen language is downloaded once with a progress bar and cached in IndexedDB. If the normal page-layout pass finds nothing (signs, labels), it retries in sparse-text mode. Low-confidence results show a warning.
- **Editable text**: the recognised text is cleaned (hyphenated line breaks joined, wrapped lines merged) and shown in a textarea; edits rebuild the study view.
- **Speech**: Web Speech API (`speechSynthesis`). Language and voice selectors, speeds 0.5×, 0.75×, 1×, 1.25×, Play all / Pause–Resume / Stop, per-sentence Play and Slow buttons, click any word to hear it, a word card with Normal / Slow / Repeat 3×.
- **Highlighting**: the current sentence is always highlighted; the current word is highlighted when the voice reports word boundaries.
- **IPA**: English only (General American), from the CMU Pronouncing Dictionary (126k words, converted ARPAbet → IPA with stress marks). Shown under each word; can be hidden.
- **Practice**: *Listen and repeat* plays a sentence, gives you a timed pause to say it aloud, then continues. *Check what you said* uses browser speech recognition (where available) and marks which target words were recognised.
- **Browser support panel** that reports what this device actually supports.

## Run locally

Requirements: any static file server. Python 3 is used below; Node 18+ only for tests.

```bash
git clone https://github.com/nurdinovdilshod/photo-to-speech.git
cd photo-to-speech
python3 -m http.server 8080
# open http://localhost:8080
```

Opening `index.html` directly from disk (`file://`) does not work, because browsers block module scripts and `fetch` there. Camera capture and speech recognition need HTTPS or `localhost`.

## Tests

```bash
node --test tests/*.test.js          # unit tests + OCR pipeline (OCR tests need the `tesseract` CLI; skipped otherwise)

# Optional browser end-to-end test (real Chromium + Tesseract.js):
npm install --no-save playwright@1.48.2 && npx playwright install chromium
python3 -m http.server 8080 &
node tests/e2e.mjs
```

The GitHub Actions workflow runs all of these on every push to `main`, uploads screenshots, and deploys only if they pass.

## Project layout

| Path | Purpose |
| --- | --- |
| `page.html` | Page content (source of truth). |
| `index.html` | Generated from `page.html` by `python3 scripts/build_artifact.py`. Commit both. |
| `styles.css`, `app.js` | UI and app logic (plain ES modules). |
| `lib/text.js` | Pure helpers: OCR cleanup, sentence/word splitting, ARPAbet→IPA, spoken-word comparison. |
| `data/cmudict.txt` | CMU Pronouncing Dictionary, first pronunciation per word (BSD licence in `data/CMUDICT-LICENSE.txt`). |
| `tessdata/` | Tesseract `tessdata_fast` LSTM models (Apache-2.0). |
| `tests/` | Node tests, photo fixtures, browser e2e test. |

## Deploy

### GitHub Pages (configured)

1. Push to `main` on GitHub.
2. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions** (the workflow also tries to enable this automatically).
3. The workflow `.github/workflows/pages.yml` tests and deploys. The site appears at `https://<user>.github.io/photo-to-speech/`.

### Cloudflare Pages / Netlify / any static host

No build command. Output directory: the repository root (or upload `index.html styles.css app.js lib data tessdata`). For Cloudflare Pages: *Create project → Connect to Git → Framework preset: None → Build command: empty → Output directory: `/`*.

No environment variables are needed, so there is no `.env.example`.

## Privacy

- Photos are decoded, rotated and recognised **inside your browser**. They are never uploaded.
- The page downloads the Tesseract.js engine from the jsDelivr CDN and fonts from Google Fonts; language models and the dictionary come from this site.
- Speech playback uses voices installed on your device (some browsers also offer online voices, marked "online" in the voice list; the text you play is sent to that provider).
- Speech recognition in Chrome and Edge sends microphone audio to the browser vendor's speech service. It only starts when you press **Record**.

## Limitations (honest list)

- **OCR** works best on printed text photographed straight on, in good light. Handwriting, stylised fonts, curved pages, glare and low resolution reduce accuracy. Always check the extracted text. The `fast` models trade a little accuracy for size and speed.
- **Voices** depend on the operating system and browser. Uzbek voices in particular are missing on most devices; the app warns you and falls back to the default voice, which will mispronounce the text. Voice quality varies widely.
- **Word highlighting** needs `boundary` events. Chrome's online "Google" voices, many Android voices and some Safari voices do not send them, so only the sentence is highlighted.
- **Pause** is implemented as stop-and-remember, because native pause is unreliable on Android; *Resume* restarts the current sentence.
- **Speech recognition** is available in Chrome, Edge and Safari, not Firefox. It checks whether words were *understood*, not whether the accent is native, and it needs a network connection in Chrome/Edge.
- **IPA** is English only and follows General American pronunciation; words missing from the dictionary show a dot.
- **Camera capture** opens the camera on phones; on desktop the "Take photo" button opens a file picker.
- iPhone HEIC photos must be converted (iOS usually converts automatically when uploading through the browser).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Text recognition failed" | Check your connection (first run downloads ~3 MB engine + 1–6 MB model). Reload. Try another browser. |
| No text found | Use a sharper, brighter photo; crop to the text; pick the right language; rotate if sideways. |
| No sound | Unmute the device; on iPhone turn off silent mode; tap a play button (browsers block audio before interaction). |
| Wrong accent | Install a voice for that language in system settings (Windows: Time & language → Speech; Android: Text-to-speech; iOS: Accessibility → Spoken Content → Voices), then reload. |
| Record button does nothing | Allow microphone access for the site; use Chrome, Edge or Safari over HTTPS. |
| GitHub Pages 404 | Wait for the Actions run to finish; check Settings → Pages source is "GitHub Actions". |

## Licences

App code: MIT. Tesseract models: Apache-2.0 (tesseract-ocr/tessdata_fast). CMU Pronouncing Dictionary: BSD-2-Clause (see `data/CMUDICT-LICENSE.txt`).
