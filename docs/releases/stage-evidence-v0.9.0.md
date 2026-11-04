# v0.9.0 Desktop client alpha release evidence

**Status:** Released alpha — outcome not Validated  
**Recorded:** 2026-11-04  
**Stage:** Client-server version, phase 2 ([#1359](https://github.com/akoita/draft-loop/issues/1359))  
**Scope:** The first desktop client release. It claims no CV quality result:
the [#1309](https://github.com/akoita/draft-loop/issues/1309) exit is not met.

## Why this release

From v0.9.0 the desktop app is a client of a DraftLoop server
([ADR 0011](../adr/0011-client-server-version.md), D9): an Electron window over
the server's own web screen. It holds no engine, storage or provider keys, so
its screens update with the server. It works with a self-hosted server today
and with the hosted service once production opens.

The v0.8 desktop with its own local engine is not in this release. Its
workspaces move to a self-hosted server with `draft-loop server import`.

## Delivered scope

The release covers the 56 commits merged since v0.8.0-alpha.5:

- **Desktop client** ([milestone 65](https://github.com/akoita/draft-loop/milestone/65)):
  a server picker that offers "This computer" or an address, a page for an
  unreachable server, sign-in remembered on this computer (server 0.14.0 or
  later), outside links opened in the browser, and packaged acceptance against
  a scripted server.
- **Server on your own machine** (milestones 62 and 63): published server
  images, the `draft-loop-server` install, upgrade, backup and restore script,
  and the desktop import.
- **Work journal** (milestone 64): the `draftloop-mcp` agent channel that files
  notes from a coding agent into a pending inbox for approval.
- **Release sprint** (milestone 66): next steps printed by
  `draft-loop-server up`, the work journal in the record archive, and
  `server-v0.14.0` on staging.

## Deterministic and local release checks

The release-preparation PR,
[#2111](https://github.com/akoita/draft-loop/pull/2111), passed
`pnpm release:check` and all PR checks.

The first preflight, at `d7ddfba`, failed in packaged acceptance because a
running self-hosted stack held port 8080, the client's "This computer"
default ([#2112](https://github.com/akoita/draft-loop/issues/2112)). With the
stack stopped, the preflight passed at `d7ddfba`: `pnpm validate` ran 7,808
tests with 283 opt-in tests skipped.

The first publication then failed before creating a tag. GitHub refused the
generated notes as longer than 125,000 characters, because they reached back
across the `server-v*` tags.
[#2113](https://github.com/akoita/draft-loop/pull/2113) starts them at the
previous desktop release.

`pnpm release:preflight` passed again at the release revision `e35836a`:

- **Validation:** deterministic validation and 106 release and script tests
  passed.
- **Packaged acceptance:** all nine checks passed: the picker at first launch,
  plain HTTP refused away from this computer, the server opened, the desktop
  host, no Node.js in the page, the sign-in hook, outside links leaving the
  app, other schemes blocked, and the last server reopened after a relaunch.
- **Providers:** the client calls no provider (D9), so no live model run was
  needed.

## Published release

- **Tag:** the [release](https://github.com/akoita/draft-loop/releases/tag/v0.9.0)
  was published at `2026-11-04T01:53:23Z` as the prerelease **Desktop client
  alpha v0.9.0**. It points to exact source revision
  `e35836a0e55c5298125562cbc79945bd4f219f07`.
- **Workflows:** the [dry-run workflow](https://github.com/akoita/draft-loop/actions/runs/41755069341)
  passed source validation, all three platform builds and packaged acceptance
  on each. The
  [publication workflow](https://github.com/akoita/draft-loop/actions/runs/41756019341)
  completed successfully.
- **Assets:** the release attaches the following files:
  - Linux x64, macOS arm64 and Windows x64 ZIPs;
  - `release-manifest.json` and `SHA256SUMS`;
  - a CycloneDX SBOM with 1,231 components.

  The ZIP hashes match the published manifest and the checksum file. The
  manifest records aligned versions for all 29 packages.

| Asset                            | Bytes       | SHA-256                                                            |
| -------------------------------- | ----------- | ------------------------------------------------------------------ |
| `DraftLoop-win32-x64-0.9.0.zip`  | 157,901,720 | `c98bf26553eff87a4ca4884a304974b6c3d67747028202b73eb725e2425a85db` |
| `DraftLoop-darwin-arm64-0.9.0.zip` | 128,595,404 | `89d73fd7a8b6182b437f028002172142febefbf51dcde5831330128730ff21d7` |
| `DraftLoop-linux-x64-0.9.0.zip`  | 123,109,361 | `b4371dbaea965ce6d8b07bbf733eeb686f201e6d22b8e150252a7cd794f067e0` |

- **Provenance:** attestation was not requested.

## Limitations and next decision

- The packages are not signed and do not update themselves. The client offers
  the releases page when a newer version is published.
- There is no offline drafting: the client needs its server.
- Sign-in mode is proven only once the hosted identity provider runs; this
  release covers owner-token mode. The work journal's sign-in mode waits on
  [#2079](https://github.com/akoita/draft-loop/issues/2079).
- Packaged acceptance fails while a local stack holds port 8080
  ([#2112](https://github.com/akoita/draft-loop/issues/2112)).
- Representative consented CV quality remains unvalidated, and the #1309 exit
  is not met.

After this release the v0.8 desktop was retired from the repository
([milestone 67](https://github.com/akoita/draft-loop/milestone/67)).
