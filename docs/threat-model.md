# Threat model

This document is the security baseline for the current DraftLoop alpha. It is a
repository-grounded model, not a claim that the product is safe for every
deployment. The current roadmap stage is the application-grade CV workflow.

## Scope and assumptions

The current product is a local, single-user CLI and Electron desktop workspace.
It also has a component-level portable Candidate Knowledge Base store: a
user-selected, separate local store with a logical UUID and lifecycle metadata,
stable CKB-scoped source identity, immutable source-version metadata, managed
raw bytes for explicitly approved local files, and an application operation for
manual version append. It also exposes an explicit bounded, count-only local
structural inventory query and keeps a prospective internal append-only
managed-write ownership journal. Application workspaces and their run history
remain separate. There is no internet-facing DraftLoop service, account system,
multi-tenant database, or background job runner in this repository.

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

The portable CKB store is plaintext. Restrictive local permissions are applied
where supported but are best-effort, not encryption, and do not protect against
another process running as the same user. The current store component contains
CKB, source, and source-version metadata plus one immutable managed raw blob per
created version. The application can explicitly approve one regular file of at
most 20 MiB in the five supported media types for initial intake or as a manual
new version of an existing file source. Every operation requires successful
extraction and repeats the stable-file and managed-copy checks. Changed bytes
create ordered parent-linked version N+1; identical current bytes return a
no-op, do not advance time, and do not establish freshness. A successful
managed create remembers the canonical physical origin path from its verified
capture in sensitive local-only SQLite state; a later selected append path never
replaces it. The binding is copied with the database but is not portable
continuity, becomes stale when the store moves machines or the origin
moves/disappears, is not automatically updated, and is never provider-facing. An
explicit read-only check can report unbound, current, changed, missing, or
inaccessible with source identity and observation time only. It never returns
the path or observed metadata/content, never mutates the source, binding, or
versions, and never persists freshness; current is point-in-time only. Source
identity and its sensitive label stay stable even if a
later path or basename differs. Exact host paths remain excluded from the
manifest, descriptor, journal, inventory, diagnostics, application
serialization, provider requests, filename provenance, filename-derived
physical names, and URLs. A separate explicit local refresh follows only the
remembered binding, repeats no-follow ingestion plus stable managed capture,
and appends changed bytes as an immutable version. Other statuses create no
version; the result does not expose the path or observed content, and refresh
never rebinds. Explicit refresh persists only source/version identities,
bounded status, observation time, and optional last successful changed-byte
refresh identity/time. It is evidence of the last explicit attempt, not a
time-based freshness claim; a later source-version advance derives stale. A
separate explicit local rebind replaces only
the sensitive binding after the newly selected regular file passes ingestion,
no-follow stable capture, and an exact latest-managed-version media/checksum/size
match. It creates no version, managed blob, journal event, or refresh-state
mutation; replaces rather
than retains the superseded path; and projects only source identity, status, and
binding time. Background refresh, time-based freshness policy,
moved-origin discovery, adapter-level refresh/rebind/duplicate controls,
directory and URL intake, automatic duplicate resolution,
indexes/retrieval, app/run CKB selection, CLI/desktop controls, deletion,
cleanup/reconciliation, and complete backup/export/restore have not moved into
that boundary.

The inventory query runs only on request and only after normal referenced-blob
validation. It counts verified managed files, scanned entries, staging-shaped
root files, other opaque root files/directories, extra entries inside expected
managed-source directories, symlinks, and special/other entries, and reports
whether the bounded scan completed or reached its limit. It returns no names,
paths, IDs, labels, checksums, or content; never follows unknown symlinks,
recurses unknown directories, or reads unknown file bytes; and never mutates
the database or filesystem. An unreferenced entry's shape is not authenticated
ownership evidence, so it remains unknown and cannot be deleted, adopted,
quarantined, or repaired by this query.

SQLite migration version 7 records opaque intent for each new managed create or
append before staging. A monotonic event records the resolved target before
publication, followed by publication and the atomic managed-marker/database
commit; completion follows staging cleanup. New staging
names are opaque operation-derived hashes. The internal append-only journal
contains no origin path, filename, label, checksum, source content, provider
data, diagnostic projection, cleanup token, or approval, and its identifiers
are not exposed. It does not retroactively claim legacy version-6 writes;
entries without prospective journal proof remain unknown.

