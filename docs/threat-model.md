# Threat model

This document is the security baseline for the current DraftLoop MVP. It is a
repository-grounded model, not a claim that the product is safe for every
deployment.

## Scope and assumptions

The current product is a local, single-user CLI and desktop workspace. There is
no internet-facing DraftLoop service, account system, multi-tenant database, or
background job runner in this repository. Provider SDK calls are the only
planned network boundary. Credentials are expected to be supplied to the
process by the provider SDK environment and are not persisted by DraftLoop.

The workspace may contain personal career history and confidential employer
material. Local files, model output, Markdown, HTML, and PDF content are
untrusted input. The model is an untrusted participant: it can be wrong, and a
source document can contain indirect instructions intended to manipulate an
agent.

Future cloud sync, authentication, multi-tenancy, vector search, or external
job submission require a new threat-model review. They are not covered by the
controls below.

## Assets and trust boundaries

| Boundary | Asset at risk | Current control | Residual concern |
| --- | --- | --- | --- |
| User-selected files to ingestion | Career history and employer material | Local file selection, checksums, source locators, and normalized evidence | Ingested text is still untrusted and can contain prompt injection |
| Application to model provider | Candidate source, context, prompts, and draft content | Explicit transmission policy, provider allowlist, and sensitive-data acknowledgement in `packages/providers/src/index.ts:120-147` | A user can explicitly approve exposure; provider retention must be confirmed per provider |
| Application to local history | Run metadata, findings, decisions, and artifacts | SQLite local persistence with payload field checks in `packages/storage/src/index.ts:639-665` | Host compromise, backups, and future fields can bypass an incomplete allowlist |
| Approved artifact to renderer/export | Links, HTML/Markdown, and generated files | Rendering is local and export has an approval boundary | Unsafe links, images, or markup could create egress or content-spoofing risks |
| Source repository and CI | Credentials, fixtures, dependencies, and build output | Secret-free fixture policy, lockfile, lint/type/test gates | A compromised dependency or CI credential can alter releases |

The key flow is:

```text
local files -> ingestion/evidence -> bounded context -> approved provider call
     |                                  |
     +-> local storage <- structured run history <- evaluation/validation
                                                   |
                                             human approval -> local export
```

## Ranked abuse paths

| ID | Severity / confidence | Abuse path | Existing mitigations | Required follow-up |
| --- | --- | --- | --- | --- |
| T-001 | High / high | A malicious or misleading local document inserts instructions that an author or critic follows, causing unsupported claims or disclosure in a provider request. | Source/evidence boundaries, structured model ports, deterministic validation, no uncontrolled web research or agent tools. | Delimit source content as data, keep tools disabled by default, require structured outputs, and add adversarial prompt-injection fixtures before enabling autonomous tools. |
| T-002 | High / high | Sensitive candidate or employer material is sent to an unapproved provider or without explicit acknowledgement. | `ModelRequest` carries a data policy in `packages/providers/src/index.ts:31-39`; transmission, company allowlist, and acknowledgement are enforced at `:120-147`. | Add a user-facing preflight showing classification, provider, model, and retention before every first transmission. Verify provider retention semantics instead of treating `ephemeral-request` as proof. |
| T-003 | High / medium | Raw prompts, responses, source text, or credentials leak through logs, audit records, persistence, or test output. | Provider errors are normalized without response bodies in `packages/providers/src/index.ts:172-224`; storage rejects sensitive and hidden-content field names in `packages/storage/src/index.ts:639-665`; `@draft-loop/security` provides an allowlisted operational event shape. | Route operational logging through the allowlist, redact user-configured confidential terms, and add a CI fixture scan for secrets and raw-content keys. |
| T-004 | High / medium | A credential is exposed through configuration, an exception, a test fixture, or a build log. | Credentials are not part of provider request contracts or persisted records; repository security policy forbids committed secrets. | Keep credentials environment/SDK-scoped, never include request bodies in errors, scan commits and CI output, and rotate immediately after suspected exposure. |
| T-005 | High / medium | A generated link, image, HTML fragment, or export causes a network fetch or impersonates trusted content. | Rendering and export are local contracts; external submission and uncontrolled research are outside the MVP. | Sanitize or proxy links/images, disable active content, and show the exact output path and approval status before export. |
| T-006 | Medium / high | A provider, critic, or malformed response drives an unbounded loop or cost spike. | Orchestrator round, cost, and duration budgets are checked in `packages/orchestrator/src/index.ts:550-563`; normalized provider errors classify retryability. | Enforce budgets at every provider boundary, cap retries, and keep deterministic cost-budget regression tests in CI. |
| T-007 | Medium / medium | Another process or a backup reads the local workspace or SQLite history. | Local-first storage and explicit retention language; no server-side copy is required by the MVP. | Document filesystem permissions and backup responsibility; consider optional OS-backed encryption before shared-device or cloud-sync support. |
| T-008 | Medium / medium | A future retrieval index mixes workspaces or retains source chunks after deletion. | No vector database or RAG service is implemented in the current repository. | Any future index must be workspace-scoped, derive from the same retention policy, support deletion, and never cross an authorization boundary. |

## Runtime and build-time controls

Runtime controls are deny-by-default provider egress, explicit data policy,
provider diversity visibility, bounded rounds/cost/time, structured outputs,
source references, human approval, local retention, and content-free
operational events. These controls reduce impact but do not make model output
authoritative.

Build-time controls are strict TypeScript, schema validation, linting,
deterministic tests, lockfile review, secret-free synthetic fixtures, and
security regression tests. CI must fail when a redaction/storage invariant or
evaluation quality gate fails.

## Open risks and review triggers

The following are intentionally open until the product needs them:

- provider-specific retention and training settings need verification in the
  user-facing policy flow;
- signed desktop updates, installer permissions, and production packaging need
  a separate deployment review;
- cloud sync, accounts, multi-tenancy, RAG/vector storage, browser access,
  tools, and job submission each add trust boundaries and require a new review;
- user-defined redaction rules can remove useful context, so redaction results
  must be visible before a provider call;
- no security control can detect every unsupported claim; evidence and human
  approval remain product requirements.

See [privacy and evaluation](privacy-and-evaluation.md) for the retention,
redaction, logging, and quality-regression policy that implements this model.
