# v0.6.0 alpha stage evidence

- **Status:** Released — validation failed
- **Stage:** Integration hardening and outcome validation
- **Reviewed:** 2026-08-21
- **Release:** [v0.6.0 integrated alpha](https://github.com/akoita/draft-loop/releases/tag/v0.6.0),
  published from source commit `631e5e02689fee01e4d887161c986c661f4c3ca1`
  by [workflow run 32435727961](https://github.com/akoita/draft-loop/actions/runs/32435727961).
  The representative outcome did not meet the factual-completeness and
  application-readiness exit criterion, and that failure is a prominent
  release limitation rather than passed acceptance.

This record is intentionally conservative. Automated and sanitized acceptance
results demonstrate implementation and integration. The consented
representative application required by roadmap issue 104 was run and produced
negative product evidence. Publishing an integrated alpha preserves a
reproducible baseline for v0.7; it does not relabel the stage as Validated.

## Evidence matrix

| Exit area | Evidence | Current status | Limitation |
| --- | --- | --- | --- |
| Shared local workflow | [Architecture and workflow contracts](architecture.md); repository `pnpm validate` | Integrated | The automated fixture is not a real candidate outcome |
| Installed desktop acceptance | [Installed-app protocol](installed-app-acceptance.md); [matrix run](https://github.com/akoita/draft-loop/actions/runs/31852393103) | Integrated with sanitized inputs; Linux x64, macOS arm64, and Windows x64 passed | Real candidate files and a real job URL have not been published as evidence |
| Credential lifecycle and preflight | [Credential protocol](credential-acceptance.md); [matrix run](https://github.com/akoita/draft-loop/actions/runs/31852393186) | Integrated automated lifecycle matrix passed on all three targets | Synthetic canaries do not prove every user environment or provider account |
| Provider failure recovery | [Recovery implementation PR](https://github.com/akoita/draft-loop/pull/110); repository recovery tests | Implemented and integrated | No live provider outage is claimed by this record |
| Consent and sanitized outcome reporting | [Pilot protocol](pilot-protocol.md); [outcome-reporting PR](https://github.com/akoita/draft-loop/pull/114); [issue 104](https://github.com/akoita/draft-loop/issues/104) | One private representative workflow reached approval and export; outcome failed the quality baseline | The result omitted required CV structure and chronology, changed a factual invariant, and introduced unsupported content; private inputs and outputs remain local |
| Release artifacts and manifest | [Release procedure](releasing.md); [release v0.6.0](https://github.com/akoita/draft-loop/releases/tag/v0.6.0); [publication run 32435727961](https://github.com/akoita/draft-loop/actions/runs/32435727961) | Released on Linux x64, macOS arm64, and Windows x64 with manifest, checksums, and CycloneDX SBOM | Artifacts are unsigned alpha ZIPs; Windows remains 148.6 MiB, and provenance was not requested because repository-plan support was not established |

## Release-candidate review

The mandatory local release preflight passed from the exact release revision on
2026-08-21. It ran deterministic validation before the paid synthetic live
provider gate, then completed a cross-company Anthropic/OpenAI workflow through
independent critique, decisions, approval, and Markdown export with 11 of 11
claims linked to synthetic evidence.

The official `0.6.0` [dry run](https://github.com/akoita/draft-loop/actions/runs/32435190544)
and publication run both pinned source commit
`631e5e02689fee01e4d887161c986c661f4c3ca1`, validated all 16 workspace package
versions, built all three supported targets, and completed the packaged Linux
smoke test. The published manifest and `SHA256SUMS` agree with GitHub's asset
digests.

| Target | ZIP size | SHA-256 |
| --- | ---: | --- |
| Linux x64 | 130.9 MiB | `c578405ca2bce1298834c5b61c370cd3df6318a11d63f8086175e1082223a3b1` |
| macOS arm64 | 125.3 MiB | `81f233bf1c1c6f5fb7d67833aad2a314419b5cf8754e45d6af3952ff1d9bdaa3` |
| Windows x64 | 148.6 MiB | `8178186d6de37452cb1e1244aacf715bc4ba5ae0fe469d2bfb2ecd726f64fd3e` |

The published ZIP digests match both `SHA256SUMS` and the release manifest. The
CycloneDX 1.7 SBOM contains 772 components and no local candidate or maintainer
paths. Archive-name and release-bundle scans found no candidate files,
resume-like names, credentials, `.draft-loop` directories, workspace databases,
or run-history files.

Package-size diagnostics show that the embedded Electron runtime and platform
executable dominate each archive. On Windows, the executable alone stores
92.5 MiB of the 148.6 MiB ZIP. Payload reduction and installer work therefore
remain known packaging improvements; they are not evidence failures for this
unsigned alpha candidate.

## Representative outcome

One private consented application exercised the live Anthropic–OpenAI workflow,
three author–critic rounds, human finding decisions, approval, and Markdown
export. Provider cost was unavailable because a subscription-backed session was
part of the mixed authentication route and the run did not yield a complete,
comparable cost. Review time, manual-edit count, confidence, and adversarial
observations were not captured consistently enough to publish as measures.

Comparison with the candidate's private manual baseline found that the
generated artifact was not application-ready. It omitted major CV sections and
career chronology, altered seniority, introduced unsupported quantification,
and flattened distinct employers, roles, projects, credentials, education, and
languages into an incomplete structure. A later run also demonstrated that an
accepted blocking finding can require revision after the configured round cap,
leaving approval correctly blocked but without an available revision action.

These are bounded observations from one case, not claims about provider quality
in general. Candidate files, workspace databases, prompts, responses,
credentials, exports, employer details, and the manual baseline remain outside
the repository and CI artifacts under the [pilot protocol](pilot-protocol.md).

## Final decision and carry-forward

The validation exit criterion was not met. The maintainer published v0.6.0 as a
**Released; validation failed** alpha baseline after the mandatory local
preflight and release evidence passed. The release preserves an integrated,
reproducible baseline; it does not claim application readiness.

The negative evidence directly defines the application-grade corrective
program: reusable candidate knowledge bases, a canonical career profile, a
reviewed opportunity brief, requirement-to-achievement planning, complete
structured CV composition under a customizable writing/template policy,
independent critique and author adjudication, recoverable stopping rules,
professional rendering, and parity evaluation against the private manual
baseline. The v0.6 outcome issue remains a failed observation, not passed
acceptance. The verified release closes v0.6; the corrective work is now
sequenced through v0.7 evidence-backed drafting, v0.8 independent review and
readiness, and v0.9 workflow parity and release.
