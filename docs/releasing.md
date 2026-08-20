# Releasing DraftLoop

DraftLoop intends to produce a versioned release at each roadmap stage exit. A
release is created only from the approved `main` branch and becomes a
reproducible baseline for the next stage. Publishing an artifact proves the
Released evidence level; it does not by itself prove that the product outcome
was Validated.

## Release policy

- The root `package.json` version is the release version source of truth.
- Every workspace package must carry the same version. `pnpm release:check`
  rejects drift before a release can start.
- `release.json` defines the current roadmap stage, stage issue, release
  channel, release name, and supported desktop artifact targets. It must agree
  with the current stage in `docs/roadmap.md` before a release starts.
- The current Integration hardening and outcome validation channel is `alpha`;
  alpha and pilot releases are GitHub prereleases.
- A stable channel is allowed only after the production-beta exit criteria are
  demonstrated. Implemented beta components or a higher package version do not
  justify a stable channel on their own.
- Publishing requires an explicit maintainer decision: the workflow is
  manually dispatched and the publish job uses the `release` environment.
- Candidate source material, workspace databases, provider credentials, and
  run history are never included in release artifacts or manifests.
- Each release includes a CycloneDX JSON software bill of materials generated
  from the checked-out dependency tree with a pinned Syft version.

Signing, automatic updates, migrations/rollback, and broader distribution
remain production-beta work. Until they are validated, releases remain alpha
artifacts and must state those limitations. GitHub artifact provenance
attestations are opt-in because GitHub only
supports attestations for private repositories on eligible enterprise plans.
When enabled, the workflow attests the packaged desktop artifacts after they
are downloaded into the publishing job.

## Local checks

Run the release contract and manifest tests locally:

```text
pnpm release:check
pnpm test:release
```

To inspect a manifest for local build output without writing a file:

```text
pnpm release:manifest --dry-run --commit "$(git rev-parse HEAD)" --artifacts-dir ./path/to/artifacts
```

The manifest records the project and stage, package versions, commit, runtime
versions, artifact paths, byte sizes, and SHA-256 checksums. Checksum files are
excluded from the artifact list to avoid self-referential metadata.

## Package size diagnostics

The release script also provides a read-only, deterministic size report for an
explicit unpacked package directory or ZIP archive. It does not change the
packaging configuration or package contents:

```text
node scripts/release.mjs size-report --input ./apps/desktop/out/<unpacked-package> --format text
node scripts/release.mjs size-report --input ./apps/desktop/out/make/<package>.zip > package-size.json
```

JSON is the default format. Use `--format text` for a category summary and the
largest files, or add `--output <path>` to write either format to a file. The
report has explicit totals and file counts for `runtime`, `nativeModules`,
`dependencies`, `assets`, `generated`, `sourceMaps`, `tests`, and `other`.
Directory reports use file sizes from the unpacked tree. ZIP reports include
logical (uncompressed) bytes in `totalBytes`, compressed member payload bytes
in `totalStoredBytes`, and the complete archive size in `inputBytes`.

Classification uses normalized relative paths and exact path segments or file
extensions, with this precedence: Electron/runtime paths, `.node` native
modules, source maps, test paths, `node_modules` dependencies, asset paths,
generated paths, then `other`. Absolute paths and `..` traversal segments in
archives are rejected. Directory symlinks are not followed; ignored entries
are listed in the report. Files and categories are sorted deterministically so
reports can be compared between builds.

The Linux packaging job also launches the unpacked Electron binary twice in a
headless smoke workflow. The first launch creates a synthetic offline run and
requests a revision; the second launch reopens the workspace, resumes the run,
approves the revised draft, and verifies the local export. This keeps the
packaged host, SQLite runtime, and restart boundary in the release gate.
This synthetic smoke is implementation and integration evidence. It is not a
substitute for installed-app acceptance with representative real inputs on each
supported platform.

To run the same check locally after packaging:

```text
pnpm desktop:smoke -- ./apps/desktop/out/@draft-loop-desktop-linux-x64/@draft-loop-desktop
```

Before a release, run the mandatory local preflight:

```text
pnpm release:preflight
```

The command first requires a clean worktree, then runs `pnpm validate` followed
by the paid synthetic live-provider gate. It fails closed on either failure and
refuses to run when `CI` or `GITHUB_ACTIONS` is enabled. Its default mixed route
is Anthropic API-key mode with OpenAI user-session mode; the provider-specific
environment variables below remain available as explicit local overrides.

For an experimental local run through authenticated Claude and Codex user
sessions, first complete `claude auth login` and `codex login`, then run:

