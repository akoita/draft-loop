# Releasing DraftLoop

DraftLoop intends to produce a versioned release at each roadmap stage exit. An
explicitly approved alpha sprint checkpoint may also be released before a
stage exit. Every release is created only from the approved `main` branch;
publishing an artifact proves the Released evidence level for that artifact,
but it does not by itself prove that the product outcome was Validated.

This page covers the desktop and CLI releases. Server releases of the hosted
service (`server-vX.Y.Z`) follow [Deploying the hosted service](server-deploy.md).

## Release policy

- The root `package.json` version is the release version source of truth.
- Every workspace package must carry the same version. `pnpm release:check`
  rejects drift before a release can start.
- `release.json` defines the current roadmap stage, stage issue, release
  channel, release name, and supported desktop artifact targets. It must agree
  with the current stage in `docs/roadmap.md` before a release starts.
- An explicitly approved alpha sprint checkpoint may cover a completed sprint
  before a roadmap stage exit. It must use a prerelease version, must not
  advance the roadmap stage status or claim outcome validation, and must state
  its remaining limitations.
- Desktop releases use the `alpha` channel; alpha and pilot
  releases are GitHub prereleases.
- A stable channel is allowed only after the production-beta exit criteria are
  demonstrated. Implemented beta components or a higher package version do not
  justify a stable channel on their own.
- Publishing requires an explicit maintainer decision: the workflow is
  manually dispatched and the publish job uses the `release` environment.
- Career evidence, workspace databases, provider credentials, and
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

`pnpm release:check` requires the README to use the version-agnostic releases
URL and rejects version-pinned GitHub release-tag links, so current download
guidance remains durable across releases.

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
node scripts/release.mjs size-report --input ./apps/desktop-client/out/<unpacked-package> --format text
node scripts/release.mjs size-report --input ./apps/desktop-client/out/make/<package>.zip > package-size.json
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

Each packaging job, on all three platforms, builds the desktop client
(`apps/desktop-client`, ADR 0011, D9) and runs its packaged acceptance
(`pnpm desktop-client:acceptance`) against a scripted fake API on the runner:
the server picker, the window's isolation and navigation rules, and a relaunch.
A failure on any platform stops the release before publishing. The sanitized
evidence is uploaded as `acceptance-evidence-<platform>`.

Before a release, run the mandatory local preflight:

```text
pnpm release:preflight
```

The command requires a clean worktree, then runs `pnpm validate`, packages the
desktop client for this computer and runs its packaged acceptance. The client
calls no provider, so no step receives provider credentials or spends money.
It fails closed on command failure and refuses to run when `CI` or
`GITHUB_ACTIONS` is enabled. On Linux and WSL it needs a display, such as WSLg
or `xvfb-run`.

## Live provider checks (manual)

`pnpm test:model-suggestions:live` remains a manual, paid check of the model
catalog's destinations. It is not a release step; run it only with approval for
its exact plan. The desktop client calls no provider, so no live check covers it.

Inspect the exact bounded request and current registry-derived plan without
creating provider adapters or resolving credentials:

```text
pnpm test:model-suggestions:live --plan
```

The live check sends one content-free structured request per exact
provider/model/role row, without model-profile controls. It reports whether
each destination was available under this check; it does not update catalog
availability, guarantee account access, or validate CV quality. All four
current economy and standard-preset destinations must pass. Optional entries
not used by these presets, if ever added to the catalog, are reported
separately. User-session checks can consume subscription allowance. Each row
has a 60-second timeout and requests at most 1,024 output tokens. API SDK and
adapter retries are disabled. Codex cannot enforce that token cap before generation; its adapter checks the
response afterward, and CLI-internal requests are outside this command’s
retry control. The command is local-only and must never run in CI/CD.

Before running the live command, obtain approval for the exact plan: model
IDs, routes, roles, synthetic payload, request controls, and cost/call bounds.
Plan inspection and deterministic tests do not authorize provider calls.

The live check never runs in CI or the **Release** workflow. CI runs the
deterministic `pnpm validate` suite and the packaged offline acceptance gate,
which require no provider credentials. Provider API keys and local vendor
sessions remain outside CI/CD.

## Stage or checkpoint release procedure

1. Update the root version and all workspace package versions in a focused PR.
2. Update `release.json` to the stage being exited or checkpointed and verify
   that its stage and channel match the roadmap. For a checkpoint, keep the
   stage status and exit criteria unchanged. Review the stage acceptance
   criteria and evidence links, plus the README maturity and
   installation/download wording.
3. Merge the PR into `main` and wait for CI to pass.
4. In a clean local worktree at the exact approved `main` commit, run
   `pnpm release:preflight` and record its result in the release evidence. Do
   not change the release revision afterward.
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
