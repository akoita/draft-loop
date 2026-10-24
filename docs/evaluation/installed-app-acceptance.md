# Installed-app acceptance

The installed-app acceptance workflow runs the packaged Electron application
twice on Linux x64, macOS arm64, and Windows x64. It runs in every release build
before publishing, on manual dispatch, and on pull requests that can change the
packaged app. Pull requests that change only documentation or tests skip it;
`scripts/desktop-ci-scope.mjs` decides, and the always-reporting
`Installed app acceptance gate` check carries the result. It uses a safely sanitized
candidate Markdown file and a deterministic local response for an explicitly
approved job URL. It does not contact a model provider or fetch the public
internet.

The first launch creates a demo workspace, imports the candidate file, ingests
the approved job URL, acknowledges the provider transmission preflight, runs
the author–critic fixture, requests a revision, and verifies URL provenance.
The second launch reopens the workspace, resumes the run, approves the revised
artifact, exports Markdown, DOCX, and PDF, and checks durable history and
workspace metadata.

Packaged builds ship a pruned, CPU-only `onnxruntime-node` for the target
platform as an extra resource (`resources/onnxruntime-node`, staged by
`apps/desktop/forge.config.ts`); the embedding model itself is not bundled.
The second launch also runs a tiny embedded ONNX model through the packaged
runtime and records the result as the `embeddingRuntime` check.

Packaging stops at the Vite build when the main or preload bundle fails, and
shows Vite's error. Without `apps/desktop/vite-build-guard.ts`, Forge's Vite
plugin would report the target as built and fail later with "The main entry
point to your app was not found". `pnpm validate` does not package the app, so
check a change to the main-process bundle locally with
`pnpm --filter @draft-loop/desktop package`.

Each matrix job uploads a JSON artifact containing only the app version,
packaged executable checksum, OS metadata, boolean workflow results, and
limitations. It does not contain candidate text, the job URL, credentials, or
provider traffic. Credential lifecycle results are produced by the separate
[credential acceptance workflow](credential-acceptance.md).

Run the harness locally against a packaged executable:

```text
pnpm desktop:acceptance -- <packaged-executable> <evidence.json>
```

This is installed-app integration evidence for sanitized offline material. It
does not by itself validate live provider authentication, provider response
quality, or the consented real-application outcome required by later roadmap
issues.
