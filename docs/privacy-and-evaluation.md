# Privacy and evaluation policy

DraftLoop treats candidate material and confidential employer information as
sensitive by default. The current roadmap stage is **Evidence-backed CV
drafting**. This alpha is local-first: source material, evidence, drafts, and
run history stay on the user's machine unless the user explicitly approves a
provider transmission.

## Data classes and defaults

| Data class                              | Default location                                                                                                      | Provider boundary                                                                                     | Retention default                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Public material                         | Local application workspace                                                                                           | Only through an explicit request policy                                                               | Until the user deletes it                                                             |
| Personal material                       | Local application workspace                                                                                           | Explicit approval and provider allowlist required                                                     | Until the user deletes it                                                             |
| Confidential employer material          | Local application workspace                                                                                           | Explicit approval, acknowledgement, and provider allowlist required; user redaction rules recommended | Until the user deletes it                                                             |
| Structured opportunity brief            | Local application workspace and immutable run context reference                                                        | Only an explicitly selected, checksum-verified reviewed version may enter provider-facing run context  | Until the user deletes it                                                             |
| Candidate writing policy                 | Explicitly selected local workspace file and immutable run context                                                     | Included with author and critic context only after the existing provider approval boundary             | Workspace copy and run history remain until the user deletes them                     |
| Portable CKB metadata and managed bytes | User-selected, separate local plaintext store                                                                         | Not provider data; paths, URLs, labels, checksums, membership, and journal data stay local            | All six policy classes default to retention until explicit deletion                    |
| Secrets embedded in candidate material  | Never place in application content or fixtures                                                                        | Prohibited                                                                                            | Do not retain                                                                         |
| Provider credentials                    | OS credential store, desktop user-data store, SDK environment, or provider-managed local session; never the workspace | Used only to authenticate an explicitly approved request                                              | Until the user removes it, changes environment, ends the session, or deletes app data |

The provider contract requires `allowTransmission`, an allowlisted provider
company, and an acknowledgement for sensitive requests. Provider identity,
model identity, endpoint, scope, budgets, and requested retention are visible in
the run context. An ephemeral preference is a user choice, not proof of a
provider's retention behavior.

The default retention object exported by `@draft-loop/security` is:

```text
local source: until deleted
run history: until deleted
provider retention: not allowed unless explicitly configured
```

## Opportunity brief handling

The opportunity components define a strict local data contract and an
application-level intake boundary. One draft can ingest explicitly approved
HTTPS URLs, selected local files, pasted content, and direct candidate
instructions through existing bounded controls. The resulting brief stores
structured fields, source-linked provenance metadata, and captured-content
checksums without raw source content or host paths. Approved-URL provenance can
contain confidential URLs and therefore remains sensitive local state.
Candidate instructions are typed separately from opportunity facts and cannot
establish role, employer, responsibility, requirement, or priority fields.
Typed tone, application-goal, forbidden-language, and focus-area values are
merged locally and are never included in opportunity extraction requests.

When the user explicitly approves provider transmission, normalized text from
available, partial, or stale opportunity sources may be sent transiently to the
configured author provider for structured extraction. Requests omit URLs,
paths, provenance objects, and candidate-input material. DraftLoop validates
the strict response schema and every cited source ID, assigns deterministic
application IDs, and stores no raw provider request or response in the brief.

Drafts keep source failures, staleness, partial results, duplicates, and
contradictions visible. An unavailable source has no fabricated content
checksum, and content-free diagnostics do not repeat a path, URL query, raw
content, ingestion message, or operating-system error. Review requires explicit
acknowledgement or resolution of open issues, but acknowledgement does not
erase the limitation. Immutable versions are stored in the local workspace
database with canonical checksums and can be reloaded after restart without
refetching any source. Append-only audit records contain only opaque identity,
version, status, and checksum metadata; they do not duplicate brief content or
source provenance. Shared CLI commands and packaged-desktop host capabilities
can now create, reload, list, edit, and review these versions. CLI file paths
remain runtime-only; desktop file paths stay behind native pickers, and
renderer results omit paths, URLs, raw source text, and provenance objects. No
run implicitly selects the latest brief. `start` can bind one explicit reviewed
brief ID and version after verifying its checksum; the immutable run context
stores only the safe ID/version/checksum reference and reviewed structured
content. Resume reuses that snapshot, so later edits cannot change the run.

