---
status: available
---

# Sensitivity and screening

Two controls decide what material a run may use. **Sensitivity rules** keep
chosen sections away from model providers. **Content screening** holds back
material that carries hidden instructions until a person releases it. This page
is for a candidate or owner using them, and a developer changing either.

## Where it runs

On every server: self-hosted, hosted and the desktop client over it. The hosted
service also runs a second screening model in shadow mode: it logs its verdict
for comparison and never blocks material.

## How to use it

**Private sections** (on Career evidence) mark Markdown sections by heading:

| Tier                          | Effect                                                    |
| ----------------------------- | --------------------------------------------------------- |
| `normal`                      | May be sent to the author and critic models.              |
| `sensitive` (only-if-allowed) | Stays out unless the workspace allows sensitive material. |
| `never-share` (never-send)    | Never reaches a model.                                    |

Each change saves a new version of the knowledge base's rule list and applies
from the next run. Imported pull requests start `sensitive`, one rule per
repository.

**Screening** checks every job source, knowledge source version and work
journal note. The screen shows each verdict and its signal codes, never a
quote. A flagged or unscreened source is quarantined, and a run that needs it
answers `409 material_quarantined`. An owner or admin releases one result with
a short reason that is not candidate material.

## How to test it

- Upload a fictional Markdown file with a heading, add a rule, and check the
  next run's material in the [local server stack](../operations/local-server-stack.md).
- Focused tests: `apps/api/src/sensitivity-rules-routes.test.ts`,
  `apps/api/src/content-screening-routes.test.ts` and
  `apps/web/src/screening.test.tsx`.

## Surfaces

| Kind   | Surface                                                          |
| ------ | ---------------------------------------------------------------- |
| Screen | Private sections panel, screening status in **Your files**       |
| API    | `GET`/`POST`/`DELETE /v1/knowledge-bases/{id}/sensitivity-rules` |
| API    | `GET /v1/workspaces/{id}/screening`                              |
| API    | `POST /v1/workspaces/{id}/screening/{resultId}/release`          |
| MCP    | none                                                             |

## Limits

- Rules match headings only, so text outside its own heading cannot be tiered
  on its own.
- A release covers one screening result; a newer result answers
  `409 result_superseded`.

## Related

- [Privacy and evaluation policy](../security/privacy-and-evaluation.md)
- [Server threat model](../security/server-threat-model.md)
