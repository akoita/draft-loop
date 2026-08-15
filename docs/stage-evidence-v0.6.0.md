# v0.6.0 alpha stage evidence

**Status:** working record — not ready for publication  
**Stage:** Integration hardening and outcome validation  
**Reviewed:** 2026-08-15  
**Release metadata:** `release.json` is aligned to the stage and `alpha`
channel. Package version remains `0.5.2` until the release gate is complete.

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
| Release artifacts and manifest | [Release procedure](releasing.md); [release contract](../release.json) | Not prepared for v0.6.0 | Version bump, dry-run manifest, platform artifacts, checksums, SBOM, and size review await the outcome gate |

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
4. If the stage exit criterion is met, make a separate focused version-bump PR
   for `0.6.0`, run the release dry run, inspect all artifacts, and update this
   record with links to the manifest, checksums, SBOM, and known limitations.

Until then, the roadmap stage remains **Integrated; validation incomplete** and
the repository must not claim a v0.6.0 release.
