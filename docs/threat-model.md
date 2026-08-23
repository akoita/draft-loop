# Threat model

This document is the repository-grounded security baseline for the current
DraftLoop alpha. The roadmap stage is **Evidence-backed CV drafting**. It is not
a claim that the product is safe for every deployment; controls, assumptions,
and residual risks must be revisited as boundaries change.

## Scope and assumptions

DraftLoop is a local, single-user CLI and Electron desktop workspace. There is
no internet-facing DraftLoop service, account system, multi-tenant database,
background job runner, browser extension, or external job submission path.
Application workspaces own current evidence, run history, and exports.

The active network boundaries are explicitly approved Anthropic and OpenAI
requests, approved HTTPS URL intake and refresh, and an optional configured
OpenAI-compatible local endpoint. The endpoint and its operator remain part of
the user's trust decision. Credentials may come from SDK environment variables,
the desktop credential flow, or a provider-managed local session. The Electron
main process owns desktop credential persistence; OS-backed `safeStorage` is
preferred, with a local AES-256-GCM fallback protected by file permissions.
Neither protects against a process that controls the same user account.

Source files, fetched pages, model output, exports, backups, diagnostic data,
and retrieval indexes are sensitive or untrusted. Models and source material
may contain errors or indirect instructions. DraftLoop treats source content as
data, not as application policy or executable instructions.

### Current CKB scope

The portable Candidate Knowledge Base (CKB) is a separate local plaintext
component with a logical UUID, lifecycle metadata, stable source identity,
immutable source-version metadata, and opaque managed raw bytes. Approved local
file intake and manual append enforce supported types, extraction, stable-file
checks, and the 20 MiB per-file limit. Approved directory intake is bounded;
its root and immutable normalized-relative-path membership hashes are sensitive
local state. Partial and legacy runtime-only imports have no directory binding.

Host paths, URL provenance, and membership hashes are not portable identity and
are excluded from generic manifests, providers, and content-free diagnostics.
Labels and checksums are local CKB metadata but remain excluded from provider
and content-free surfaces. CKB data is not currently selected by the CLI or
desktop application-run flow; the existing workspace boundary remains
authoritative. See [ADR 0007](adr/0007-portable-candidate-knowledge-store.md),
[privacy policy](privacy-and-evaluation.md), and [architecture](architecture.md)
for ownership and exact contracts.

Lifecycle actions are explicit and bounded. A root rebind performs one complete
bounded scan, stable per-member verification, and a guarded all-member origin
commit or same-root no-op. The implemented one-source member-move command
accepts only source identity, derives a unique target from one bounded local
scan, and retains that target path only in runtime memory. It uses the same
guarded handle for the move and an already-current no-op, maps failures to a
path-free error, and persists only the sensitive origin binding and append-only
member revision. Its public result exposes no path, filename, checksum,
content, integrity tuple, or version identity.

File shape never proves ownership. Complete reconciliation reports
moved-candidate evidence separately and acts only on explicit retirement
source IDs. Incomplete scans perform no writes. Selected retirements run in
deterministic order with root/member/version/origin guards; each marker is
atomic, and a later failure exposes only path-free partial source IDs.
Automatic move inference, automatic retirement or deletion,
backup/export/restore, retrieval integration, and background refresh remain
deferred.

Indexing consumers receive a frozen CKB-scoped lifecycle-readiness projection
instead of reading sensitive tables. It blocks retired, archived, unmanaged,
unbound, directory-conflicted, adverse-observation, and stale-observation state.
Its structured revision uses only safe identities, timestamps, booleans, and
numeric directory revisions, so newer persisted lifecycle evidence invalidates
an older selection without exposing paths, URLs, labels, hashes, checksums, or
content. It is not an index-freshness or live-origin assertion.

