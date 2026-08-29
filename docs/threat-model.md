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

### Current opportunity-brief scope

The #67 contract separates opportunity facts from candidate instructions,
requires every structured field to cite known source identities, and prevents
candidate-instruction sources from establishing employer requirements or other
opportunity facts. Application-level intake reuses the existing approval,
HTTPS/SSRF, redirect, size, timeout, content-type, and stable-file controls for
approved URLs and selected files. It does not perform uncontrolled research.

The brief retains bounded provenance, including sensitive approved URLs and
captured-content checksums, but no raw source content or host paths. Failed or
inaccessible sources remain visible without fabricated checksums, and their
diagnostics omit paths, URL queries, source content, ingestion messages, and OS
errors. Duplicate captured bytes and partial results remain explicit review
issues. Editing and review create immutable versions in the local workspace
database. Composite workspace/brief/version identity, parent enforcement,
canonical checksums, and update/delete guards detect stale, conflicting, or
corrupted state; reload never refetches a source. Audit events use opaque brief
identity and content-free version/status/checksum metadata rather than copying
the sensitive payload. Explicitly approved extraction sends only sanitized
opportunity source IDs, classifications, statuses, media types, checksums, and
text through the configured author-provider adapter. Candidate inputs, URLs,
paths, and provenance stay local. Source text remains untrusted, tools and
research are unavailable, citations are allowlisted, malformed output fails
closed into a content-free issue, and extraction cannot alter provider policy,
permissions, or model selection.

Shared opportunity commands keep CLI file paths in runtime-only manifests and
resolve desktop files inside the native host. The strict renderer bridge
allowlists source descriptors, edit fields, versions, and approval intent; its
result projection omits paths, URLs, raw source text, and provenance objects.
Reload, list, edit, and review operate on durable versions without refetching
sources or invoking providers, and stale expected versions fail closed.

Run start accepts only an exact brief ID/version pair and requires the stored
record to be reviewed with a valid checksum. It derives opportunity context
only from that immutable record and retains a path- and URL-free reference in
the run snapshot. Resume cannot replace the selection, and later brief versions
do not mutate the pinned context. The existing explicit provider-transmission
approval remains independently required.

### Current writing-policy scope

The workspace writing policy is candidate-authored, untrusted style data.
Bounded content is stored locally as immutable, checksum-addressed versions;
ordinary status and history projections expose metadata only. The effective
version is captured in immutable run context and sent to author and critic only
through the existing provider-approval boundary. Rules and preferences cannot
override system instructions, evidence requirements, provider identity,
transmission policy, permissions, or tools.

Policy findings expose stable rule, section, block, and bounded position data
without reproducing the forbidden value, matched artifact content, source
paths, or context. Older content-only snapshots remain readable. Structured
tone, locale, verbosity, page target, section order, emphasis, and transparent
anti-formulaic defaults remain bounded advisory style data. A reviewed
opportunity may bind one imported version as a complete override; the run pins
base and override lineage, and the active workspace policy is not mutated.

### Current canonical-profile scope

Canonical profile facts are sensitive candidate data. Immutable versions are
stored only in workspace-local SQLite with canonical payload checksums,
immediate lineage, monotonic update timestamps, and update/delete triggers.
Every fact points to an exact selected CKB source version and requires
candidate-provided provenance. Persisted audit events exclude fact values,
issue messages, raw source content, URLs, and host paths.

The derivation boundary reads exact managed versions as fresh byte copies after
one-handle size, checksum, and identity verification; storage paths and URL or
origin metadata do not cross that boundary. It normalizes bounded content,
checks the lifecycle snapshot before extraction and again before persistence,
and requires explicit provider-data approval before reading or invoking the
extraction port. Source
text remains untrusted data. A strict proposal schema accepts only facts,
grounded evidence quotes with opaque citations, and issue relationships. A
quote must occur in its cited normalized source and contain the proposed value; it is discarded after local
verification; application code owns provenance, IDs, severity, messages,
duplicate/conflict detection, and visible omissions.

A configured-provider adapter now uses the existing author-provider policy and
auth boundary. Its system prompt treats normalized source text as untrusted,
its structured request contains no managed paths or CKB provenance, and the
strict response is still revalidated and grounded locally. No application,
run, CLI, or desktop operation invokes the adapter yet.

The service also cannot invalidate an immutable profile after source
retirement or deletion. Because one profile may combine CKBs, it is not copied
into a single CKB portable backup; whole-workspace database backups still
preserve it. Retention, deletion, run binding, and host adapter boundaries
remain open #66 work.

### Current CKB scope

The portable Candidate Knowledge Base (CKB) is a separate local plaintext
component with a logical UUID, lifecycle metadata, stable source identity,
immutable source-version metadata, and opaque managed raw bytes. Approved local
file intake and manual append enforce supported types, extraction, stable-file
checks, and the 20 MiB per-file limit. Approved directory intake is bounded;
its root and immutable normalized-relative-path membership hashes are sensitive
local state. Partial and legacy runtime-only imports have no directory binding.