Future cloud sync, authentication, multi-tenancy, remote retrieval, browser
extensions, autonomous tools, or external job submission require a new
threat-model review. They are not covered by the controls below.

## Assets and trust boundaries

| Boundary                                              | Asset at risk                                                                                      | Current control                                                                                                                                                                                                                                                                                                                           | Residual concern                                                                                                                                                                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User-selected files to ingestion                      | Career history and employer material                                                               | Explicit file selection, supported-type checks, checksums, source locators, and normalized evidence                                                                                                                                                                                                                                       | Parsed content remains untrusted and can contain prompt injection or parser edge cases                                                                                                                                                   |
| Desktop renderer to preload/main                      | Credentials, workspace commands, and approval intent                                               | Context isolation, sandboxing, one frozen IPC channel, allowlisted commands, and `validateBridgeCommand` in `apps/desktop/src/bridge.ts`                                                                                                                                                                                                  | A compromised renderer can still submit any allowed command and can observe a key while the user types it                                                                                                                                |
| Main process to credential store                      | Provider API keys                                                                                  | `createSafeStorageCredentialStore`, explicit app-before-environment resolution without environment mutation, truthful backend projection, restricted local files, status/removal commands                                                                                                                                                 | Linux `basic_text` is weak; local fallback key and ciphertext share the user boundary; host compromise exposes decrypted keys                                                                                                            |
| Application to model provider                         | Candidate sources, context, prompts, and drafts                                                    | Fingerprinted desktop preflight, workspace-local safe acknowledgement metadata, fresh host-side verification before transmitting actions, `DataExposurePolicy`, provider/model/endpoint identity, bounded context, and run budgets                                                                                                        | The flow is not yet cross-platform validated; provider retention and training behavior remain external facts                                                                                                                             |
| Application to authenticated local agent runtime      | Candidate context, provider session, local files, and process environment                          | Explicit user-session mode, empty temporary working directory, disabled tools/customizations/MCP/web access, bounded process IO, cancellation, structured-output validation, and no OAuth-token extraction                                                                                                                                | Vendor runtimes and subscription terms can change; Codex does not currently expose an enforceable output-token ceiling                                                                                                                   |
| Application to approved URL                           | Source URL, local network reachability, fetched content, and provenance                            | `ingestUrl` requires approval, HTTPS, safe host resolution, manual redirect validation, time/size limits, supported text content, and successful extraction; initial CKB intake publishes exact response bytes and immutable local per-version URL provenance only after those gates pass                                                                                                                   | DNS rebinding, resolver/fetch races, remote tracking, malicious HTML, sensitive query strings, and future parser expansion require continuing tests; CKB URL refresh/readiness is not implemented                                         |
| Application to portable-store structural inventory    | Sensitive unknown filesystem entries and managed-source integrity                                  | Explicit local query after referenced-blob validation; bounded count-only classification; no names/paths/content; no unknown symlink following, unknown-directory recursion, unknown-byte reads, mutation, or provider exposure                                                                                                           | Counts reveal limited store shape; scan limits may produce incomplete results; structural categories cannot establish ownership or authorize cleanup                                                                                     |
| Managed-write operation to internal ownership journal | Prospective ownership provenance and operation lifecycle                                           | Append-only opaque intent before staging; resolved target before publication; monotonic publication and atomic-commit events; completion after staging cleanup; terminal non-owning no-op; opaque operation-derived staging names; no sensitive source metadata, cleanup token, approval, diagnostic, provider, or application projection | Same-user database tampering remains possible; legacy and unjournaled entries stay unknown; journal evidence alone cannot coordinate writers or authorize cleanup                                                                        |
| Application to local endpoint                         | Candidate data, credentials, and model output                                                      | Adapter contract, structured output validation, and explicit configuration                                                                                                                                                                                                                                                                | “Local” does not prove same-machine operation, privacy, identity, or trustworthy retention                                                                                                                                               |
| Application to local history and retrieval            | Run metadata, evidence chunks, findings, decisions, and artifacts                                  | SQLite persistence, workspace identifiers, checksums, immutable records, FTS scoping, and `assertSafePayload` in `packages/storage/src/index.ts`                                                                                                                                                                                          | Host compromise, incomplete field checks, deletion bugs, or query mistakes can expose or mix workspace data                                                                                                                              |
| User-approved local file to portable CKB store        | Raw candidate bytes, stable store/source identity, local labels, checksums, and lifecycle metadata | Explicit add/manual append/bound-refresh/exact-byte-rebind/retire operations; regular-file/type/20 MiB/extraction gates; stable copy for versions and read/hash verification for rebind; parent-linked changed versions; current refresh no-write; rebind changes only sensitive local origin state; immutable logical retirement blocks further mutations without erasing evidence; opaque ID-derived no-replace copy; version-6 managed marker; path-free application results; best-effort restrictive permissions | Plaintext bytes and labels remain readable to same-user processes and backups; retirement is not physical deletion and does not remove indexes or copies; point-in-time inspection can race later changes; crashes or concurrency can leave unreferenced residue; background refresh, automatic moved-origin discovery, adapter controls, selection, retrieval, reconciliation, reactivation, and broader lifecycle controls are not integrated |
| Backup, restore, retention purge, and diagnostics     | Copies of workspace data and operational metadata                                                  | Explicit local operations, integrity checks, confirmed purge, and content-free diagnostic design                                                                                                                                                                                                                                          | Backups can outlive workspace deletion; destination permissions and restore overwrite behavior need platform acceptance                                                                                                                  |
| Approved artifact to renderer/export                  | Links, HTML/Markdown, and generated files                                                          | Local rendering, controlled formats, checksum records, and an approval boundary                                                                                                                                                                                                                                                           | Unsafe links, images, markup, or viewer behavior can create egress or content-spoofing risks                                                                                                                                             |
| Source repository, CI, and release artifacts          | Credentials, fixtures, dependencies, build output, and update trust                                | Secret-free fixtures, lockfile, lint/type/test gates, license and secret scans, checksums, and SBOM generation                                                                                                                                                                                                                            | A compromised dependency, CI credential, unsigned installer, or unsafe update can alter releases                                                                                                                                         |

