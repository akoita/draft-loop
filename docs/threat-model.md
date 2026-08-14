# Threat model

This document is the security baseline for the current DraftLoop alpha. It is a
repository-grounded model, not a claim that the product is safe for every
deployment. The current roadmap stage is integration hardening and outcome
validation.

## Scope and assumptions

The current product is a local, single-user CLI and Electron desktop workspace.
There is no internet-facing DraftLoop service, account system, multi-tenant
database, or background job runner in this repository.

The implemented network boundaries are:

- explicitly approved Anthropic and OpenAI provider requests;
- user-approved HTTPS URL ingestion with bounded redirects and responses; and
- an optional OpenAI-compatible local endpoint adapter, whose endpoint and
  operator remain part of the user's trust decision.

Provider credentials may come from SDK environment variables or may be entered
in the desktop renderer and sent through the allowlisted native bridge command.
The Electron main process owns credential persistence. It uses operating-system
`safeStorage` when available and otherwise falls back to a local AES-256-GCM key
and ciphertext protected by local file permissions. That fallback protects
against casual plaintext disclosure, but it is not equivalent to an OS-backed
secret store when an attacker can read both files or control the user account.

The workspace may contain personal career history and confidential employer
material. Local files, fetched pages, model output, Markdown, HTML, PDF, backup
files, diagnostic exports, and retrieval indexes are untrusted or sensitive
data. Models are untrusted participants: they can be wrong, and any source can
contain indirect instructions intended to manipulate an agent.

Future cloud sync, authentication, multi-tenancy, remote retrieval, browser
extensions, autonomous tools, or external job submission require a new
threat-model review. They are not covered by the controls below.

## Assets and trust boundaries

| Boundary                                          | Asset at risk                                                           | Current control                                                                                                                                                                                                                    | Residual concern                                                                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| User-selected files to ingestion                  | Career history and employer material                                    | Explicit file selection, supported-type checks, checksums, source locators, and normalized evidence                                                                                                                                | Parsed content remains untrusted and can contain prompt injection or parser edge cases                                     |
| Desktop renderer to preload/main                  | Credentials, workspace commands, and approval intent                    | Context isolation, sandboxing, one frozen IPC channel, allowlisted commands, and `validateBridgeCommand` in `apps/desktop/src/bridge.ts`                                                                                           | A compromised renderer can still submit any allowed command and can observe a key while the user types it                  |
| Main process to credential store                  | Provider API keys                                                       | `createSafeStorageCredentialStore` in `apps/desktop/src/electron/host.ts`, OS `safeStorage` when available, restricted local files, status/removal commands                                                                        | Local fallback key and ciphertext share the user security boundary; host compromise exposes decrypted keys                 |
| Application to model provider                     | Candidate sources, context, prompts, and drafts                         | Fingerprinted desktop preflight, workspace-local safe acknowledgement metadata, fresh host-side verification before transmitting actions, `DataExposurePolicy`, provider/model/endpoint identity, bounded context, and run budgets | The flow is not yet cross-platform validated; provider retention and training behavior remain external facts               |
| Application to approved URL                       | Source URL, local network reachability, fetched content, and provenance | `ingestUrl` in `packages/ingestion/src/index.ts` requires approval, HTTPS, safe host resolution, manual redirect validation, time/size limits, and supported content types                                                         | DNS rebinding, resolver/fetch races, remote tracking, malicious HTML, and future parser expansion require continuing tests |
| Application to local endpoint                     | Candidate data, credentials, and model output                           | Adapter contract, structured output validation, and explicit configuration                                                                                                                                                         | “Local” does not prove same-machine operation, privacy, identity, or trustworthy retention                                 |
| Application to local history and retrieval        | Run metadata, evidence chunks, findings, decisions, and artifacts       | SQLite persistence, workspace identifiers, checksums, immutable records, FTS scoping, and `assertSafePayload` in `packages/storage/src/index.ts`                                                                                   | Host compromise, incomplete field checks, deletion bugs, or query mistakes can expose or mix workspace data                |
| Backup, restore, retention purge, and diagnostics | Copies of workspace data and operational metadata                       | Explicit local operations, integrity checks, confirmed purge, and content-free diagnostic design                                                                                                                                   | Backups can outlive workspace deletion; destination permissions and restore overwrite behavior need platform acceptance    |
| Approved artifact to renderer/export              | Links, HTML/Markdown, and generated files                               | Local rendering, controlled formats, checksum records, and an approval boundary                                                                                                                                                    | Unsafe links, images, markup, or viewer behavior can create egress or content-spoofing risks                               |
| Source repository, CI, and release artifacts      | Credentials, fixtures, dependencies, build output, and update trust     | Secret-free fixtures, lockfile, lint/type/test gates, license and secret scans, checksums, and SBOM generation                                                                                                                     | A compromised dependency, CI credential, unsigned installer, or unsafe update can alter releases                           |