Host paths, URL provenance, and membership hashes are not portable identity.
Generic manifests, provider requests, and content-free diagnostics exclude
them. Labels and checksums are local CKB metadata, but provider and content-free
surfaces exclude them too.

The shared application contract can bind path-free selection evidence to new
runs. CLI and desktop expose selection and bounded CKB metadata maintenance
without carrying roots through the desktop renderer boundary. Archival requires
explicit confirmation.

Single-file desktop intake uses a dedicated native picker, keeps the selected
path in the host, and returns only opaque source/version identity. Cancellation
performs no import, and ingestion failures use path-free diagnostics. URL intake
requires approval for each adapter request, preserves the centralized HTTPS and
network-safety boundary, and returns no URL, query string, label, or fetched
content through generic CLI or renderer results.

File-version append also keeps the selected path outside generic results and
renderer IPC. Atomic latest-version checks reject stale concurrent mutation; a
successful append does not replace the sensitive remembered origin binding.
Explicit file refresh uses only that remembered origin. URL refresh requires
fresh approval and preserves the existing SSRF, redirect, time, size, and
content limits.

Directory intake uses the same bounded application contract. The CLI root is
runtime-only, the desktop host owns the picker, and generic complete or partial
results contain only scan counts and capped opaque source/version identities.
Directory roots, filenames, membership hashes, and content remain local;
path-free status and refresh-state results omit origins and provenance.

No application run retrieves CKB content yet, so the existing workspace
evidence boundary remains authoritative. See
[ADR 0007](adr/0007-portable-candidate-knowledge-store.md),
[privacy policy](privacy-and-evaluation.md), and [architecture](architecture.md)
for ownership and exact contracts.

One-file origin rebind keeps the replacement path in runtime CLI input or the
native desktop host and succeeds only for stable bytes exactly matching the
current managed version. Generic results expose no origin or checksum.
Path-free retirement inspection and explicitly confirmed retirement expose
only logical state and time. Retirement is idempotent and preserves evidence;
it is neither physical deletion nor reversible through a current adapter.

Directory-root rebind has distinct preview and confirmed apply controls. Both
keep the candidate root in runtime CLI input or the native host and expose only
opaque identity, status, time, and counts. Apply does not trust preview state:
it repeats the bounded exact-membership scan, then storage atomically guards
the root revision and every member origin against races.

Directory refresh uses the sensitive remembered root entirely inside the
application and native host. Preview is read-only; apply requires explicit
confirmation before store access and repeats the bounded scan. Generic results
cap and sort opaque member/refreshed identities, report partial progress
explicitly, and omit paths, filenames, hashes, checksums, labels, and content.

Moved-candidate preview exposes only unique source identities and never target
paths. One-source move requires explicit confirmation, repeats the bounded
scan, and atomically guards the root, member revision, version, and origin.

Reconciliation apply requires explicit confirmation and source-ID retirement
selection. The application refuses incomplete scans and guards each logical
retirement; generic complete or partial progress remains path-free.

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

The selection boundary records only portable store, CKB, source, and version
IDs plus those safe revisions. It requires explicit approval before combining
CKBs and excludes runtime store roots. A workspace retains roots only in its
sensitive local manifest, pins logical store/CKB identities, and revalidates
readiness before each new run records a path-free snapshot. Provider-capable
start, resume, and revision operations also require the current canonical
entries to match the run's immutable record. CKB-content authorization and
retrieval-index drift checks remain separate controls.

The count-only structural inventory does not adopt or delete unknown entries.
Owned managed-write records do not retroactively claim legacy entries. Recovery
durably claims an eligible phase with a newer fencing generation before
inspecting artifacts, blocking stale journal and commit transactions. It acts
only on versioned records whose integrity and immutable staging identity are
verified; unknown, mismatched, or unjournaled residue remains untouched.