```text
DRAFT_LOOP_PROVIDER_AUTH_MODE=user-session \
DRAFT_LOOP_LIVE_E2E_AUTHOR_MODEL=claude-haiku-4-5 \
DRAFT_LOOP_LIVE_E2E_CRITIC_MODEL=gpt-5.3-codex-spark \
pnpm test:e2e:live
```

This invokes the same production provider contracts with a different explicit
authentication mode. It consumes subscription allowance, requires the vendor
runtimes to be installed, reports per-request dollar cost as unknown, and
never falls back to an API key. The mode is experimental and does not replace
the API-key-backed local release check.

When only one subscription or API balance is available, select each transport
explicitly. For example, Anthropic API billing with an OpenAI subscription:

```text
DRAFT_LOOP_ANTHROPIC_AUTH_MODE=api-key \
DRAFT_LOOP_OPENAI_AUTH_MODE=user-session \
DRAFT_LOOP_LIVE_E2E_AUTHOR_MODEL=claude-haiku-4-5 \
DRAFT_LOOP_LIVE_E2E_CRITIC_MODEL=gpt-5.3-codex-spark \
pnpm test:e2e:live
```

This is deterministic transport selection, not automatic fallback. The live
provider gate is local-only: do not add provider credentials or subscription
sessions to GitHub Actions or another CI/CD environment.

The live gate uses synthetic `example.test`-style job and candidate material.
In API-key mode it requires both Anthropic and OpenAI credentials to already be
configured in the Electron application and incurs a bounded provider cost. Run this gate before
manual Electron validation with consented real data; never use real candidate
material in the synthetic gate.

This gate is a release step and not a development loop. Day-to-day work on the
author-critic flow belongs in fixture mode, which spends nothing — see
[CONTRIBUTING.md](../CONTRIBUTING.md). Running the gate during ordinary
iteration is what exhausts the provider budget this release validation depends
on.

The gate runs `claude-haiku-4-5` as author and `gpt-5.6-luna` as critic. These
are deliberately the cheapest models that still exercise the real provider path,
because the gate's purpose is to prove the path works, not to measure output
quality. They remain a cross-company pair, so provider diversity is unchanged.
Override either side for a run without editing code:

```text
DRAFT_LOOP_LIVE_E2E_AUTHOR_MODEL=claude-sonnet-4-5 pnpm test:e2e:live
DRAFT_LOOP_LIVE_E2E_CRITIC_MODEL=gpt-5 pnpm test:e2e:live
```

The gate prints the pair it is about to bill before launching. If a cheap model
ever proves unreliable on the synthetic material, override it for that run and
change the default here rather than leaving the gate flaky.

The live provider gate does not run in CI or the **Release** workflow. CI runs
the deterministic `pnpm validate` suite and packaged offline acceptance gates,
which require no provider credentials. Before starting a release workflow, a
maintainer runs the live gate locally with synthetic material and records the
sanitized result in the release evidence. Provider API keys and local vendor
sessions remain outside CI/CD.

## Stage release procedure

1. Update the root version and all workspace package versions in a focused PR.
2. Update `release.json` to the stage being exited and verify that its stage and
   channel match the roadmap. Review the stage acceptance criteria and evidence
   links.
3. Merge the PR into `main` and wait for CI to pass.
4. In a clean local worktree at the exact approved `main` commit, run
   `pnpm release:preflight` and record its sanitized live-provider result in the
   release evidence. Do not change the release revision afterward.
5. Run **Release** from GitHub Actions with the matching version and
   `dry_run=true`. Keep `attest_provenance=false` for a dry run.
6. Review the dry-run manifest, platform artifacts, checksums, and known
   limitations, including the attached CycloneDX SBOM.
7. Re-run the workflow with `dry_run=false` after maintainer approval. Set
   `attest_provenance=true` only when the repository plan supports GitHub
   artifact attestations.
8. Confirm the GitHub tag, generated notes, attached artifacts, manifest,
   CycloneDX SBOM, and `SHA256SUMS` file. Verify attestations with
   `gh attestation verify` when enabled.
9. Update the roadmap stage evidence with the achieved status level, acceptance
   results, supported-platform matrix, product measures, release tag, manifest,
   checksums, known limitations, unresolved risks, and next decision. Do not
   label the stage Validated when only implementation or synthetic evidence is
   available.

The workflow builds the packaged desktop application on Linux, macOS, and
Windows. The CLI remains source-distributed during the alpha stage; a
standalone CLI installer is a follow-up release deliverable.