The key flow is:

```text
local files -----> ingestion/evidence -----> workspace retrieval
approved URL ----/          |                        |
                             +----> bounded context --+--> approved provider/local endpoint
                                                     |
local credential store ------------------------------+
                                                     v
local storage <---- structured history <---- evaluation/validation
     |                                               |
backup / purge / diagnostics               human approval -> local export
```

## Ranked abuse paths

| ID    | Severity / confidence | Abuse path                                                                                                                                                               | Existing mitigations                                                                                                                                                                                                                                                                                                                                                                    | Required follow-up                                                                                                                                                                    |
| ----- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-001 | High / high           | A malicious or misleading file, fetched page, or portfolio inserts instructions that influence an author or critic, causing unsupported claims or unintended disclosure. | Source/evidence boundaries, structured model ports, deterministic validation, bounded context, no autonomous agent tools.                                                                                                                                                                                                                                                               | Keep source content explicitly delimited as data, add adversarial fixtures for every parser/source type, and require a new review before enabling tools.                              |
| T-002 | High / high           | Sensitive candidate or employer material is sent to an unapproved provider, model, or endpoint without informed acknowledgement.                                         | Provider requests carry `DataExposurePolicy`; the desktop host fingerprints the visible data class, exact bounded scope, provider/model/endpoint identities, retention preference, and budgets, persists safe acknowledgement metadata, refreshes workspace configuration, and fails stale or absent acknowledgement before a live SDK path. The complete candidate corpus is excluded. | Record installed-app and cross-platform acceptance, and keep endpoint and provider-retention disclosures accurate.                                                                    |
| T-003 | High / medium         | Raw prompts, responses, sources, credentials, or confidential terms leak through logs, audit records, persistence, diagnostics, tests, or errors.                        | Normalized provider errors, `assertSafePayload`, allowlisted content-free operational events, credential redaction, and synthetic fixtures.                                                                                                                                                                                                                                             | Route every diagnostic path through the allowlist, add user-visible confidential-term redaction, and retain CI scans for secrets and raw-content keys.                                |
| T-004 | High / high           | A compromised renderer or local process steals, replaces, or triggers use of a provider credential.                                                                      | Renderer sandbox and isolation, a narrow IPC channel, strict command parsing, encrypted persistence, status/removal controls, and no credential projection back to the renderer.                                                                                                                                                                                                        | Add CSP and renderer-compromise regression coverage, rate-limit credential commands, verify OS-store behavior, clearly disclose fallback limitations, and never log command payloads. |
| T-005 | High / medium         | URL ingestion reaches a private service, follows an unsafe redirect, downloads excessive content, or imports malicious markup.                                           | Explicit approval, HTTPS-only parsing, literal and resolved-address checks, manual redirects, redirect/time/size caps, and content-type restrictions in `ingestUrl`.                                                                                                                                                                                                                    | Test DNS rebinding and alternate address encodings, review resolver-to-connect race behavior, and keep active content disabled during normalization and rendering.                    |
| T-006 | High / medium         | A generated link, image, HTML fragment, or exported document fetches remote content or impersonates trusted content when opened.                                         | Rendering is local, formats are controlled, exports require approval, and external submission is outside scope.                                                                                                                                                                                                                                                                         | Sanitize links/images, disable active content, add cross-viewer tests, and show exact output path, format, and approval status before export.                                         |
| T-007 | Medium / high         | A provider, critic, malformed response, or retry policy drives an unbounded loop or cost spike.                                                                          | Orchestrator round/cost/duration budgets, bounded retries, normalized provider errors, and content-free progress.                                                                                                                                                                                                                                                                       | Enforce budgets at each provider boundary, expose cancellation and retry state in the desktop, and keep deterministic cost and timeout regressions in CI.                             |
| T-008 | High / medium         | Workspace databases, retrieval chunks, backups, or diagnostic exports remain readable after the user believes data was deleted.                                          | Local storage, explicit backup/purge APIs, confirmed retention purge, and content-free diagnostic design.                                                                                                                                                                                                                                                                               | Define deletion coverage across primary data, FTS indexes, exports, backups, temp files, and credentials; document filesystem and backup responsibility; validate on every platform.  |
| T-009 | High / medium         | Retrieval mixes workspaces, returns stale chunks, or retains derived embeddings after source deletion.                                                                   | Workspace-scoped identifiers and lexical queries; local vector evaluation filters by workspace.                                                                                                                                                                                                                                                                                         | Add end-to-end deletion/rebuild/isolation tests and a derived-data inventory before vector or hybrid retrieval is enabled by default.                                                 |
| T-010 | High / medium         | A configured “local” OpenAI-compatible endpoint is remote, malicious, or impersonated and receives candidate content.                                                    | Explicit adapter configuration and the same structured provider boundary.                                                                                                                                                                                                                                                                                                               | Display and approve the exact endpoint and trust classification, restrict schemes/hosts by policy, and define authentication and certificate expectations before integration.         |
| T-011 | High / medium         | A compromised dependency, build workflow, installer, or update path executes with local user access.                                                                     | Pinned dependencies, lockfile review, secret/license checks, platform builds, checksums, and CycloneDX SBOM generation.                                                                                                                                                                                                                                                                 | Add signed installers, provenance where available, a verified update/rollback design, and release-key incident procedures before production beta.                                     |