## Candidate writing policy handling

The candidate explicitly imports or activates each local writing-policy file.
DraftLoop stores bounded, immutable, checksum-addressed versions in local
SQLite history; safe default views show metadata rather than content. Exact
content is returned only by an explicit local content-read action. Direct
changes to the managed active file are captured as a new version before a run.

Compiled forbidden-term and punctuation rules, tone, spelling locale,
verbosity, page target, section order, emphasis areas, and transparent
anti-formulaic defaults travel with the effective policy to author and critic
only after provider transmission approval. Preferences are advisory: they do
not perform spell checking, create a numeric layout guarantee, or authorize
unsupported claims.

Local validation reports rule identity and section/block coordinates without
copying the forbidden value, matched artifact text, nearby text, or source
paths into diagnostics. Policy instructions remain style data: they cannot
authorize provider access, select models, enable tools, create candidate facts,
or relax truthfulness and evidence controls. A run-specific override must be
an imported immutable version bound to one exact reviewed opportunity. The run
records base and override lineage, while the workspace's active policy remains
unchanged.

## Canonical candidate profile handling

Canonical profile versions are stored in workspace-local SQLite as immutable,
checksum-verified payloads bound to exact path-free CKB store, base, source,
and source-version identities. Every fact requires candidate-provided
provenance; optional public corroboration remains distinguishable. Storage
audit events contain only opaque identity, version, status, lineage, schema,
and checksum metadata rather than fact values or issue messages.

The current application services can persist, reload, edit, review, and derive
draft versions from exact managed CKB source versions. Managed content is read
through fresh integrity-verified byte copies; roots, managed paths, URL
provenance, and origin bindings never enter the extraction request or profile.
The derivation service refuses to read or invoke its extraction port until the
caller explicitly approves provider data transmission. The approved request
contains bounded normalized candidate text, media types, checksums, and opaque
application-owned source IDs. Provider output is strict and cannot author
persisted provenance, status, severity, messages, or identifiers.
Every proposed fact must cite a quote that occurs in the corresponding
normalized source and contains the proposed value. The application verifies that grounding before mapping the
citation to exact CKB provenance, then discards the quote rather than storing
another copy of candidate text.

A configured-provider adapter can now execute the strict extraction request
through the workspace's author model after explicit approval. It supports the
existing API-key, authenticated user-session, and local transports, and sends
only the bounded path-free source fields already owned by the extraction port.
Provider output still passes the local schema and grounding checks before it
can become a profile version.

The shared application boundary can now derive, reload, list, edit, and review
profile versions. Derivation resolves the workspace's pinned CKB selection only
inside the local driver and revalidates its store identities before reading;
adapter-neutral commands and results contain no store roots. Reads, history,
edits, and review do not invoke a provider.

CLI commands now invoke these operations without accepting a CKB store root.
Derivation requires an explicit provider-data flag; local reload, history,
edit, and review commands do not cross the provider boundary. The packaged
desktop host exposes equivalent path-free capabilities against the active
workspace. Its renderer result is an explicit bounded projection of facts,
issues, and opaque provenance references; it omits the stored CKB selection
snapshot and any future unrecognized fields.

New runs may bind one exact reviewed profile by opaque ID and version. The
local driver verifies its checksum and requires the stored CKB selection to
match the workspace's current lifecycle-ready selection before recording only
the safe reference in immutable context. Resume cannot replace it. The same
availability check blocks a draft from becoming reviewed after a referenced
source retires, disappears, or changes selection.

