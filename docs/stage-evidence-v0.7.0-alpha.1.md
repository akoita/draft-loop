# v0.7.0-alpha.1 CKB foundation checkpoint

**Status:** Released checkpoint — v0.7 stage incomplete and unvalidated  
**Recorded:** 2026-08-24  
**Scope:** Completed GitHub milestone 2 (Sprint 1 — CKB foundation), rolled up
under issue [#112](https://github.com/akoita/draft-loop/issues/112). Sprint 2
([milestone 5](https://github.com/akoita/draft-loop/milestone/5)) is planned but
not started.

## Release record

| Item | Verified reference |
| --- | --- |
| Release | [v0.7.0-alpha.1](https://github.com/akoita/draft-loop/releases/tag/v0.7.0-alpha.1) |
| Source commit | `c14899a3287b62a364ba74ef684aaebe9a0ac991` |
| Dry-run workflow | [32717305101](https://github.com/akoita/draft-loop/actions/runs/32717305101) |
| Publication workflow | [32718064869](https://github.com/akoita/draft-loop/actions/runs/32718064869) |
| Sprint | [Milestone 2 — Sprint 1](https://github.com/akoita/draft-loop/milestone/2) |
| Roll-up issue | [#112](https://github.com/akoita/draft-loop/issues/112) |

## Evidence matrix

The levels below describe what this checkpoint demonstrates. They do not
advance the v0.7 stage to Validated.

| Area | Evidence | Level | Boundary |
| --- | --- | --- | --- |
| CKB lifecycle and selection | Local storage and shared application contracts cover CKB identity, source/version provenance, explicit selection, lifecycle controls, and path-free renderer results. | Integrated | Does not demonstrate a complete application-grade drafting outcome. |
| Shared CLI/desktop controls | CLI and packaged Electron expose bounded file, URL, and directory intake plus refresh, rebind, reconciliation, move, and logical-retirement controls while sensitive origins stay local. | Integrated | Controls are integrated; representative user outcome remains unvalidated. |
| Legacy migration semantics | The #160 migration slice preserves explicit CKB/run selection semantics with deterministic checks. | Implemented | This is a completed Sprint 1 capability, not stage-exit validation. |
| Local live preflight | The required deterministic and synthetic live-provider gates passed with the sanitized facts below. | Integrated | Synthetic evidence does not validate representative outcome quality. |
| Cross-platform CI and package builds | [PR #170](https://github.com/akoita/draft-loop/pull/170) covered installed-app and credential matrices. The release workflow built Linux, macOS, and Windows targets and smoke-tested Linux. | Released | The release workflow alone is not installed-app validation for every platform. |
| Release bundle verification | Manifest, `SHA256SUMS`, and GitHub asset digests agree; the CycloneDX 1.7 SBOM contains 772 components. Provenance was not requested. | Released | Publication evidence does not imply product validation. |

## Sanitized local preflight

The deterministic suite passed. The synthetic live run used an Anthropic
API-key author (`claude-haiku-4-5`) and an OpenAI user-session critic
(`gpt-5.3-codex-spark`). Review, approval, and export passed with 1 source, 10
claims, 9 evidence-linked claims, 2 accepted findings, 7 events, artifact
version 1, and reported cost of USD 0. No real candidate data was used.

## Published targets

| Target | Bytes | SHA-256 |
| --- | ---: | --- |
| Linux x64 | 137274859 | `2f5492bf038abf64ebcb7122936630c94b58fc96ce07b61fabfe7931ed96468b` |
| macOS arm64 | 131481810 | `d9ed19bc5d48610687527b4bf6108a6b5e0574763137d86d6015a0d3988acba8` |
| Windows x64 | 155907198 | `9fb364187502984b09d5cc9ac36927ee132c435ca7b5dd26ed34a6568813ebcf` |

## Remaining limitations

Profile, opportunity, CKB-scoped retrieval and index versioning, requirement
planning, complete-CV composition, writing policy, storage safety, signing,
automatic updates, CLI packaging, and representative outcome validation remain
incomplete. Sprint 2 is planned but not started. This checkpoint records the
released CKB foundation only; it is not a v0.7 stage exit or a claim of
application readiness.
