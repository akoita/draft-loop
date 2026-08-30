# v0.8.0-alpha.1 Usable CV MVP stage-exit candidate

**Status:** Pre-release stage-exit candidate — outcome not yet Validated or Released  
**Recorded:** 2026-08-30  
**Stage:** Usable CV MVP  
**Scope:** All 17 v0.8 issues are closed. The bounded drafting, review,
readiness, and export capabilities are integrated and have deterministic
validation evidence. This record is prepared before release workflow
publication and does not claim a published artifact.

## Evidence and boundary

- The v0.8 vertical connects selected candidate evidence and a reviewed
  opportunity to planning, complete-CV composition, independent critique,
  traceable revision, human approval, and local export.
- Issue #73 exact application-readiness approval is integrated. Approval binds
  to a fresh deterministic decision and the exact reviewed artifact; revisions
  invalidate stale approval.
- Issue #74 bounded export QA is integrated. Markdown checks are deterministic;
  PDF and DOCX checks use named byte-level inspectors and retain a content-free
  QA report with export history. Incomplete or failing PDF/DOCX QA blocks export.

## Local deterministic validation

The merged feature work was checked locally with the repository's deterministic
quality gates:

- `pnpm validate` passed with formatting, lint, architecture-hotspot,
  typechecking, license and secret checks, 78 Vitest files / 1,195 application
  tests, and the 54-test deterministic release suite.
- `pnpm release:check` passed with the root and all discovered workspace
  manifests aligned to `0.8.0-alpha.1`, stage metadata set to `usable-cv-mvp`,
  and the canonical version-agnostic releases URL in the README.
- `pnpm test:release` passed, including release metadata, artifact, security,
  packaged-workflow, and local-preflight contract tests.

These checks establish implementation and integration evidence. They do not
establish a representative product outcome.

## Outcome boundary

No representative consented outcome has been recorded for this candidate. The
v0.8 outcome therefore remains unvalidated, and the candidate must not be
described as Validated or Released before the release workflow publishes the
approved revision. After publication, the roadmap should add the release tag,
manifest, checksums, platform results, and any sanitized acceptance results.

## Remaining limitations

- DOCX OOXML inspection cannot establish office pagination or visual clipping.
  Broad cross-viewer validation also remains outstanding.
- Signing and automatic updates remain incomplete.
- The CLI remains source-distributed and has no standalone installer.
- Representative consented outcome evidence remains outstanding; deterministic
  and synthetic checks are not a substitute for that evidence.

## Next decision

Publish this alpha candidate only after maintainer review and the release
workflow's artifact checks. Keep v0.9 workflow parity and release work queued
after this publication: comparison evidence is #75 and the release evidence and
next decision are #76.
