# v0.7.0-alpha.3 drafting and review foundations checkpoint

**Status:** Released checkpoint — v0.7 remains incomplete and unvalidated  
**Recorded:** 2026-08-26  
**Scope:** This approved alpha checkpoint freezes the post-alpha.2
confirmed-deletion slice, provider-independent readiness/adjudication/stopping/layout
foundations, the first dormant runtime carrier, and Windows user-session
environment hardening. It is not a v0.7 stage exit.

## Release record

| Item          | Verified reference                                                                 |
| ------------- | ---------------------------------------------------------------------------------- |
| Release       | [v0.7.0-alpha.3](https://github.com/akoita/draft-loop/releases/tag/v0.7.0-alpha.3) |
| Release prep  | [#197](https://github.com/akoita/draft-loop/pull/197)                              |
| Source commit | `0102d100c3036e6ff8777927c9e1342169054933`                                         |
| Dry run       | [32973799032](https://github.com/akoita/draft-loop/actions/runs/32973799032)       |
| Publication   | [32974219593](https://github.com/akoita/draft-loop/actions/runs/32974219593)       |
| Stage issue   | [#69](https://github.com/akoita/draft-loop/issues/69)                              |

## Evidence and boundary

- Confirmed CKB deletion uses an exact fresh-plan token under the store-wide
  lease. Verified managed data is staged and recoverable, blockers fail closed,
  and unknown or unowned entries are preserved.
- The readiness, adjudication/trace, stopping-decision, and controlled-layout/
  rendering-QA components are strict provider-independent foundations. Runtime,
  provider, and UI integration remain outside this checkpoint.
- The first dormant runtime carrier keeps the exact report, canonical plan,
  accepted-effect overrides, and derived trace across restart, and delivers the
  pending carrier only to the matching revision author.
- Windows user-session environment hardening is included in this checkpoint.
- Release publication supplied Linux x64, macOS arm64, and Windows x64
  artifacts. This is checkpoint implementation evidence, not validation of a
  complete factual CV or the v0.7 outcome.

## Sanitized local preflight

The required local preflight passed on the release commit. The synthetic live
run used Anthropic `claude-haiku-4-5` as author and OpenAI
`gpt-5.3-codex-spark` as critic. Review completed, approval and export passed,
with 1 source, 4 claims all evidence-linked, 3 findings all accepted, 8
events, artifact version 1, reported cost of USD 0, and elapsed time of
17,304 ms.

## Published targets

| Target      |     Bytes | SHA-256                                                            |
| ----------- | --------: | ------------------------------------------------------------------ |
| macOS arm64 | 131523048 | `8ecdf89617e68282c57494fe5fed1fb3dae6f18f6e95de33ac12c076e3f61563` |
| Linux x64   | 137316096 | `8b383b012ae4edde8449ae837a82c3e962f92b2080f23d4e3f0825d4ba0de99a` |
| Windows x64 | 155948373 | `84b8cb864e89c2cca532e6af1b02e59dfd45858889f5698e04c0967b38095a2d` |

The release manifest, `SHA256SUMS`, and GitHub asset digests agree. A
CycloneDX 1.7 SBOM is attached with 772 components; provenance attestation was
not requested.

## Remaining limitations

CKB roll-up/product reactivation-retrieval, reviewed profile, opportunity,
retrieval, planning, complete-CV composition, writing policy, runtime
review/readiness/rendering integration, signing, automatic updates, and
representative outcome validation remain incomplete. The CLI remains
source-distributed. The v0.7 stage remains incomplete and unvalidated.