Lifecycle changes do not erase immutable profile history, existing run
references, or approved export records. Cross-CKB profiles remain absent from
single-CKB portable backups, while whole-workspace database backup and restore
preserve profiles and exports; workspace retention currently removes eligible
audit events only. Exact-source retrieval indexes are rebuilt on demand from
the current lifecycle-ready selection and invalidated with their source data. The
collecting desktop workspace provides a dedicated editor over the bounded
path-free host projection. It preserves opaque provenance while changing fact
values or issue status, requires explicit transmission approval for
derivation, and sends only the selected reviewed profile ID/version pair when
starting a run.

## Local Candidate Knowledge Base handling

The portable Candidate Knowledge Base (CKB) is a separate local component. It
stores a logical CKB identity, source identity, immutable source versions, and
approved managed bytes. An application workspace may bind an explicit CKB
selection and record its path-free source/version identities in new immutable
run contexts. Runs with that selection query only its exact source versions and
send only the selected bounded excerpts with opaque chunk IDs to providers.
[ADR 0007](adr/0007-portable-candidate-knowledge-store.md)
defines the storage contract. [ADR 0008](adr/0008-ckb-scoped-lexical-retrieval.md)
defines the retrieval boundary. SQLite migration 25 implements the replaceable
exact-source-version CKB index and immutable content-free workspace trace
stores. Multi-CKB queries open only the explicit workspace selection and expose
stale or unindexed status rather than silently supplying empty context. The
[threat model](threat-model.md) records the security risks
and residual limitations.

Explicit CKB URL intake is a local acquisition action, not provider
transmission. The user must approve each adapter request before retrieval. The
shared HTTPS and network-safety boundary validates and fetches the URL, while
CLI output and desktop renderer results expose only opaque source/version
identity and creation status. URL provenance and fetched bytes remain inside
the sensitive local CKB store.

Explicit file-version append is also local-only. A CLI path is runtime input,
and the desktop path remains inside the native picker/host boundary. Neither is
persisted as a replacement origin or included in generic output. Changed bytes
become an immutable managed version; identical current bytes create nothing.

Explicit directory intake is local-only and bounded by the shared ingestion
limits. The CLI accepts the selected root as runtime input; desktop renderer
messages request a native picker without carrying a path. Complete and partial
results expose scan counts and capped opaque source/version identities only.
Directory roots, filenames, membership hashes, labels, checksums, and content
remain sensitive local state.

File-origin rebind is local-only. The CLI accepts the replacement path for one
invocation, while the desktop host owns the native picker. The application
requires stable bytes exactly matching the current managed version before it
updates the sensitive binding; generic results expose only opaque identity,
status, and a timestamp. Retirement state is likewise path-free. Explicitly
confirmed retirement is logical and idempotent: it blocks later mutation but
does not delete bytes or metadata, and no reactivation control exists.

Directory-root rebind is local-only. Preview and confirmed apply each receive
one selected root as runtime CLI input or through the native desktop picker;
the path never crosses renderer IPC or appears in generic output. Preview is
read-only. Apply performs a fresh bounded exact-membership scan and uses atomic
revision and origin guards, returning only opaque directory identity, status,
time, and counts.

Directory refresh is local-only and never accepts or returns the remembered
root. Preview exposes only opaque member identity, lifecycle status, time, and
bounded scan counts. Confirmed apply performs its own scan, records local
observations, and may append changed managed bytes. Complete or partial results
contain only capped opaque source identities and status; filenames, roots,
hashes, checksums, labels, and content remain local.

Moved-candidate preview and confirmed one-source member move are local-only.
They derive a unique exact-integrity match from one bounded scan without
accepting a replacement path. Generic results contain only opaque identities,
time, status, and scan counts; paths and integrity tuples remain local.

Directory reconciliation exposes only opaque member identities, statuses, and
counts. Confirmed apply forwards only explicitly approved source IDs and returns
bounded applied/already-retired/failed identities; local paths remain private.

Origin status and refresh-state results are content-free. They expose only
opaque source/version identity, lifecycle status, and timestamps. Explicit file
refresh reads the sensitive remembered local origin without returning it. URL
refresh requires approval for each request; its URL provenance, redirects, and
fetched bytes remain local even when the result is `inaccessible`.

### Managed bytes and immutable versions