The key flow is:

```text
local files -----> ingestion/evidence -----> workspace retrieval
approved URL ----/          |                        |
                             +----> bounded context --+--> approved provider/local endpoint
                                                     |
local credential store ------------------------------+
                                                     v
application workspace store <---- structured history <---- evaluation/validation
     |                                                         |
backup / purge / diagnostics                         human approval -> local export

portable CKB store (logical UUID + CKB/source/version metadata + managed raw blobs)
approved local file ----> journaled add/manual append ----> immutable raw version
                                |
                                +----> internal prospective operation events
remembered origin ------> explicit status / changed-byte refresh / exact-byte rebind
     . . . future lifecycle, selection, retrieval, and provider integration . . .
```

## Ranked abuse paths

| ID    | Severity / confidence | Abuse path                                                                                                                                                               | Existing mitigations                                                                                                                                                                                                                                                                                                                                                                    | Required follow-up                                                                                                                                                                                                                                                                 |
| ----- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-001 | High / high           | A malicious or misleading file, fetched page, or portfolio inserts instructions that influence an author or critic, causing unsupported claims or unintended disclosure. | Source/evidence boundaries, structured model ports, deterministic validation, bounded context, no autonomous agent tools.                                                                                                                                                                                                                                                               | Keep source content explicitly delimited as data, add adversarial fixtures for every parser/source type, and require a new review before enabling tools.                                                                                                                           |
| T-002 | High / high           | Sensitive candidate or employer material is sent to an unapproved provider, model, or endpoint without informed acknowledgement.                                         | Provider requests carry `DataExposurePolicy`; the desktop host fingerprints the visible data class, exact bounded scope, provider/model/endpoint identities, retention preference, and budgets, persists safe acknowledgement metadata, refreshes workspace configuration, and fails stale or absent acknowledgement before a live SDK path. The complete candidate corpus is excluded. | Record installed-app and cross-platform acceptance, and keep endpoint and provider-retention disclosures accurate.                                                                                                                                                                 |
| T-003 | High / medium         | Raw prompts, responses, sources, credentials, or confidential terms leak through logs, audit records, persistence, diagnostics, tests, or errors.                        | Normalized provider errors, `assertSafePayload`, allowlisted content-free operational events, credential redaction, and synthetic fixtures.                                                                                                                                                                                                                                             | Route every diagnostic path through the allowlist, add user-visible confidential-term redaction, and retain CI scans for secrets and raw-content keys.                                                                                                                             |
| T-004 | High / high           | A compromised renderer or local process steals, replaces, or triggers use of a provider credential.                                                                      | Renderer sandbox and isolation, narrow validated IPC, explicit app-before-environment resolution, backend disclosure, encrypted persistence, status/removal controls, process-only acceptance canaries, and no secret projection back to the renderer.                                                                                                                                  | Add CSP and renderer-compromise regression coverage, rate-limit credential commands, review cross-platform workflow evidence, and never log command payloads.                                                                                                                      |
| T-005 | High / medium         | URL ingestion reaches a private service, follows an unsafe redirect, downloads excessive content, leaks a sensitive URL, or imports malicious markup.                    | Explicit approval, HTTPS-only parsing, literal and resolved-address checks, manual redirects, redirect/time/size caps, content-type restrictions, exact-byte integrity checks, opaque storage names, local-only immutable URL provenance, and generic URL-free application failures.                                                                                                     | Test DNS rebinding and alternate address encodings, review resolver-to-connect race behavior, keep active content inert, and require retirement/readiness checks before any future refresh fetch.                                                                                  |
| T-006 | High / medium         | A generated link, image, HTML fragment, or exported document fetches remote content or impersonates trusted content when opened.                                         | Rendering is local, formats are controlled, exports require approval, and external submission is outside scope.                                                                                                                                                                                                                                                                         | Sanitize links/images, disable active content, add cross-viewer tests, and show exact output path, format, and approval status before export.                                                                                                                                      |
| T-007 | Medium / high         | A provider, critic, malformed response, or retry policy drives an unbounded loop or cost spike.                                                                          | Orchestrator round/cost/duration budgets, a durable maximum of three orchestration attempts per run/round/step, bounded adapter retries, normalized provider errors, and content-free progress and recovery actions. Explicit cancellation signals are normalized as non-retryable.                                                                                                     | Enforce budgets at each provider boundary and keep deterministic cost, timeout, cancellation, restart, and attempt-limit regressions in CI. Active in-flight cancellation control is not yet implemented.                                                                          |
| T-008 | High / medium         | Workspace databases, retrieval chunks, backups, or diagnostic exports remain readable after the user believes data was deleted.                                          | Local storage, explicit backup/purge APIs, confirmed retention purge, and content-free diagnostic design.                                                                                                                                                                                                                                                                               | Define deletion coverage across primary data, FTS indexes, exports, backups, temp files, and credentials; document filesystem and backup responsibility; validate on every platform.                                                                                               |
| T-009 | High / medium         | Retrieval mixes workspaces, returns stale chunks, or retains derived embeddings after source deletion.                                                                   | Workspace-scoped identifiers and lexical queries; local vector evaluation filters by workspace.                                                                                                                                                                                                                                                                                         | Add end-to-end deletion/rebuild/isolation tests and a derived-data inventory before vector or hybrid retrieval is enabled by default.                                                                                                                                              |
| T-010 | High / medium         | A configured “local” OpenAI-compatible endpoint is remote, malicious, or impersonated and receives candidate content.                                                    | Explicit adapter configuration and the same structured provider boundary.                                                                                                                                                                                                                                                                                                               | Display and approve the exact endpoint and trust classification, restrict schemes/hosts by policy, and define authentication and certificate expectations before integration.                                                                                                      |
| T-011 | High / medium         | A compromised dependency, build workflow, installer, or update path executes with local user access.                                                                     | Pinned dependencies, lockfile review, secret/license checks, platform builds, checksums, and CycloneDX SBOM generation.                                                                                                                                                                                                                                                                 | Add signed installers, provenance where available, a verified update/rollback design, and release-key incident procedures before production beta.                                                                                                                                  |
| T-012 | High / medium         | A local subscription runtime loads tools, repository instructions, plugins, or account configuration and gains access beyond the approved model request.                 | User-session mode runs from an empty temporary directory, disables supported tool and customization surfaces, bounds output, rejects observed tool events, and never copies OAuth credentials.                                                                                                                                                                                          | Keep the mode experimental until vendor embedding terms, packaged-runtime behavior, retention, and enforceable token budgets are resolved and acceptance-tested.                                                                                                                   |
| T-013 | High / medium         | Plaintext managed source bytes or a copied store remain readable after the user deletes the original file, remote page, or application workspace and believes the material is gone. | Logical identity is independent of host path/URL; sensitive file bindings and immutable URL provenance are local SQLite state excluded from generic projections and providers; managed names are opaque; local permissions are restrictive where supported.                                                                                                                              | Permissions are best-effort and do not stop a same-user process. Disclose that origin/workspace deletion does not delete the CKB copy, SQLite-only backup is incomplete, and CKB deletion/export/restore and backup coverage remain unimplemented.                                  |
| T-014 | High / medium         | A CKB label or checksum leaks candidate information, a duplicate signal is treated as source identity, or a source named like agent configuration is treated as executable instruction. | Exact host paths, filename provenance, filename-derived physical names, and URLs are excluded; content-free and duplicate projections omit labels and checksums; duplicate groups are one-CKB-scoped, latest-version-only, read-only relationships with no merge/delete authority; all managed files and versions, including `AGENTS.md`-like selections, remain inert untrusted candidate data under opaque ID-derived names. | Keep UI and diagnostic projections distinct, keep configuration-like names adversarially tested, require explicit lifecycle decisions for duplicates, and review any future origin-path provenance. |
| T-015 | High / medium         | A selected path changes during validation, copying, or rebinding, causing different, partial, special-file, or oversized bytes to enter the CKB or become its remembered origin. | Explicit one-file approval for add, append, and rebind; repeated regular-file/type/size checks; extraction before persistence or binding replacement; immutable raw-byte copy for versions; checksum and size verification; no-replace publication; exact latest-version match before rebind. | Keep source-mutation, symlink, special-file, size-growth, extraction-failure, and exact-match tests at all managed-file boundaries; do not claim protection from a process that already controls the same user account. |
| T-016 | Medium / high         | A crash or concurrent managed-file add or append leaves an unreferenced sensitive blob, or metadata commits without the verified bytes it names.                         | File-first/database-second publication, version-6 managed markers, verified bytes for every committed marker, no-replace targets, ordinary failure cleanup, bounded structural inventory, prospective version-7 journal events, and atomic version-8 origin-binding insertion for successful creates.                                                                                   | Journal evidence does not cover legacy writes, coordinate concurrent writers, or authorize cleanup. Unjournaled entries remain unknown; future cleanup requires writer coordination and explicit visible approval.                                                                 |
| T-017 | Medium / medium       | Structural inventory leaks sensitive entry identity/content, escapes through a symlink or unknown directory, or is mistaken for cleanup authority.                       | Count-only bounded result; normal referenced-blob validation first; no names, paths, IDs, labels, checksums, content, unknown-byte reads, unknown symlink following, unknown-directory recursion, mutation, automatic execution, or provider exposure.                                                                                                                                  | Counts can disclose limited store shape and scan-limit status can be incomplete. Keep the query separate from content diagnostics and require prospective journal evidence, writer coordination, and explicit approval before any future cleanup.                                  |
| T-018 | Medium / medium       | A journal record, matching bytes, or a staging-shaped name is mistaken for current ownership or cleanup approval.                                                        | Prospective append-only operation events, opaque hashed staging names, no retroactive v6 claims, no cleanup token/approval field, no journal-ID projection, and no adoption of pre-existing targets based on bytes or shape.                                                                                                                                                            | Same-user tampering is in scope; journal provenance is only one future policy input. Add writer locks/leases and explicit visible approval before enabling cleanup.                                                                                                                |
| T-019 | High / medium         | A logically retired CKB source remains selectable or retrievable, or retirement is misrepresented as physical deletion.                                                   | A separate immutable, CKB-scoped retirement marker; storage-boundary rejection of append, rebind, and refresh-observation writes; path-free lifecycle query; retained immutable source/version and local evidence.                                                                                                                                                                  | #111 and #80 must consume lifecycle state atomically and fail closed; index removal, retention, backup/restore, reactivation, and physical deletion remain separate policy work under #113.                                                                                         |

