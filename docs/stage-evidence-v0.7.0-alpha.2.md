# v0.7.0-alpha.2 CKB storage-safety checkpoint

**Status:** Released checkpoint — v0.7 remains incomplete and unvalidated  
**Recorded:** 2026-08-25  
**Scope:** Completed [Sprint 2](https://github.com/akoita/draft-loop/milestone/5)
through issues #161–#165. Confirmed deletion #166 was deferred after the sprint
capacity audit.

## Release record

| Item | Verified reference |
| --- | --- |
| Release | [v0.7.0-alpha.2](https://github.com/akoita/draft-loop/releases/tag/v0.7.0-alpha.2) |
| Source commit | `e8bfdf619a455e15af2c49df59ff575180a3ca16` |
| Dry run | [32786983129](https://github.com/akoita/draft-loop/actions/runs/32786983129) |
| Publication | [32787238107](https://github.com/akoita/draft-loop/actions/runs/32787238107) |
| Sprint | [Milestone 5 — Sprint 2](https://github.com/akoita/draft-loop/milestone/5) |

## Evidence and boundary

- Store-wide leases fence concurrent writers, and owned-write recovery handles
  interruption without claiming legacy or unknown data.
- Six retention classes, expiry eligibility, and preservation overrides are
  explicit. The checkpoint does not physically delete data.
- Portable backup and collision-safe restore preserve logical identity and
  integrity without exporting machine-local origins or coordinator state.
- Release CI validated the pinned source and built Linux x64, macOS arm64, and
  Windows x64 packages. Linux also passed the packaged smoke test.
- This is storage-foundation evidence, not validation of a complete factual CV.

## Sanitized local preflight

The required local preflight passed on the release commit. The synthetic live
run used Anthropic `claude-haiku-4-5` as author and OpenAI
`gpt-5.3-codex-spark` as critic. Review, approval, and export passed with 1
source, 16 claims, 15 evidence-linked claims, 4 findings, 3 accepted findings,
9 events, artifact version 1, and reported cost of USD 0.

## Published targets

| Target | Bytes | SHA-256 |
| --- | ---: | --- |
| Linux x64 | 137297593 | `1530feadc83c3aa7587270c34e16280cb567fec68c769eac357366aaefa567ba` |
| macOS arm64 | 131504545 | `af2336ba58daea2095d806786dbccc4a5eac2f24d3fb0bc9411b3dc52bbbebee` |
| Windows x64 | 155929830 | `85bc03499fba9bf5f7c6f0329d95b973b78a35b73666a535ade4357141a0e26e` |

The release manifest and `SHA256SUMS` agree with the GitHub asset digests. A
CycloneDX SBOM is attached; provenance attestation was not requested.

## Remaining limitations

Confirmed CKB deletion, reviewed profile and opportunity, CKB-scoped retrieval,
requirement planning, complete-CV composition, writing policy, signing,
automatic updates, CLI packaging, and representative outcome validation remain
incomplete.
