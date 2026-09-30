# v0.8.0-alpha.2 Model profiles and tiers release evidence

**Status:** Released alpha artifact — outcome not Validated  
**Recorded:** 2026-09-30  
**Stage:** Model profiles and tiers  
**Scope:** Milestone 17 is closed with all 23 issues complete. Versioned profile
contracts, explicit selection, pricing scenarios, and bounded availability
checks are released. Representative CV quality remains unvalidated.

## Delivered scope

- Author and critic model controls are versioned, snapshotted with new runs,
  and reused when a run resumes. Existing workspace and authentication defaults
  are unchanged.
- The CLI and desktop offer explicit Economy and Standard selections. Economy
  pairs Claude Sonnet 5.5 with GPT-6 Luna; Standard pairs Claude Opus 5.5 with
  GPT-6.1 Sol. The active catalog contains these four exact profile versions.
- The desktop provides public API price scenarios, and the local-only
  availability preflight checks registered model destinations without changing
  catalog status or claiming CV quality.

The profile contract and controls were delivered under [#511](https://github.com/akoita/draft-loop/issues/511);
the current four-model catalog is tracked by [#694](https://github.com/akoita/draft-loop/issues/694).
CLI and desktop selection are tracked by [#684](https://github.com/akoita/draft-loop/issues/684)
and [#686](https://github.com/akoita/draft-loop/issues/686); pricing scenarios by
[#687](https://github.com/akoita/draft-loop/issues/687); availability preflight
by [#679](https://github.com/akoita/draft-loop/issues/679). The stage was opened
under [#84](https://github.com/akoita/draft-loop/issues/84).

## Deterministic and local release checks

The exact release revision passed `pnpm validate`, including 2,443 application
tests across 181 files and 67 release and script tests.

`pnpm release:preflight` passed with Anthropic API-key authentication and
OpenAI Codex user-session authentication. Its availability check, recorded at
`2026-09-30T16:55:25.837Z`, reported all four active model destinations
available. The synthetic workflow explicitly selected Sonnet 5.5 as author
and GPT-6 Luna as critic, overriding the older Haiku author after it omitted
the required Summary section. All 10 checks passed, all 15 claims linked to
evidence, and approval and export completed. The deterministic validators
were unchanged. This synthetic result does not validate representative CV
quality.

## Published release

- The [release tag](https://github.com/akoita/draft-loop/releases/tag/v0.8.0-alpha.2)
  was published at `2026-09-30T17:07:45Z` as the prerelease **Model profiles
  and tiers alpha**. It points to exact source revision
  `9de571e550867339638ee4ce27a8cce77c8f6012`.
- The [dry-run workflow](https://github.com/akoita/draft-loop/actions/runs/36747894962)
  passed source validation, all three platform builds, and Linux packaging
  smoke. The [publication workflow](https://github.com/akoita/draft-loop/actions/runs/36748642982)
  completed successfully.
- The release attaches Linux x64, macOS arm64, and Windows x64 ZIPs,
  `release-manifest.json`, `SHA256SUMS`, and a CycloneDX SBOM. All three
  downloaded ZIP sizes and hashes match the published manifest and checksum
  file. The manifest records aligned versions for all 16 packages; the SBOM
  contains 773 components.
- Provenance attestation was not requested.

## Limitations and next decision

The release does not establish representative job or language quality;
historical observations are not new validation. Broad job and language
fixtures remain separate work under [#583](https://github.com/akoita/draft-loop/issues/583).
OpenAI Codex user-session and local routes do not support profile controls;
manual model-ID selection remains available. DOCX pagination and broad
cross-viewer behavior remain unverified, signing and automatic updates are
incomplete, and the CLI remains source-distributed.

Existing workspace and authentication defaults remain unchanged. Any default
promotion is a separate decision under [#683](https://github.com/akoita/draft-loop/issues/683)
and requires representative quality evidence. No next sprint has been started.
