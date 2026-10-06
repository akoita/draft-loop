# v0.8.0-alpha.3 Manual parity inputs checkpoint release evidence

**Status:** Released alpha checkpoint — outcome not Validated  
**Recorded:** 2026-10-06  
**Stage:** Manual parity: inputs  
**Scope:** An explicitly requested sprint checkpoint, not a stage exit. Six of
the 14 execution issues in [milestone 22](https://github.com/akoita/draft-loop/milestone/22)
were closed at the release revision. The stage status and exit criterion are
unchanged, and no parity score or outcome validation is claimed.

## Delivered scope

The checkpoint covers the 94 commits merged since v0.8.0-alpha.2.

**Manual parity inputs (rollup [#869](https://github.com/akoita/draft-loop/issues/869)):**

- A content-free parity score and its first baseline are defined ([#870](https://github.com/akoita/draft-loop/issues/870)).
- Profile derivation accepts one career source of up to 524,288 characters without manual splitting ([#871](https://github.com/akoita/draft-loop/issues/871)).
- Every new real workspace starts with a default CV writing policy ([#875](https://github.com/akoita/draft-loop/issues/875)), and the desktop can edit it ([#876](https://github.com/akoita/draft-loop/issues/876)).
- Knowledge-source sections can be classified into sensitivity tiers from heading rules ([#872](https://github.com/akoita/draft-loop/issues/872)), and those rules persist in the knowledge store ([#882](https://github.com/akoita/draft-loop/issues/882)).

**Review workflow and desktop:**

- Profile extraction recovers from truncated and interrupted responses and keeps grounded facts.
- The desktop shows profile generation progress with cancel, reviewable canonical profiles, model preset cards, and start-blocker reasons.
- An off-by-default autopilot runs review rounds unattended.
- A person can approve past failing final CV checks with a recorded reason.
- Runs without a reviewed brief refuse job text that yields paragraph-sized requirements.
- Opt-in Gemini and GLM development presets are available.

Workspace defaults and authentication settings are unchanged.

## Deterministic and local release checks

The release-preparation PR, [#887](https://github.com/akoita/draft-loop/pull/887), passed `pnpm release:check`, `pnpm validate`, and all seven PR checks.

`pnpm release:preflight` passed from the clean release revision. Its
`pnpm validate` step ran 3,244 application tests across 253 files.

**Route:** both providers used authenticated user sessions, through the
documented local override `DRAFT_LOOP_ANTHROPIC_AUTH_MODE=user-session`. This
differs from the default mixed route, which uses the Anthropic API key, and
the maintainer approved it. CLI versions were Claude Code 2.1.284 and Codex
0.159.1.

**Availability:** the check at `2026-10-06T00:09:21.466Z` reported all four
active model destinations available.

**Synthetic workflow:** the run used Claude Sonnet 5.5 as author, explicitly
overriding the Haiku default as in alpha.2, and GPT-6 Luna as critic. All 10
checks passed, all 19 claims were linked to evidence, and approval and export
completed. The session route reports dollar cost as unknown (recorded as 0).

This synthetic result does not validate representative CV quality or parity.

## Published release

- **Tag:** the [release tag](https://github.com/akoita/draft-loop/releases/tag/v0.8.0-alpha.3)
  was published at `2026-10-06T00:21:45Z` as the prerelease **Manual parity
  inputs checkpoint alpha**. It points to exact source revision
  `984ee50a3841408bd61a8121e7a36a43b67bff44`.
- **Workflows:** the [dry-run workflow](https://github.com/akoita/draft-loop/actions/runs/37392545810)
  passed source validation and all three platform builds. The
  [publication workflow](https://github.com/akoita/draft-loop/actions/runs/37393186291)
  completed successfully.
- **Assets:** the release attaches Linux x64, macOS arm64, and Windows x64
  ZIPs, `release-manifest.json`, `SHA256SUMS`, and a CycloneDX SBOM with 808
  components. All three ZIP sizes and hashes match the published manifest,
  the checksum file, and GitHub's asset digests. The manifest records aligned
  versions for all 16 packages.
- **Notes correction:** #876 and #882 merged just before the release PR, so
  the generated notes wrongly said the writing policy had no desktop editor.
  The published notes were corrected after publication.
- **Provenance:** attestation was not requested.

## Limitations and next decision

Sensitivity tiers are classified and stored but not yet enforced. Never-share
and sensitive sections are not yet kept out of profile derivation or run
retrieval ([#873](https://github.com/akoita/draft-loop/issues/873),
[#891](https://github.com/akoita/draft-loop/issues/891),
[#892](https://github.com/akoita/draft-loop/issues/892)).

The author still sees a bounded set of retrieved excerpts
([#877](https://github.com/akoita/draft-loop/issues/877)), and no scored parity
observation exists yet ([#878](https://github.com/akoita/draft-loop/issues/878)).

The earlier limitations remain:

- Codex user-session and local routes do not support profile controls.
- DOCX pagination and broad cross-viewer behavior remain unverified.
- Signing and automatic updates are incomplete.
- The CLI remains source-distributed.

The Manual parity: inputs sprint continues toward its #878 exit criterion.