## Runtime and build-time controls

Runtime controls are deny-by-default provider egress, a fingerprinted and
durable desktop transmission acknowledgement that is revalidated from current
workspace configuration before live start/resume/revision, explicit URL approval,
validated bridge commands, encrypted credential storage with a documented
fallback, provider diversity visibility, bounded rounds/cost/time, structured
outputs, source references, human approval, local retention, and content-free
operational events. These controls reduce impact but do not make model output or
the local machine authoritative.

Build-time controls are strict TypeScript, schema validation, linting,
deterministic tests, lockfile review, secret-free synthetic fixtures, security
scans, release contract tests, and evaluation regression tests. CI must fail
when a redaction, storage, provider-policy, URL-ingestion, credential-boundary,
or quality invariant regresses.

## Open risks and review triggers

The following remain open during integration hardening:

- provider-specific retention and training settings need verification and
  accurate disclosure in the user-facing policy flow;
- the implemented desktop credential and provider preflight needs
  supported-platform acceptance, including acknowledgement persistence,
  invalidation, OS-store availability, and fallback behavior;
- URL fetching needs continuing SSRF, redirect, DNS, parser, and content-egress
  review whenever supported sources or formats expand;
- retrieval deletion, rebuild, provenance, and workspace isolation need
  integrated proof before vector/hybrid retrieval is enabled by default;
- backup destinations and diagnostic exports remain the user's responsibility
  unless the product can prove their deletion and permission behavior;
- signed desktop updates, installer permissions, migration/rollback, and
  production packaging need a separate deployment review;
- cloud sync, accounts, multi-tenancy, remote retrieval, browser access,
  autonomous tools, and job submission each add trust boundaries and require a
  new review; and
- no security control can detect every unsupported claim; evidence and human
  approval remain product requirements.

See [privacy and evaluation](privacy-and-evaluation.md) for retention,
redaction, logging, and quality-regression policy. See
[ADR 0004](adr/0004-desktop-credential-boundary.md) for the desktop credential
decision and fallback limitations.
