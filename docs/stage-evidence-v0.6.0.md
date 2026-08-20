# v0.6.0 alpha stage evidence

- **Status:** stage concluded at Integrated — validation failed; not released
- **Stage:** Integration hardening and outcome validation
- **Reviewed:** 2026-08-21
- **Release decision:** the `0.6.0` candidate is not being published. Package
  manifests reached `0.6.0` and an earlier release dry run passed from source
  commit `dd933cf81c4161191281108b6f44c3d8cec94f8f`, but the representative
  outcome did not meet the factual-completeness and application-readiness exit
  criterion. `release.json` now targets the v0.7 stage so the concluded v0.6
  candidate cannot be mistaken for an approved release.

This record is intentionally conservative. Automated and sanitized acceptance
results demonstrate implementation and integration. The consented
representative application required by roadmap issue 104 was run and produced
negative product evidence, so the stage is closed without a release rather
than relabeled as Validated.

## Evidence matrix

| Exit area | Evidence | Current status | Limitation |
| --- | --- | --- | --- |
| Shared local workflow | [Architecture and workflow contracts](architecture.md); repository `pnpm validate` | Integrated | The automated fixture is not a real candidate outcome |
| Installed desktop acceptance | [Installed-app protocol](installed-app-acceptance.md); [matrix run](https://github.com/akoita/draft-loop/actions/runs/31852393103) | Integrated with sanitized inputs; Linux x64, macOS arm64, and Windows x64 passed | Real candidate files and a real job URL have not been published as evidence |
| Credential lifecycle and preflight | [Credential protocol](credential-acceptance.md); [matrix run](https://github.com/akoita/draft-loop/actions/runs/31852393186) | Integrated automated lifecycle matrix passed on all three targets | Synthetic canaries do not prove every user environment or provider account |
| Provider failure recovery | [Recovery implementation PR](https://github.com/akoita/draft-loop/pull/110); repository recovery tests | Implemented and integrated | No live provider outage is claimed by this record |
| Consent and sanitized outcome reporting | [Pilot protocol](pilot-protocol.md); [outcome-reporting PR](https://github.com/akoita/draft-loop/pull/114); [issue 104](https://github.com/akoita/draft-loop/issues/104) | One private representative workflow reached approval and export; outcome failed the quality baseline | The result omitted required CV structure and chronology, changed a factual invariant, and introduced unsupported content; private inputs and outputs remain local |
| Release artifacts and manifest | [Release procedure](releasing.md); [dry run 31855377293](https://github.com/akoita/draft-loop/actions/runs/31855377293) | v0.6.0 candidate verified on Linux x64, macOS arm64, and Windows x64; publication cancelled | No v0.6.0 tag or GitHub release exists; the reviewed dry-run artifacts were unsigned alpha ZIPs, Windows remained 148.6 MiB, and provenance was intentionally disabled |

## Release-candidate review

The official `0.6.0` dry run completed successfully on 2026-08-15. It pinned
source commit `dd933cf81c4161191281108b6f44c3d8cec94f8f`, validated all 16
workspace package versions, built all three supported targets, and completed
the packaged Linux smoke test. The macOS and Windows jobs completed their
installed-app acceptance paths in the required-check matrix before the dry
run.

| Target | ZIP size | SHA-256 |
| --- | ---: | --- |
| Linux x64 | 130.8 MiB | `1a81934651e326d7c1b3849af510ecaa99449c4912cfd929684c79a17f91f6e4` |
| macOS arm64 | 125.1 MiB | `c005f6753ae78811387f2aecf794bd29d0083006f981da31982a4f892f8263ff` |
| Windows x64 | 148.6 MiB | `06ff39ef365c14599fe3d1dbc06f017053085b31c8f8f00d60806a0865ab72df` |

The downloaded ZIP digests match both `SHA256SUMS` and the release manifest.
The CycloneDX 1.7 SBOM contains 772 components and no local user paths. Archive
name and release-bundle scans found no candidate files, resume-like names,
credentials, `.draft-loop` directories, workspace databases, or run-history
files.

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

The stage exit criterion was not met. The maintainer therefore concluded v0.6
at **Integrated; validation failed**, cancelled publication of v0.6.0, and did
not run the paid release preflight or create a tag or GitHub release.

The negative evidence directly defines the v0.7 Application-grade CV workflow:
reusable candidate knowledge bases, a canonical career profile, a reviewed
opportunity brief, requirement-to-achievement planning, complete structured CV
composition under a customizable writing/template policy, independent critique
and author adjudication, recoverable stopping rules, professional rendering,
and parity evaluation against the private manual baseline. The v0.6 release
issue and outcome issue close as unsuccessful stage work, not as passed
acceptance.
