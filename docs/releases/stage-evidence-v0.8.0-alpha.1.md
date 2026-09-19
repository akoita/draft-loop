# v0.8.0-alpha.1 Usable CV MVP release evidence

**Status:** Released alpha artifact — outcome not Validated
**Recorded:** 2026-08-30  
**Stage:** Usable CV MVP  
**Scope:** All 17 v0.8 issues are closed. The bounded drafting, review,
readiness, and export capabilities are integrated, deterministically validated,
and published as a cross-platform alpha artifact.

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

## Release evidence

- The exact release revision `85aae36d1c879bc0cdd81856ec179e8e89efea3e`
  passed `pnpm release:preflight`, including the deterministic suite and the
  synthetic live-provider workflow using Anthropic as author and OpenAI as
  critic.
- The [release workflow](https://github.com/akoita/draft-loop/actions/runs/33313291567)
  passed source validation and produced Linux x64, macOS arm64, and Windows x64
  desktop artifacts.
- The [v0.8.0-alpha.1 prerelease](https://github.com/akoita/draft-loop/releases/tag/v0.8.0-alpha.1)
  points to that exact revision and publishes the three platform ZIPs,
  `release-manifest.json`, `SHA256SUMS`, and a CycloneDX SBOM.
- A preceding [dry run](https://github.com/akoita/draft-loop/actions/runs/33313093965)
  verified the same platform matrix and release metadata. Provenance
  attestation was not requested for this alpha.

## Outcome boundary

No representative consented outcome has been recorded for this release. The
artifact is Released, but the v0.8 product outcome remains unvalidated.
Deterministic and synthetic checks must not be presented as representative
acceptance evidence.

## Remaining limitations

- DOCX OOXML inspection cannot establish office pagination or visual clipping.
  Broad cross-viewer validation also remains outstanding.
- Signing and automatic updates remain incomplete.
- The CLI remains source-distributed and has no standalone installer.
- Representative consented outcome evidence remains outstanding; deterministic
  and synthetic checks are not a substitute for that evidence.

## Next decision

Proceed to v0.9 workflow parity without broadening the MVP. Comparison evidence
is #75; consolidated release evidence and the next product decision are #76.
