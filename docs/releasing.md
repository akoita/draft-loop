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
- `release.json` defines the current roadmap stage, release channel, release
  name, and supported desktop artifact targets. It must agree with the current
  stage in `docs/roadmap.md` before a release starts.
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

## Stage release procedure

1. Update the root version and all workspace package versions in a focused PR.
2. Update `release.json` to the stage being exited and verify that its stage and
   channel match the roadmap. Review the stage acceptance criteria and evidence
   links.
3. Merge the PR into `main` and wait for CI to pass.
4. Run **Release** from GitHub Actions with the matching version and
   `dry_run=true`. Keep `attest_provenance=false` for a dry run.
5. Review the dry-run manifest, platform artifacts, checksums, and known
   limitations, including the attached CycloneDX SBOM.
6. Re-run the workflow with `dry_run=false` after maintainer approval. Set
   `attest_provenance=true` only when the repository plan supports GitHub
   artifact attestations.
7. Confirm the GitHub tag, generated notes, attached artifacts, manifest,
   CycloneDX SBOM, and `SHA256SUMS` file. Verify attestations with
   `gh attestation verify` when enabled.
8. Update the roadmap stage evidence with the achieved status level, acceptance
   results, supported-platform matrix, product measures, release tag, manifest,
   checksums, known limitations, unresolved risks, and next decision. Do not
   label the stage Validated when only implementation or synthetic evidence is
   available.

The workflow builds the packaged desktop application on Linux, macOS, and
Windows. The CLI remains source-distributed during the alpha stage; a
standalone CLI installer is a follow-up release deliverable.
