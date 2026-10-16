# Third-party notice: Carlito

DraftLoop embeds the Carlito Regular and Bold fonts in the PDFs it exports. Carlito is
metric-compatible with Calibri, so the PDF lays out like the DOCX that names Calibri.

- **Licence:** SIL Open Font License 1.1, in [`OFL.txt`](OFL.txt).
- **Copyright:** 2013 The Carlito Project Authors (<https://github.com/googlefonts/carlito>),
  Reserved Font Name "Carlito". The fonts are embedded unmodified and unsubsetted.
- **Source:** <https://github.com/google/fonts>, directory `ofl/carlito/`, commit
  `3dd78844021e948ceb633d1dcee3f7885561b5d9`.

| File               | Bytes   | SHA-256                                                            |
| ------------------ | ------- | ------------------------------------------------------------------ |
| `Carlito-Regular.ttf` | 628,032 | `f6418f708baede9789daef5d458c0f53d2a888af9820e8062934e504fedc6595` |
| `Carlito-Bold.ttf`    | 682,468 | `bb5d20f79b82599ec72983597437373a80f2d2085fa91fc144fd74e876a594db` |

## How the fonts ship

The TrueType files are not checked in. `src/carlito-font-data.ts` holds each file
Flate-compressed and base64-encoded, plus the widths and descriptor metrics read from it. Being
ordinary TypeScript, it is bundled into the CLI and into the desktop main process with no file
lookup inside `app.asar`.

To regenerate it, run `node scripts/generate-carlito-font-module.mjs` (it downloads from the
pinned commit, or reads `--from DIR`). The script verifies both checksums first and fails closed
on a mismatch. A unit test inflates the embedded data and checks the same checksums.