## Runtime and build-time controls

Runtime controls are deny-by-default provider egress, a fingerprinted and
durable desktop transmission acknowledgement that is revalidated from current
workspace configuration before live start/resume/revision, explicit URL approval,
validated bridge commands, encrypted credential storage with a documented
fallback, a loopback-only endpoint rule for the `local` provider company,
provider diversity visibility, bounded rounds/cost/time, structured
outputs, source references, human approval, local retention, and content-free
operational events. These controls reduce impact but do not make model output or
the local machine authoritative.

The portable CKB store path and each approved source path are local host
configuration. Neither is part of logical identity, the portable manifest, a
provider request, or content-free audit/diagnostic data. A selected source path
is runtime-only and is not remembered after add or append. The original
filename is not a managed physical name or persisted provenance, and selecting
a different path or basename does not change the source identity or label.
Source labels are local user-visible metadata, and source checksums can
correlate known content; neither belongs in content-free diagnostics or provider
requests. Managed raw bytes use opaque ID-derived names and remain inert even
when a label resembles `AGENTS.md` or other configuration. No CLI or desktop
workflow currently selects this store for a run, so provider transmission and
retrieval must continue to use the existing workspace boundary until explicit
selection and preflight binding are implemented.

The structural inventory is a local application query, not a provider-facing
projection or content-diagnostic workflow. Missing or corrupt referenced blobs
still fail normal validation; inventory is not repair mode. Unknown entries are
counted without names or content and remain untouched. The prospective internal
journal is not returned by inventory or provider-facing projections and does
not trigger an automatic scan. Same-current-byte managed appends record a
terminal, non-owning no-op; metadata-only versions may be explicitly materialized without adopting
pre-existing unowned targets based on matching bytes or shape. A future
reconciliation requires journal evidence, coordination with managed writers,
and a visible approval boundary.