The count-only structural inventory does not adopt or delete unknown entries.
The prospective managed-write journal does not retroactively claim legacy
entries and is not cleanup authority. A crash or concurrent writer can leave
unknown opaque residue. The [threat risks below](#ranked-abuse-paths) cover
these limitations without repeating the implementation chronology.

Future cloud sync, authentication, multi-tenancy, remote retrieval, autonomous
tools, or job submission require a new threat-model review.

## Assets and trust boundaries

| Boundary                                      | Asset at risk                                                                     | Current control                                                                                                                                              | Residual concern                                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Selected files and approved pages → ingestion | Career history, employer material, and indirect instructions                      | Explicit approval, supported-type and size checks, extraction, source/evidence boundaries, bounded context, no autonomous tools                              | Parsers and source text remain untrusted and can contain prompt injection or edge cases                                       |
| Desktop renderer → preload/main               | Credentials, commands, and approval intent                                        | Context isolation, sandboxing, one narrow validated bridge, allowlisted commands                                                                             | A compromised renderer can still invoke an allowed command and observe a key while it is entered                              |
| Main process → credential store               | Provider API keys and OAuth session boundaries                                    | OS `safeStorage` when available, documented encrypted fallback, explicit resolution, status/removal controls, no history projection                          | Linux fallback and host compromise remain within the user boundary                                                            |
| Workspace → model provider                    | Candidate context, prompts, drafts, and provider identity                         | Fingerprinted transmission preflight, fresh host-side checks, `DataExposurePolicy`, bounded scope, provider/model/endpoint visibility, budgets               | Provider retention and training behavior are external; cross-platform acceptance is incomplete                                |
| Workspace → approved URL                      | URL, local network reachability, fetched bytes, and provenance                    | Explicit approval, HTTPS, literal/resolved-address checks, redirect/time/size/content limits, extraction, URL-free errors                                    | DNS rebinding, resolver/fetch races, tracking, malicious markup, and sensitive query strings remain risks                     |
| Approved directory → CKB intake               | Files, paths, traversal reachability, and aggregate size                          | Real non-symlink root outside the store, canonical containment, deterministic bounded traversal, no child-symlink or special-entry opens, complete preflight | Same-user mutation races remain possible; counts disclose limited shape; later changes do not reconcile automatically         |
| Local file/directory → portable CKB           | Plaintext bytes, source identity, origins, labels, checksums, and lifecycle state | Opaque no-replace managed copies, immutable versions, sensitive local bindings, path-free results, guarded root rebind and one-source move                   | Same-user processes and backups can read plaintext; move, retirement, deletion, backup, and retrieval lifecycle is incomplete |
| CKB filesystem → inventory/journal            | Unknown entries and ownership evidence                                            | Count-only inventory after normal validation; opaque append-only events; no cleanup token; no shape-based adoption                                           | Unjournaled or legacy entries remain unknown; inventory cannot authorize cleanup or repair                                    |
| Application → local model endpoint            | Candidate data, credentials, and output                                           | Explicit adapter configuration and structured provider boundary; loopback policy for the `local` company                                                     | “Local” does not by itself prove identity, same-machine operation, or trustworthy retention                                   |
| Application → installed user-session runtime  | Context, local files, provider session, and process environment                   | Empty temporary directory, tools/customizations/MCP/web disabled where supported, bounded IO, structured output, no OAuth extraction                         | Vendor runtime and subscription behavior can change; output ceilings are not fully enforceable                                |
| Workspace history/retrieval → local storage   | Run metadata, evidence chunks, decisions, artifacts, and derived indexes          | Workspace identifiers, checksums, immutable records, scoped lexical retrieval, safe-payload validation                                                       | Host compromise, deletion bugs, and isolation mistakes can expose or mix data                                                 |
| Backups/purge/diagnostics → copies            | Retained workspace data and operational metadata                                  | Explicit local operations, confirmed purge, content-free diagnostics                                                                                         | User backups and exports can outlive deletion; CKB backup/restore is not integrated                                           |
| Rendered artifact → viewer/export             | Links, markup, and generated files                                                | Local rendering, controlled formats, checksum records, visible approval                                                                                      | Unsafe links, images, markup, or viewers can create egress or spoofing risks                                                  |
| Repository/CI/release → installed artifact    | Credentials, dependencies, build output, and update trust                         | Secret-free fixtures, lockfile review, lint/type/test gates, scans, checksums, SBOM                                                                          | Unsigned installers, compromised dependencies, CI credentials, or unsafe updates remain possible                              |

## Ranked abuse paths

The ratings are qualitative priority indicators, not a guarantee of exploit
likelihood. Follow-up items are required before the affected boundary is
expanded.

| ID    | Severity / confidence | Threat                                                                                                                                 | Current control                                                                                                                                                                        | Residual risk / follow-up                                                                                                        |
| ----- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| T-001 | High / high           | A file or fetched page injects instructions that produce unsupported claims or disclosure.                                             | Delimited source data, structured model ports, deterministic validation, bounded context, no autonomous tools.                                                                         | Keep adversarial fixtures for every source type and review before enabling tools.                                                |
| T-002 | High / high           | Sensitive material reaches an unapproved provider, model, endpoint, or scope.                                                          | `DataExposurePolicy`, fingerprinted visible preflight, explicit acknowledgement, fresh host checks, corpus exclusion, fail-closed stale policy.                                        | Complete installed-app and cross-platform acceptance; keep provider-retention disclosures accurate.                              |
| T-003 | High / medium         | Prompts, responses, sources, credentials, or confidential terms leak through logs, tests, diagnostics, or errors.                      | Allowlisted `contentRedacted` events, deterministic credential redaction, normalized errors, synthetic fixtures, safe-payload assertions.                                              | Route every diagnostic path through the allowlist and add explicit confidential-term rules.                                      |
| T-004 | High / high           | A compromised renderer or local process steals or misuses a provider credential.                                                       | Narrow IPC, renderer isolation, explicit credential resolution, encrypted persistence, lifecycle controls, process-only canaries, no secret projection.                                | Add CSP and renderer-compromise regressions; rate-limit credential commands and never log payloads.                              |
| T-005 | High / medium         | URL intake reaches a private service, unsafe redirect, excessive response, or malicious markup.                                        | HTTPS, literal and resolved-address checks, manual redirects, caps, content restrictions, exact-byte checks, immutable local provenance, URL-free failures.                            | Continue DNS/redirect/parser/egress tests and review resolver-to-connect races.                                                  |
| T-006 | High / medium         | A generated link, image, HTML fragment, or export fetches remote content or spoofs trusted content.                                    | Local controlled rendering and visible export approval; external submission is out of scope.                                                                                           | Sanitize links and images, disable active content, and test supported viewers.                                                   |
| T-007 | Medium / high         | A provider, critic, malformed response, or retry policy causes an unbounded loop or cost spike.                                        | Round, cost, duration, and attempt budgets; bounded adapter retries; normalized errors; cancellation treated as non-retryable.                                                         | Enforce budgets at every provider boundary and keep deterministic timeout/restart tests.                                         |
| T-008 | High / medium         | Data remains readable after a user believes primary history or a copy was deleted.                                                     | Explicit local purge, backup operations, content-free diagnostics, documented retention limits.                                                                                        | Define coverage for FTS, exports, backups, temp files, credentials, and CKB copies on every platform.                            |
| T-009 | High / medium         | Retrieval mixes workspaces, serves stale chunks, or retains derived data after source deletion.                                        | Workspace-scoped identifiers and lexical queries; local vector evaluation filters by workspace.                                                                                        | Prove deletion, rebuild, provenance, and isolation before vector/hybrid retrieval is default.                                    |
| T-010 | High / medium         | A configured “local” endpoint is remote, malicious, or impersonated.                                                                   | Explicit endpoint policy and structured provider boundary; literal loopback host checks for the `local` company.                                                                       | Display and approve exact endpoint/trust identity; define authentication and certificate expectations.                           |
| T-011 | High / medium         | A dependency, build workflow, installer, or update path executes with local access.                                                    | Pinned dependencies, lockfile review, secret/license scans, checksums, platform builds, SBOM.                                                                                          | Add signed installers, provenance, verified update/rollback, and release-key procedures.                                         |
| T-012 | High / medium         | A subscription runtime loads tools, repository instructions, plugins, or account configuration beyond the request.                     | Empty temporary directory, disabled tools/customizations/MCP/web, bounded output, rejected tool events, no OAuth copy.                                                                 | Keep experimental until vendor terms, retention, and enforceable budgets are acceptance-tested.                                  |
| T-013 | High / medium         | Plaintext managed bytes or a copied CKB remain after the original or workspace is deleted.                                             | Opaque names; logical identity separate from paths/URLs; sensitive bindings excluded from providers; restrictive permissions.                                                          | Same-user access remains possible; CKB deletion, backup/export/restore, and derived-data cleanup are unimplemented.              |
| T-014 | High / medium         | A label/checksum leaks information, duplicate evidence is treated as identity, or a configuration-like file becomes instruction.       | Content-free projections omit labels/checksums; duplicate signals are read-only and one-CKB-scoped; all candidate files remain inert data.                                             | Keep UI and diagnostics separate; require explicit lifecycle decisions and adversarial filename tests.                           |
| T-015 | High / medium         | A selected file changes during validation, copying, rebind, or one-source move.                                                        | Regular-file/type/size checks, stable capture, extraction, immutable copy, checksum/size verification, exact latest-version match, guarded handle.                                     | Same-user mutation races cannot be eliminated; retain boundary regression tests.                                                 |
| T-016 | Medium / high         | A crash or concurrent writer leaves an unreferenced blob or metadata without verified bytes.                                           | File-first/database-second publication, no-replace targets, managed markers, ordinary cleanup, count-only inventory, prospective journal.                                              | Legacy and unjournaled entries remain unknown; writer coordination and explicit approval are prerequisites for cleanup.          |
| T-017 | Medium / medium       | Inventory leaks entry identity or is mistaken for cleanup authority.                                                                   | Bounded counts only; no names, IDs, paths, checksums, content, unknown-byte reads, recursion, symlink following, mutation, or provider exposure.                                       | Counts still reveal limited shape; scan limits can be incomplete and require separate diagnostics policy.                        |
| T-018 | Medium / medium       | A journal entry, matching bytes, or staging-shaped name is mistaken for ownership.                                                     | Journal has opaque operation events but no cleanup/approval field; no retroactive legacy claims or adoption by bytes/shape.                                                            | Add writer locks/leases and visible approval before any reconciliation or cleanup.                                               |
| T-019 | High / medium         | A retired or otherwise ineligible source remains selectable/retrievable, or logical retirement is presented as deletion.                | Immutable retirement plus a consistent path-free readiness projection blocks retired, archived, stale/adverse, unmanaged, unbound, and directory-conflicted state while preserving evidence. | #80 must bind index state and queries to the projected revision; backup/restore, reactivation, and physical deletion remain future work. |
| T-020 | High / medium         | Directory traversal follows a symlink, escapes its root, opens special/hidden files, exceeds limits, or writes after failed preflight. | Real non-symlink root, canonical containment, deterministic limits, skipped unsafe entries, complete extraction preflight, path-free results, guarded root rebind and one-source move. | Same-user races remain; additions/removals, automatic reconciliation, automatic deletion, and membership lifecycle are deferred. |

## Runtime and build-time controls

Runtime controls are deny-by-default provider egress, a durable fingerprinted
transmission acknowledgement revalidated before every live start/resume/revision,
explicit URL and local-file approval, validated bridge commands, credential
protection with a documented fallback, provider-diversity visibility, bounded
orchestration, structured outputs, source references, human approval, local
retention, and content-free operational events. These controls reduce impact;
they do not make model output or the local machine authoritative.

The `local` provider company is accepted only for an `http` or `https` endpoint
whose literal host is `localhost`, `::1`, or in `127.0.0.0/8`, without embedded
credentials. Hosts that merely resolve to loopback are rejected. Workspace
configuration is checked at creation and load so a hand-edited endpoint cannot
silently change its trust classification.

The CKB path, selected roots, and manual-append paths are local configuration.
Only deliberate sensitive local tables retain origins, URL provenance, root
bindings, labels, or membership hashes. No CKB data is provider data, and no
file shape is ownership proof. Root rebind and one-source member move use
bounded scans and stable final verification; target paths stay runtime-only.

Build-time controls are strict TypeScript, schema validation, linting,
deterministic tests, lockfile review, secret-free fixtures, security scans,
release contract tests, checksums, SBOM generation, and evaluation regression
tests. CI must fail when redaction, storage, provider-policy, URL-ingestion,
credential-boundary, or quality invariants regress.

## Open risks and review triggers

The following remain open during the **Evidence-backed CV drafting** stage:

- Provider-specific retention and training settings need verification and
  accurate user-facing disclosure.
- Desktop credentials and transmission preflight need supported-platform
  acceptance, including acknowledgement persistence, invalidation, OS-store
  availability, and fallback behavior.
- URL fetching needs continuing SSRF, redirect, DNS, parser, and content-egress
  review whenever supported sources or formats expand.
- Retrieval deletion, rebuild, provenance, and workspace isolation need
  integrated proof before vector or hybrid retrieval is enabled by default.
- Automatic moved-origin inference, automatic retirement, physical deletion,
  backup/export/restore, retrieval integration, application/run CKB selection,
  and background refresh remain deferred.
- Plaintext permissions, copied stores, missing/corrupt blobs, writer
  coordination, cleanup approval, migration rollback, and backup destinations
  require explicit policy and platform evidence.
- Signed desktop updates, installer permissions, and release-key response need
  a separate deployment review.
- Cloud sync, accounts, multi-tenancy, remote retrieval, browser access,
  autonomous tools, and job submission each add trust boundaries and require a
  new review.

See [privacy and evaluation](privacy-and-evaluation.md) for retention,
redaction, logging, and evaluation policy. See [ADR 0007](adr/0007-portable-candidate-knowledge-store.md)
for the CKB implementation contract, [ADR 0004](adr/0004-desktop-credential-boundary.md)
for desktop credentials, and [architecture](architecture.md) for system
boundaries.
