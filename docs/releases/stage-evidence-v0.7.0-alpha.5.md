# v0.7.0-alpha.5 Codex planning-event compatibility checkpoint

**Status:** Released checkpoint — v0.7 remains incomplete and unvalidated  
**Recorded:** 2026-08-26  
**Scope:** This approved alpha checkpoint carries forward alpha.4's
packaged-desktop OpenAI authentication selection and fixes Windows/session
critic compatibility by accepting and discarding passive Codex `todo_list` and
`item.updated` lifecycle output while commands, mutations, search, tool, error,
and unknown event/item types remain fail-closed. It is not a v0.7 stage exit.

## Release record

| Item              | Verified reference                                                                 |
| ----------------- | ---------------------------------------------------------------------------------- |
| Release           | [v0.7.0-alpha.5](https://github.com/akoita/draft-loop/releases/tag/v0.7.0-alpha.5) |
| Feature PR        | [#202](https://github.com/akoita/draft-loop/pull/202)                              |
| Release prep      | [#203](https://github.com/akoita/draft-loop/pull/203)                              |
| Source/tag commit | `7afee4c5c993548dd1aa44cf87e117211f61fa39`                                         |
| Dry run           | [33002936437](https://github.com/akoita/draft-loop/actions/runs/33002936437)       |
| Publication       | [33003666038](https://github.com/akoita/draft-loop/actions/runs/33003666038)       |
| Stage issue       | [#69](https://github.com/akoita/draft-loop/issues/69)                              |

## Evidence and boundary

- Packaged desktop OpenAI authentication carries forward explicit API-key or
  authenticated Codex/ChatGPT session selection, independent persisted
  preferences for each provider, strict environment precedence, and
  restart-required behavior without silent fallback.
- Codex passive planning lifecycle output is accepted for `item.updated` and
  `todo_list` items, then discarded without projecting planning content. Tool,
  mutation, search, error, and unknown event/item types remain fail-closed.
- Release packaging supplied macOS arm64, Linux x64, and Windows x64 artifacts.
  Packaged checks provide implementation and integration evidence only; they
  are not representative validation of the v0.7 drafting outcome.

## Sanitized local preflight

The required local preflight passed on the exact release commit. Deterministic
validation passed with 971 application tests plus 52 release/security tests.
The mixed live synthetic route used Anthropic API-key authentication with
`claude-haiku-4-5` as author and OpenAI user-session authentication with
`gpt-5.3-codex-spark` as critic. All lifecycle checks were true. Review
completed with 1 evidence source, 10 claims (9 linked), 3 findings (2
accepted), 8 events, artifact version 1, reported cost of USD 0, and elapsed
time of 17,524 ms.

## Published targets

| Target      |     Bytes | SHA-256                                                            |
| ----------- | --------: | ------------------------------------------------------------------ |
| macOS arm64 | 131525171 | `6dba3713f189f9a8669024aed30a0a2fd70a02bc3c224930aa17926f24cf0f81` |
| Linux x64   | 137318220 | `73e1812dafbd1720aca515be6ac0605c8e4a38c26f578f79c6be2bde0e2265a1` |
| Windows x64 | 155950465 | `1b9f521c3ab54c2e3dad88cde2c91df7fc6f785b7204b6cd302c583a913014f3` |

The release manifest, `SHA256SUMS`, and GitHub asset digests agree. A
CycloneDX 1.7 SBOM is attached with 772 components; provenance attestation was
not requested.

## Remaining limitations

Profile, opportunity, CKB retrieval/reactivation, planning, complete-CV
composition, writing policy, runtime review/readiness/rendering integration,
and representative validation remain incomplete. Signing, automatic updates,
and CLI packaging remain incomplete; the CLI remains source-distributed. The
v0.7 stage remains incomplete and unvalidated.