The `local` provider company is a claim that candidate material never leaves
this machine, and every downstream surface — the desktop transmission
preflight, the run audit trail, the workspace labels — repeats that claim
without rechecking it. A configured local endpoint is therefore accepted only
when it is an `http`/`https` URL whose host is `localhost`, `::1`, or an
address in `127.0.0.0/8`, and never when it carries embedded credentials, which
are unnecessary for a local server and are the usual way to make a remote host
read as a local one. The rule is enforced at workspace load as well as at
creation, so a hand-edited `workspace.json` is refused. Hosts that merely
resolve to a loopback address are rejected, because resolution cannot be
verified at that point.

Build-time controls are strict TypeScript, schema validation, linting,
deterministic tests, lockfile review, secret-free synthetic fixtures, security
scans, release contract tests, and evaluation regression tests. CI must fail
when a redaction, storage, provider-policy, URL-ingestion, credential-boundary,
or quality invariant regresses.

## Open risks and review triggers

The following remain open during the application-grade CV stage:

- provider-specific retention and training settings need verification and
  accurate disclosure in the user-facing policy flow;
- the implemented desktop credential and provider preflight needs
  supported-platform acceptance, including acknowledgement persistence,
  invalidation, OS-store availability, and fallback behavior;
- URL fetching needs continuing SSRF, redirect, DNS, parser, and content-egress
  review whenever supported sources or formats expand;
- retrieval deletion, rebuild, provenance, and workspace isolation need
  integrated proof before vector/hybrid retrieval is enabled by default;
- portable continuity for the local CKB origin binding, background refresh,
  time-based freshness policy, automatic moved-origin discovery and
  adapter-level refresh/rebind controls,
  directory intake, URL refresh/readiness, automatic duplicate resolution, indexing and
  retrieval, application/run selection, CLI/desktop controls, repair of
  missing/corrupt referenced blobs, lock/lease writer coordination, deletion,
  cleanup approval/reconciliation, complete
  backup/export/restore, and migration rollback remain outside the managed-file
  component;
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
