# v0.8.0-alpha.5 Local-first CV quality checkpoint release evidence

**Status:** Released alpha checkpoint — outcome not Validated  
**Recorded:** 2026-10-31  
**Stage:** Local-first final: CV quality parity  
**Scope:** A security checkpoint, not a stage exit. The
[#1309](https://github.com/akoita/draft-loop/issues/1309) exit is not met, and
no parity score or outcome validation is claimed.

## Why this release

The October 2026 Node.js security releases fixed several vulnerabilities,
including a Brotli decompression flaw reachable through approved job-page
fetches. The desktop bundles Node.js inside Electron, so only a new desktop
build carries the fix to installed apps.

alpha.5 bundles Electron 44.10.0, the first Electron 44 release on npm with
Node.js 24.22.1 ([#1981](https://github.com/akoita/draft-loop/pull/1981),
closing [#1496](https://github.com/akoita/draft-loop/issues/1496)). The
repository's Node.js pin and server images moved to 24.22.1 earlier
([#1497](https://github.com/akoita/draft-loop/pull/1497)).

## Delivered scope

The checkpoint covers the 279 commits merged since v0.8.0-alpha.4. The release
notes summarize the desktop and CLI changes:

- A reasoning level can be chosen per role and is shown before and after a run.
- Review edits become a new draft version at approval, with edited blocks marked.
- New warnings and author and critic changes target CV quality (rollup #1309).
- A provider call whose worst-case cost would pass the run's cost limit is refused.
- Claude reviewer profiles and Anthropic-only presets are available.
- The desktop screens moved into a shared UI package that the hosted web
  version also uses.

The other changes build the hosted client-server version and do not change
desktop or CLI behaviour.

## Deterministic and local release checks

The release-preparation PR,
[#1999](https://github.com/akoita/draft-loop/pull/1999), passed
`pnpm release:check` and all PR checks.

The first preflight, at `8733c9a`, failed at approval in the synthetic live
workflow. The application-readiness checks now refuse the thin synthetic
candidate, and the host left the run unapproved.
[#2000](https://github.com/akoita/draft-loop/pull/2000) makes the gate approve
past those checks with a recorded synthetic rationale, as a person would, and
report `readinessOverridden`. The gate proves the provider, approval and export
path; it does not judge CV quality.

`pnpm release:preflight` then passed from a clean worktree at the release
revision:

- **Validation:** `pnpm validate` ran 7,586 tests across 696 files, with 278
  opt-in tests skipped, and 89 release and script tests.
- **Route:** the default mixed route, with an Anthropic API key and the OpenAI
  Codex user session (Codex 0.162.1).
- **Availability:** the check at `2026-10-31T01:10:08.950Z` reported all four
  catalog destinations available.
- **Synthetic workflow:** the author was Claude Sonnet 5.5, set through
  `DRAFT_LOOP_LIVE_E2E_AUTHOR_MODEL` as in earlier alphas, and the critic was
  GPT-6 Luna. All 11 checks passed, including the readiness override, and all
  34 claims were linked to evidence. The 6 findings were accepted, and approval
  and export completed in 54 seconds for US$0.12.

This synthetic result does not validate representative CV quality or parity.

## Published release

- **Tag:** the [release](https://github.com/akoita/draft-loop/releases/tag/v0.8.0-alpha.5)
  was published at `2026-10-31T02:25:06Z` as the prerelease **Local-first CV quality
  checkpoint alpha**. It points to exact source revision
  `728053a850839bf35a8eeeac4952a4218433db4c`.
- **Workflows:** the [dry-run workflow](https://github.com/akoita/draft-loop/actions/runs/41154275149)
  passed source validation, all three platform builds, and installed-app and
  credential acceptance on each. The
  [publication workflow](https://github.com/akoita/draft-loop/actions/runs/41159073861)
  completed successfully.
- **Assets:** the release attaches the following files:
  - Linux x64, macOS arm64 and Windows x64 ZIPs;
  - `release-manifest.json` and `SHA256SUMS`;
  - a CycloneDX SBOM with 1,170 components.

  All three ZIP sizes and hashes match the published manifest, the checksum
  file and GitHub's asset digests. The Windows x64 ZIP is 199,475,048 bytes
  with SHA-256 `bfe4ba3c6038d13de0930e4b7d051e84c74607b402e4a668c7a81777d8c65453`.
  The manifest records aligned versions for all 27 packages.

- **Provenance:** attestation was not requested.

## Limitations and next decision

- Representative consented CV quality and manual-parity outcomes remain
  unvalidated. Parity scoring on the private references is in progress
  ([#1307](https://github.com/akoita/draft-loop/issues/1307)).
- Templates derived from a CV the person likes are not available yet
  ([#1331](https://github.com/akoita/draft-loop/issues/1331)).
- The provider sign-in check in the start checklist is advisory.
- DOCX pagination and broad cross-viewer behaviour remain unverified.
- Signing and automatic updates are incomplete, and the CLI remains
  source-distributed.
- Codex user-session and local routes do not support profile controls.

The CV quality parity stage continues toward its #1309 exit, scored by #1307.