Intake and manual append require explicit approval for one local regular file,
successful extraction, stable-file checks, supported media type, a 20 MiB
per-file limit, and verified managed copying. Supported types are plain text,
Markdown, HTML, PDF, and DOCX. Managed raw bytes use opaque names derived from
generated IDs. Changed bytes create an ordered parent-linked immutable version;
bytes equal to the current version are a no-op and do not establish freshness.

Publication is file-first and database-second, with no-replace targets. A crash
or concurrent writer can still leave an unreferenced opaque entry. Structural
inventory is count-only and never treats a filename, byte match, or staging
shape as ownership evidence. The prospective managed-write journal does not
retroactively claim legacy entries and is not a cleanup token. Unknown entries
remain unknown: missing-member reconciliation can retire only historical
members selected by source ID and never adopts or cleans up an unrecognized
managed-store entry.

### Sensitive origins, URLs, labels, and paths

Host paths are not logical identity. Exact file origins, selected directory
roots, URL provenance, and normalized relative-path hashes are sensitive local
state excluded from generic manifests, provider requests, content-free
diagnostics, inventory results, errors, and generic audit records. Source labels
and checksums are local CKB metadata, but they are also excluded from provider
and content-free surfaces because labels can reveal candidate information and
checksums can correlate known content. URL failures never echo query strings.

The CKB SQLite file and managed raw blobs are plaintext. Restrictive local
permissions are applied where supported, but they are best-effort and do not
protect against another process running as the same user. Files named like
`AGENTS.md`, `.env`, or other configuration-like files remain inert,
untrusted candidate data. Their names and contents cannot become application
instructions, executable configuration, provider policy, or permissions.

### Explicit directory and source lifecycle actions

An approved directory is only a bounded convenience selector, not a live
directory source. The selected root must be a real non-symlink directory outside
the CKB store. Traversal uses canonical containment and deterministic lexical
order, with limits on depth, scanned entries, accepted files, aggregate bytes,
and per-file size. Child symlinks, special entries, dot-prefixed entries and
subtrees, and unsupported files are skipped without opening them. Extraction
preflight completes before managed writes begin.

A complete import stores the canonical root and immutable membership hashes in
sensitive local tables; partial and legacy runtime-only imports have no
directory binding. Membership is historical evidence captured at binding or
explicit add time. Later version append, origin rebind, or retirement does not
rewrite it. A path-free preview can report bounded member states and unmatched
files without writing. Explicit add-members appends unmatched accepted files;
applied directory refresh handles only existing active same-member changed
files. Automatic rename inference, reconciliation of unknown entries,
background refresh, and automatic deletion remain deferred.

Shared add-member controls require explicit confirmation and keep the remembered
root local. Complete or partial results expose only bounded opaque source IDs,
member states, and scan counts; paths, labels, hashes, and content stay local.

Root rebind is a separate explicit operation. It performs one complete bounded
scan, stable per-member final verification, and one guarded all-member origin
commit or same-root no-op; it does not revise membership.

The bounded moved-candidate evidence compares exact media type, checksum, and
size for eligible same-member missing sources and unmatched accepted files.
It omits ambiguous matches and does not infer ownership from names, ordering,
text, or path similarity. The implemented one-source application command
accepts only the selected source identity, derives a unique target from one
bounded local scan, and retains that target path only in runtime memory. It
uses the same guarded local handle for the move and an already-current no-op,
and maps failures to a path-free error. The store persists only the sensitive
origin binding and append-only member revision; its public result exposes no
path, filename, checksum, content, integrity tuple, or version identity.
Automatic move inference and cleanup remain deferred.

An explicit retirement action can logically retire one approved fresh-scan
missing member with the bounded reason `user-requested`. Complete
reconciliation still requires an explicit source-ID selection for every member
to retire; moved-candidate evidence is advisory and may be explicitly retired
rather than treated as proof of identity. Selected sources are processed in
deterministic order. Each marker is atomic, and a later failure returns only
path-free partial IDs while preserving earlier markers. Incomplete scans write
nothing. Retirement does not delete bytes, versions, bindings, observations,
journal state, indexes, backups, or membership. It is not secure erasure, and
no reactivation operation is currently exposed.

