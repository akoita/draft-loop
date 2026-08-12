# Releasing DraftLoop

DraftLoop produces a versioned release after each roadmap stage. A release is
created only from the approved `main` branch and becomes the reproducible
baseline for the next stage.

## Release policy

- The root `package.json` version is the release version source of truth.
- Every workspace package must carry the same version. `pnpm release:check`
  rejects drift before a release can start.
- `release.json` defines the current roadmap stage, release channel, release
  name, and supported desktop artifact targets.
- Alpha and pilot releases are GitHub prereleases. A stable release is the
  default channel for a production-ready beta or later stage.
- Publishing requires an explicit maintainer decision: the workflow is
  manually dispatched and the publish job uses the `release` environment.
- Candidate source material, workspace databases, provider credentials, and
  run history are never included in release artifacts or manifests.

Signing, automatic updates, and broader distribution remain later beta-stage
work. The current release process provides repeatable GitHub artifacts,
checksums, release metadata, and generated release notes.

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

## Stage release procedure

1. Update the root version and all workspace package versions in a focused PR.
2. Update `release.json` to the stage being exited and verify the roadmap
   issue links and acceptance evidence.
3. Merge the PR into `main` and wait for CI to pass.
4. Run **Release** from GitHub Actions with the matching version and
   `dry_run=true`.
5. Review the dry-run manifest, platform artifacts, checksums, and known
   limitations.
6. Re-run the workflow with `dry_run=false` after maintainer approval.
7. Confirm the GitHub tag, generated notes, attached artifacts, manifest, and
   `SHA256SUMS` file. Update `docs/roadmap.md` with the release evidence.

The workflow builds the packaged desktop application on Linux, macOS, and
Windows. The CLI remains source-distributed during the alpha stage; a
standalone CLI installer is a follow-up release deliverable.
