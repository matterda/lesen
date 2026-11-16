# Lesen: German reader

PWA for reading German books with in-context translations and flashcards. Works on iPad (Safari → Share → Add to Home Screen).

- Import a DRM-free `.epub` or `.txt`, or paste text.
- Tap a word, or long-press and drag to select a phrase, then "Translate selection".
- Translation comes from Claude with the surrounding passage, so it resolves separable verbs
  (`kommt … an` → ankommen), idioms, pronouns and word sense in context. Lookups are cached on the device.
- "+ Add to flashcards" saves the lemma with its sentence; review is scheduled with FSRS (`ts-fsrs`).
- Books, words and progress live in the browser (IndexedDB). Export words from Settings as a backup.

Needs an Anthropic API key (Settings), stored only on the device and sent only to api.anthropic.com.

    npm install
    npm run dev        # local dev
    npm run build      # static site in dist/, host on any HTTPS static host

Code: `src/importer.ts` (EPUB/TXT), `src/translate.ts` (prompt + Claude call), `src/srs.ts` (FSRS),
`src/db.ts` (IndexedDB), `src/main.ts` (views).
