# v0.8.0-alpha.4 Local-first CV quality checkpoint release evidence

**Status:** Released alpha checkpoint — outcome not Validated  
**Recorded:** 2026-10-21  
**Stage:** Local-first final: CV quality parity  
**Scope:** An explicitly requested checkpoint, not a stage exit. The
[#1309](https://github.com/akoita/draft-loop/issues/1309) exit, parity on 3 of
4 private references, is not scored yet
([#1307](https://github.com/akoita/draft-loop/issues/1307)). No parity score or
outcome validation is claimed.

## Delivered scope

The checkpoint covers the 402 commits merged since v0.8.0-alpha.3.

alpha.4 was first prepared on 2026-10-15
([#1267](https://github.com/akoita/draft-loop/pull/1267)). It was held because
the preflight had no Anthropic access
([#1268](https://github.com/akoita/draft-loop/issues/1268)). It was then
re-prepared from current `main` in
[#1425](https://github.com/akoita/draft-loop/pull/1425).

**Completed stages carried by this release:**

- Local semantic retrieval
- Inputs and setup clarity
- Development model providers
- Any-format career intake
- Candidate home and applications
- Tailored, sendable CVs
- Simple guided workflow, whose exit was met in a fixture walk

**CV quality work so far (rollup [#1309](https://github.com/akoita/draft-loop/issues/1309)):**

- An application plan is drafted before the CV, and the draft is written to a chosen one- or two-page target.
- Candidates can give the author directions between rounds.
- Accepted findings are applied as targeted patches.
- A strategic critic is added. The run stops when author and critic agree, and pauses and resumes on a subscription usage limit.
- Two runs can be compared side by side, and the better draft kept.
- Exports are sendable DOCX and PDF with the candidate's layout, printed through the browser engine. Classic, Compact and Modern templates are available, and Modern is the default.
- The review screen adds a Job tab, one footer stage at a time and a scrollable findings list.
- Run history no longer stores every snapshot in full ([#1256](https://github.com/akoita/draft-loop/issues/1256)).

Storage now sits behind ports for the future hosted version (client-server
phase 0 and 1a). Desktop and CLI behaviour is unchanged.

## Deterministic and local release checks

The release-preparation PR,
[#1425](https://github.com/akoita/draft-loop/pull/1425), passed
`pnpm release:check` and all PR checks.

`pnpm release:preflight` passed from a clean worktree at the release revision:

- **Validation:** `pnpm validate` ran 5,848 tests across 513 files, with 77
  opt-in tests skipped, and 71 release and script tests.
- **Route:** the default mixed route, with an Anthropic API key and the OpenAI
  Codex user session. CLI versions were Claude Code 2.1.296 and Codex 0.162.1.
- **Availability:** the check at `2026-10-21T00:25:55.661Z` reported all four
  catalog destinations available.
- **Synthetic workflow:** the author was Claude Sonnet 5.5 and the critic was
  GPT-6 Luna. All 10 checks passed and all 33 claims were linked to evidence.
  The 4 findings were accepted, and approval and export completed in 55 seconds.

The Sonnet 5.5 author was set through `DRAFT_LOOP_LIVE_E2E_AUTHOR_MODEL`, as in
alpha.2 and alpha.3. The script's default author, Claude Haiku 4.5, is outside
the current catalog. In an earlier attempt at the same revision it failed the
author step: it ran out of structured-output retries
([#1430](https://github.com/akoita/draft-loop/issues/1430)). The maintainer
approved the override.

This synthetic result does not validate representative CV quality or parity.

## Published release

- **Tag:** the [release](https://github.com/akoita/draft-loop/releases/tag/v0.8.0-alpha.4)
  was published at `2026-10-21T00:47:50Z` as the prerelease **Local-first CV
  quality checkpoint alpha**. It points to exact source revision
  `63e739471279f4e8202dad5b48df8306ea182a15`.
- **Workflows:** the [dry-run workflow](https://github.com/akoita/draft-loop/actions/runs/39521617486)
  passed source validation, all three platform builds, and installed-app and
  credential acceptance on each. The
  [publication workflow](https://github.com/akoita/draft-loop/actions/runs/39522724034)
  completed successfully.
- **Assets:** the release attaches the following files:
  - Linux x64, macOS arm64 and Windows x64 ZIPs;
  - `release-manifest.json` and `SHA256SUMS`;
  - a CycloneDX SBOM with 850 components.

  All three ZIP sizes and hashes match the published manifest, the checksum
  file and GitHub's asset digests. The manifest records aligned versions for
  all 18 packages.

- **Provenance:** attestation was not requested.

## Limitations and next decision

- Representative consented CV quality and manual-parity outcomes remain
  unvalidated. The parity baseline on references A to E is not yet scored on
  this revision ([#1307](https://github.com/akoita/draft-loop/issues/1307)).
- Templates derived from a CV the person likes are not available yet
  ([#1331](https://github.com/akoita/draft-loop/issues/1331)).
- The provider sign-in check in the start checklist is advisory.
- DOCX pagination and broad cross-viewer behaviour remain unverified.
- Signing and automatic updates are incomplete, and the CLI remains
  source-distributed.
- Codex user-session and local routes do not support profile controls.

The CV quality parity stage continues toward its #1309 exit, scored by #1307.