Lifecycle readiness is recomputed from persisted evidence in one CKB-scoped
snapshot. Its public surface contains only CKB/source/latest-version identities,
bounded readiness state and reasons, safe lifecycle timestamps, and structured
numeric revision evidence. It excludes labels, paths, filenames, URLs,
relative-path hashes, content checksums, media types, byte sizes, and content.
Fresh explicit intake can be ready without a later observation; stale,
changed, missing, inaccessible, and unbound observations block but do not become
time-based freshness claims. The projection neither reads live origins nor
modifies sources or indexes.

An explicit selection snapshot may retain only the portable store ID, CKB ID,
exact selected source/version IDs, capture time, and the same safe structured
lifecycle revision. Combining more than one CKB requires a separate explicit
approval before opening a store. Store roots, human-readable source-identifying
fields, and content-derived fields remain outside the snapshot. The record is
audit and future drift evidence, not consent to transmit content to a provider.

Runtime store roots are retained only in the sensitive local workspace manifest
so new runs can reopen the stores. They are excluded from workspace
descriptors, context snapshots, run history, diagnostics, and provider
requests. A new run revalidates readiness and logical identity before recording
its snapshot; an existing run keeps its original immutable record. Before
provider-capable start, resume, or revision operations, DraftLoop compares a
fresh path-free projection from the current local binding with that record.
Drift requires review before provider execution and does not add roots or
selection metadata to the provider request.

An approved HTTPS URL is subject to public-address and redirect validation,
time, response, text-size, content-type, and extraction limits. Exact fetched
bytes and original/final URL provenance remain sensitive local state. A new
approval is required for refresh; changed bytes append a version, identical
bytes are current, and an approved fetch or extraction failure records only a
URL-free `inaccessible` observation. Redirect history, conditional requests,
automatic refresh, and provider transmission remain out of scope.

## Credentials and provider approval

Before the first request containing source or draft material, the application
must show the data class, provider, model, endpoint, allowed context, and
retention choice. A denied or stale policy fails before the SDK call. The
desktop host fingerprints this projection, stores only the fingerprint,
timestamp, and safe policy metadata, and reloads current workspace
configuration before every provider-transmitting start, resume, or revision.
The complete candidate corpus is excluded from the approved context.

In the packaged desktop, a key crosses the allowlisted native bridge once and
is persisted by the Electron main process. The host prefers `safeStorage`; when
unavailable it uses local AES-256-GCM ciphertext and a separate local key
protected by file permissions. The fallback is not equivalent to an OS-backed
secret store. Credentials never enter workspace history, backups, diagnostics,
or provider content. See [ADR 0004](adr/0004-desktop-credential-boundary.md).

Experimental local user-session mode delegates a structured request to an
installed Codex or Claude runtime without extracting or persisting its OAuth
credentials. The runtime, authentication mode, and provider-default retention
are visible in the approved endpoint identity. Tools, repository instructions,
extensions, MCP servers, web search, and local session persistence are disabled
where supported; an observed tool event fails the request. See
[ADR 0006](adr/0006-provider-authentication-modes.md).

## Retention, deletion, and backups

Workspace backup, restore, retention purge, and diagnostic export are explicit
local operations. Purging primary history does not prove deletion of copies in
backups or exports, and diagnostics remain content-free. These operations do
not yet export, restore, or delete the separate portable CKB store. Deleting an
original file or application workspace does not delete its managed CKB copy; a
SQLite-only backup is incomplete because it omits managed raw blobs.

The portable CKB records an explicit local policy for raw sources, normalized
facts, indexes, run snapshots, exports, and backups. Every class defaults to
`retain-until-deletion`; bounded day-based expiry must be configured explicitly.
Legal hold and manual preservation take precedence over expiry. Policy
inspection and planning expose only effective rules and bounded counts. At
present, only committed managed raw-source versions have enough CKB-local
ownership evidence to be marked expiry-eligible. Unmanaged or unknown entries
and the five not-yet-materialized classes are preserved. Planning is read-only.
Confirmed deletion is a separate approved operation for an archived non-default
CKB: it requires the exact token from a fresh plan, revalidates retention
revisions and physical ownership under the store-wide lease, and deletes only
ownership-proven managed records and blobs. Legal hold, manual preservation,
unmanaged database records, missing or mismatched blobs, and unknown deletion
state block it. Unknown filesystem entries remain untouched.