CLI and desktop can request this inventory, path-free source/version identity
summaries, and duplicate groups through the same read-only application
contracts. Adapter projections are bounded and omit roots, labels, filenames,
URLs, checksums, content, and relative-path hashes; separate calls can observe
different valid states if another local writer acts
between them. The [threat risks below](#ranked-abuse-paths) cover these
limitations without repeating the implementation chronology.

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
| Local file/directory → portable CKB           | Plaintext bytes, source identity, origins, labels, checksums, and lifecycle state | Opaque managed copies, immutable versions, sensitive bindings, path-free results, confirmed add/retirement controls                                          | Same-user processes and backups can read plaintext; reactivation, deletion, backup, and retrieval remain incomplete           |
| CKB filesystem → inventory/journal            | Unknown entries and ownership evidence                                            | Count-only inventory; versioned integrity and staging identity; durable recovery claim under a newer fencing generation; no shape-based adoption            | Unjournaled, legacy, mismatched, and unrecognized entries remain unknown and are preserved                                    |
| Application → local model endpoint            | Candidate data, credentials, and output                                           | Explicit adapter configuration and structured provider boundary; loopback policy for the `local` company                                                     | “Local” does not by itself prove identity, same-machine operation, or trustworthy retention                                   |
| Application → installed user-session runtime  | Context, local files, provider session, and process environment                   | Empty temporary directory, tools/customizations/MCP/web disabled where supported, bounded IO, structured output, no OAuth extraction                         | Vendor runtime and subscription behavior can change; output ceilings are not fully enforceable                                |
| Workspace history/retrieval → local storage   | Run metadata, evidence chunks, decisions, artifacts, and derived indexes          | Workspace identifiers, checksums, immutable records, scoped lexical retrieval, safe-payload validation                                                       | Host compromise, deletion bugs, and isolation mistakes can expose or mix data                                                 |
| CKB → approved backup/restore destination     | Candidate bytes, logical identity, provenance, and lifecycle metadata              | Explicit destination approval and collision policy; strict versioned manifest; verified allowlisted managed objects; no-replace publication; origins, locks, journals, credentials, and workspace data excluded | Hashes detect corruption but not authorship; exported and restored copies can outlive the source and remain readable to same-user processes |
| Backups/purge/diagnostics → copies            | Retained workspace data and operational metadata                                  | Explicit local operations, confirmed purge, content-free diagnostics                                                                                         | User backups, exports, and restored stores can outlive deletion                                                              |
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
| T-013 | High / medium         | Plaintext managed bytes or a copied CKB remain after the original or workspace is deleted.                                             | Opaque names; logical identity separate from host paths; explicit six-class retention policy; destination-approved portable export and restore exclude machine-local state.              | Same-user access remains possible; exported and restored copies need independent deletion, while derived-data cleanup remains unimplemented. |
| T-022 | High / medium         | A malformed, traversing, incomplete, or modified backup is accepted as a safe restore source, or export/restore overwrites an unrelated destination. | Strict manifest/version and safe-relative-name validation; bounded complete inventory; manifest/object hashes; symlink rejection; repeat inspection; explicit fail-if-existing publication. | Checksums do not authenticate the producer; merge/replace is unsupported, and unknown or unowned partial destinations are preserved. |
| T-014 | High / medium         | A label/checksum leaks information, duplicate evidence is treated as identity, or a configuration-like file becomes instruction.       | Content-free projections omit labels/checksums; duplicate signals are read-only and one-CKB-scoped; all candidate files remain inert data.                                             | Keep UI and diagnostics separate; require explicit lifecycle decisions and adversarial filename tests.                           |
| T-015 | High / medium         | A selected file changes during validation, copying, rebind, or one-source move.                                                        | Regular-file/type/size checks, stable capture, extraction, immutable copy, checksum/size verification, exact latest-version match, guarded handle.                                     | Same-user mutation races cannot be eliminated; retain boundary regression tests.                                                 |
| T-016 | Medium / high         | A crash or concurrent writer leaves an unreferenced blob or metadata without verified bytes.                                           | File-first/database-second publication, no-replace targets, managed markers, versioned owned-write records, durable recovery claims, fenced lease takeover, and deterministic retry.     | Legacy, unjournaled, mismatched, and unrecognized residue remains unknown and requires a separate user-visible decision.         |
| T-017 | Medium / medium       | Inventory leaks entry identity or is mistaken for cleanup authority.                                                                   | Bounded counts only; no names, IDs, paths, checksums, content, unknown-byte reads, recursion, symlink following, mutation, or provider exposure.                                       | Counts still reveal limited shape; scan limits can be incomplete and require separate diagnostics policy.                        |
| T-018 | Medium / medium       | A journal entry, matching bytes, or staging-shaped name is mistaken for ownership.                                                     | Recovery and retention require versioned ownership evidence; expiry plans and confirmed deletion act only on verified committed managed versions and preserve unknown or unmanaged data. | Keep exact-plan confirmation, under-lease revalidation, fail-closed blockers, and interruption recovery covered at every destructive boundary. |
| T-019 | High / medium         | A retired or otherwise ineligible source remains selectable/retrievable, or logical retirement is presented as deletion.                | Immutable retirement plus a consistent path-free readiness projection blocks retired, archived, stale/adverse, unmanaged, unbound, and directory-conflicted state while preserving evidence. Confirmed deletion is separately limited to archived non-default CKBs. | #80 must bind index state and queries to the projected revision; reactivation and derived-data deletion remain future work. |
| T-020 | High / medium         | Directory traversal follows a symlink, escapes its root, opens special/hidden files, exceeds limits, or writes after failed preflight. | Real non-symlink root, canonical containment, deterministic limits, skipped unsafe entries, complete extraction preflight, path-free results, guarded root rebind and one-source move. | Same-user races remain; additions/removals, automatic reconciliation, automatic deletion, and membership lifecycle are deferred. |
| T-021 | High / medium         | A run combines an unapproved CKB, records ambiguous source scope, accepts a replaced store, continues after lifecycle drift, or leaks a local store root through history. | Bindings pin logical identities; new runs record canonical path-free snapshots, and provider-capable operations revalidate and compare complete entries before execution or mutation. | Cross-store validation is not atomic; same-user writes can race the final check, and retrieval-index version checks remain under #80. |

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
- Automatic moved-origin inference, automatic retirement, retrieval integration,
  cross-store writer coordination, background refresh, and general cleanup or
  secure erasure beyond verified CKB-owned data remain deferred.
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
