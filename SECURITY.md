# Security policy

Redakloop handles sensitive career history and may process confidential
employer information. The default design is local-first: source files,
evidence links, drafts, and run history should remain local unless the user
explicitly enables a provider and accepts its data policy.

Please do not report a vulnerability in a public issue. Until a dedicated
security contact is configured, contact the repository maintainers privately
with a clear description, affected files or versions, reproduction steps, and
any safe mitigation. Do not include real candidate data or credentials in a
report.

Contributors must avoid committing secrets, personal source documents, provider
responses containing sensitive data, or local database files. Security fixes
should include a regression test where practical and document any changed
retention or external-data behavior.

## What blocks a merge

Branch protection on `main` requires the `validate` check. These security
checks feed it:

| Check | Command | Fails when |
| --- | --- | --- |
| Secret scan | `pnpm security:secrets` | A tracked file holds a known key pattern or private key |
| License check | `pnpm security:licenses` | A direct dependency has a license outside the allow list |
| Dependency audit | `pnpm security:audit` | A production dependency has a high or critical advisory that `.audit-accept.json` does not accept |
| CodeQL | CI job `CodeQL` | An error-level or high-severity result in the code or the workflows |
| Workflow audit | CI job `Workflow audit` (zizmor) | A workflow has a medium or worse finding, such as template injection |
| Image scan | CI job `Image scan` (Trivy) | A server image has a high or critical vulnerability with a fix |

The image scan runs when a change reaches the server images, and keeps an
SPDX SBOM of each image as a workflow artifact. A finding it accepts for now is
listed in `.trivyignore.yaml` with a reason and an expiry date.

The dependency audit only warns on a high advisory in a development-only
dependency. It also warns when an accepted advisory no longer appears, so the
entry can go.

## Accept a dependency advisory for now

Accept an advisory only when no fixed version exists yet or the vulnerable code
path is not reachable, and track the fix in an issue. Add an entry to
`.audit-accept.json` at the repository root:

```json
[
  {
    "id": "GHSA-xxxx-xxxx-xxxx",
    "reason": "No fixed version yet; the parser never sees user input. Fix tracked in #1234.",
    "expires": "2026-12-31"
  }
]
```

- `id` is the advisory's GitHub id, as `pnpm security:audit` prints it.
- `reason` says why the risk is acceptable and where the fix is tracked.
- `expires` is at most 30 days away. After that date the audit fails again.

Run `pnpm security:audit` to check the entry. The image scan uses the same
rule through `.trivyignore.yaml`.

GitHub secret scanning with push protection also refuses known provider keys
before they reach the repository. Run `pnpm validate` to run the commands
locally; the CI jobs run only in CI.