Portable CKB export is an explicit local operation with a separately approved
destination. It produces a versioned directory package only when every required
managed source object and the bounded ownership inventory can be verified. The
package preserves logical store, CKB, source, version, provenance, retirement,
and retention state needed by a later restore, but excludes original file and
directory paths, active locks, writer/recovery journals, application/provider
credentials, and unrelated workspace or run data. Restored file bindings must
therefore be selected again. Manifest and object hashes detect corruption or
modification; they are not signatures and do not establish package authorship.

Restore requires separate approval for a new destination and an explicit
fail-if-existing collision decision. It verifies the complete package before
writing, preserves logical identities and safe provenance, and creates no file,
directory, or active-ownership binding. Restored URL provenance contains only
the already-exported fetch time and classification; original and final URLs are
not reconstructed. Directory membership and host-binding history stay omitted,
so every restored source is unbound. Legacy or otherwise unmanaged source
versions block export because DraftLoop cannot prove it captured their bytes
completely.

Confirmed CKB deletion does not claim secure erasure or deletion of every copy.
It covers the selected archived CKB's current logical graph and verified managed
raw blobs only. The other retention classes are not yet materialized in this
store, and unknown data is deliberately preserved. Retrieval-index lifecycle,
general cleanup, and repair of missing blobs remain future privacy boundaries.
Users remain responsible for selected directories, filesystems, devices, cloud
backups, exported packages, restored stores, and copies made outside DraftLoop.

## Redaction and logging

Credential-shaped values are redacted by the deterministic rules in
`packages/security/src/index.ts`, including common private keys, bearer tokens,
provider key prefixes, and credential assignments. Confidential employer terms
are not reliably detectable; users or deployments must provide explicit rules
for those terms.

Operational events are allowlisted and always carry `contentRedacted: true`.
They may contain bounded identifiers, provider/model identity, status, duration,
usage, cost, safe error codes, retry classification, and a separately supplied
provider request identifier. Prompts, responses, source content, credentials,
confidential terms, and hidden chain-of-thought must not enter logs, audit
records, fixtures, or error messages. Provider failures persist only generic
safe explanations.

Packaged credential checks use random process-only synthetic canaries. Sanitized
evidence records platform metadata, a non-secret protection label, booleans, and
named leak checks; it contains no canaries, credentials, provider traffic,
workspace data, or raw process output. Evidence excerpts and user-visible
rationale are product data and remain subject to local retention and provider
policy.

## Evaluation harness

`packages/evaluations` applies the same deterministic readiness rubric to three
variants: `first-draft`, `revised-draft` after the author–critic loop, and
`manual-baseline`. It reports each dimension, readiness status, user-effort
deltas, and revised-versus-baseline comparisons. The CI gate is first-to-
revised: configured tolerances must not allow a revised draft to regress a
dimension. The manual baseline is a comparison reference, not automatic truth.

For a consented real-application outcome, the harness may record only a private,
content-free result: approval/export completion, round count, provider cost,
user confidence, misleading-evidence observations, prompt-injection
observations, critical-requirement coverage, and unsupported-claim counts. A
synthetic fixture or incomplete outcome is indeterminate evidence; follow the
[consented outcome pilot protocol](pilot-protocol.md).

Fixtures must be synthetic and contain no real candidate documents, provider
responses, credentials, employer secrets, or hidden reasoning. A quality
regression raises `EvaluationRegressionError`, making security and quality
regressions deterministic test failures. Evaluation scores are signals, not
fact verification; source references, deterministic validation, explicit
disagreements, and human approval remain required.

## Approval boundary

DraftLoop prepares local artifacts. It must not submit an application, send a
message, publish a document, or perform uncontrolled web research without an
explicit user action and a visible approval boundary.
