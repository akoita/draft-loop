# v0.7.0-alpha.4 OpenAI session authentication checkpoint

**Status:** Released checkpoint — v0.7 remains incomplete and unvalidated  
**Recorded:** 2026-08-26  
**Scope:** This approved alpha checkpoint adds packaged-desktop OpenAI
authentication selection between an API key and an authenticated Codex/ChatGPT
session, independent per-provider persisted preferences, strict environment
precedence, restart-required/no-silent-fallback behavior, inherited Windows
user-session environment hardening, and Codex reasoning lifecycle compatibility
while continuing to reject tool events and ignore reasoning content. It is not a
v0.7 stage exit.

## Release record

| Item              | Verified reference                                                                 |
| ----------------- | ---------------------------------------------------------------------------------- |
| Release           | [v0.7.0-alpha.4](https://github.com/akoita/draft-loop/releases/tag/v0.7.0-alpha.4) |
| Feature PR        | [#199](https://github.com/akoita/draft-loop/pull/199)                              |
| Release prep      | [#200](https://github.com/akoita/draft-loop/pull/200)                              |
| Source/tag commit | `d4b7840e7c763877ba3c2e53635a2a0936be1533`                                         |
| Dry run           | [32993669592](https://github.com/akoita/draft-loop/actions/runs/32993669592)       |
| Publication       | [32994139494](https://github.com/akoita/draft-loop/actions/runs/32994139494)       |
| Stage issue       | [#69](https://github.com/akoita/draft-loop/issues/69)                              |

## Evidence and boundary

- Packaged desktop OpenAI authentication supports explicit API-key or
  authenticated Codex/ChatGPT session selection, independent persisted
  preferences for each provider, strict environment precedence, and
  restart-required behavior without silent fallback.
- Codex reasoning lifecycle compatibility is preserved while tool events remain
  rejected and reasoning content remains ignored. Windows user-session
  environment hardening from alpha.3 is retained.
- Release packaging supplied macOS arm64, Linux x64, and Windows x64 artifacts.
  Packaged checks are implementation and integration evidence, not
  representative validation of the v0.7 drafting outcome.

## Sanitized local preflight

The required local preflight passed on the exact release commit. Deterministic
validation passed with 970 application tests plus 52 release/security tests.
The mixed live synthetic route used Anthropic API-key authentication with
`claude-haiku-4-5` as author and OpenAI user-session authentication with
`gpt-5.3-codex-spark` as critic. All lifecycle checks were true. Review
completed with 1 evidence source, 11 claims (10 linked), 2 findings (1
accepted), 7 events, artifact version 1, reported cost of USD 0, and elapsed
time of 18,279 ms.

## Published targets

| Target      |     Bytes | SHA-256                                                            |
| ----------- | --------: | ------------------------------------------------------------------ |
| macOS arm64 | 131525158 | `cd7517bbecac55813a61ab5282072d37325141062a923938366a30a975487b76` |
| Linux x64   | 137318202 | `44c00f08b33b804210232a60e51bf47a3f527a31582bfe4ce69a60d3b5426f1a` |
| Windows x64 | 155950443 | `b996a30e378c4e1f50d8de2e8c7b74c08e091ad291bca131e738453aca09a14f` |

The release manifest, `SHA256SUMS`, and GitHub asset digests agree. A
CycloneDX 1.7 SBOM is attached with 772 components; provenance attestation was
not requested.

## Remaining limitations

Profile, opportunity, CKB retrieval/reactivation, planning, complete-CV
composition, writing policy, runtime review/readiness/rendering integration,
and representative validation remain incomplete. Signing, automatic updates,
and CLI packaging remain incomplete; the CLI remains source-distributed. The
v0.7 stage remains incomplete and unvalidated.
