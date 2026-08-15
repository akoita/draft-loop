# v0.6.0 alpha stage evidence

- **Status:** release candidate verified — publication blocked
- **Stage:** Integration hardening and outcome validation
- **Reviewed:** 2026-08-15
- **Release metadata:** `release.json` is aligned to the stage and `alpha`
  channel. Package manifests are aligned to `0.6.0`, and the release dry run
  passed from source commit `dd933cf81c4161191281108b6f44c3d8cec94f8f`;
  publication remains blocked until the real-application outcome gate is
  complete.

This record is intentionally conservative. Automated and sanitized acceptance
results demonstrate implementation and integration; they do not substitute for
the consented representative application required by roadmap issue 104.

## Evidence matrix

| Exit area | Evidence | Current status | Limitation |
| --- | --- | --- | --- |
| Shared local workflow | [Architecture and workflow contracts](architecture.md); repository `pnpm validate` | Integrated | The automated fixture is not a real candidate outcome |
| Installed desktop acceptance | [Installed-app protocol](installed-app-acceptance.md); [matrix run](https://github.com/akoita/draft-loop/actions/runs/31852393103) | Integrated with sanitized inputs; Linux x64, macOS arm64, and Windows x64 passed | Real candidate files and a real job URL have not been published as evidence |
| Credential lifecycle and preflight | [Credential protocol](credential-acceptance.md); [matrix run](https://github.com/akoita/draft-loop/actions/runs/31852393186) | Integrated automated lifecycle matrix passed on all three targets | Synthetic canaries do not prove every user environment or provider account |
| Provider failure recovery | [Recovery implementation PR](https://github.com/akoita/draft-loop/pull/110); repository recovery tests | Implemented and integrated | No live provider outage is claimed by this record |
| Consent and sanitized outcome reporting | [Pilot protocol](pilot-protocol.md); [outcome-reporting PR](https://github.com/akoita/draft-loop/pull/114) | Reporting path implemented | No real consented application has been recorded yet; [issue 104](https://github.com/akoita/draft-loop/issues/104) remains open |
| Release artifacts and manifest | [Release procedure](releasing.md); [release contract](../release.json); [dry run 31855377293](https://github.com/akoita/draft-loop/actions/runs/31855377293) | v0.6.0 candidate verified on Linux x64, macOS arm64, and Windows x64 | Artifacts are unsigned alpha ZIPs; the Windows archive remains 148.6 MiB, and provenance was intentionally disabled for the dry run |

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

## Product measures

No real-application measures are claimed in this public record. The private
pilot record must provide, at minimum:

- first-draft, revised-draft, and manual-baseline comparison where available;
- factuality regression, critical-requirement coverage, and unsupported-claim
  counts;
- useful versus rejected findings, review minutes, and manual edits;
- author–critic rounds, provider cost, approval/export completion, and user
  confidence; and
- misleading-evidence and prompt-injection observations plus limitations.

The [consented outcome pilot protocol](pilot-protocol.md) defines the private
record and the content-free report boundary. Candidate files, workspace
databases, prompts, responses, credentials, exports, and employer-confidential
terms must not be added to this repository or CI artifacts.

## Open gate and next decision

The release gate is blocked only by the missing private representative outcome
in [issue 104](https://github.com/akoita/draft-loop/issues/104):

1. Run one representative application locally under the consent and provider
   preflight rules in issue 104.
2. Complete approval and local export, then generate the sanitized outcome
   summary.
3. Review the factuality, coverage, effort, cost, confidence, and limitation
   results without generalizing beyond the sample.
4. Publish only after the stage exit criterion is met and explicit maintainer
   approval is confirmed.

Until then, the roadmap stage remains **Integrated; validation incomplete** and
the repository must not claim a v0.6.0 release.
