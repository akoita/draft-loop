# Privacy and evaluation policy

DraftLoop treats candidate material and confidential employer information as
sensitive by default. The policy is intentionally conservative for the local
MVP: source material, evidence, drafts, and run history stay on the user's
machine unless the user explicitly approves a provider transmission.

## Data policy

| Data class                                                                                | Default location                                                                                                           | Provider transmission                                                                                    | Retention default                                                                                   |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Public                                                                                    | Local workspace                                                                                                            | Allowed only through an explicit request policy                                                          | Until the user deletes it                                                                           |
| Personal                                                                                  | Local workspace                                                                                                            | Explicit approval and provider allowlist required                                                        | Until the user deletes it                                                                           |
| Confidential employer                                                                     | Local workspace                                                                                                            | Explicit approval, acknowledgement, and allowlist required; user redaction rules recommended             | Until the user deletes it                                                                           |
| Portable CKB metadata, local origin bindings, managed-write journal, and raw source bytes | User-selected local plaintext store, separate from application workspaces and run history                                  | Not provider data; raw bytes, origin paths, journal, URLs, labels, and checksums must not be transmitted | Until the user removes the local store; complete deletion and secure erasure are not implemented    |
| Secret embedded in candidate material                                                     | Never place in source/evaluation fixtures                                                                                  | Not allowed as application content                                                                       | Do not retain                                                                                       |
| Provider credential                                                                       | Electron user-data credential store, provider SDK environment, or provider-managed local user session; never the workspace | Used only to authenticate an explicitly approved provider request                                        | Until the user removes it, the environment changes, the provider login ends, or app data is deleted |

The provider contract requires `allowTransmission`, an allowlisted provider
company, and an acknowledgement when a request is sensitive. Provider identity,
model identity, and requested retention are part of the visible run context. A
requested ephemeral policy is a user preference, not independent proof of a
provider's retention behavior.

The default retention object exported by `@draft-loop/security` is:

```text
local source: until deleted
run history: until deleted
provider retention: not allowed unless explicitly configured
```

The portable CKB store component persists its schema version, logical UUID,
creation time, CKB lifecycle metadata, stable CKB-scoped source identities, and
immutable ordered source-version metadata. A source records file/URL kind and a
local user-visible label; a version records SHA-256, media type, byte size, and
timestamp. For explicitly approved local regular files, it can also retain the
exact raw bytes under opaque names derived only from generated IDs. An explicit
application operation may approve one local file as a manual new version of an
existing file source. Initial intake and every append enforce the 20 MiB limit,
the five supported media types—plain text, Markdown, HTML, PDF, and DOCX—plus
successful extraction, stable-file checks, and verified managed copy. Changed
bytes create ordered parent-linked version N+1. Bytes identical to the current
version return a no-op, persist no new timestamp, and provide no freshness or
last-refresh evidence.

An explicit local application query can perform a bounded structural inventory
of `sources/` after normal validation of every referenced managed blob. It
returns only counts for verified managed files, scanned entries, staging-shaped
root files, other opaque root files/directories, extra entries inside expected
managed-source directories, symlinks, and special/other entries, together with
complete/scan-limit status. It returns no names, paths, IDs, labels, checksums,
or content. It does not follow unknown symlinks, recurse into unknown
directories, read unknown file bytes, mutate storage, or run automatically.
This is a local state query, not provider data or content-diagnostic automation.

SQLite migration version 7 adds an internal, append-only ownership journal for
new managed creates and appends. It records opaque intent before staging,
resolved-target selection before publication, publication and atomic
managed-marker/database-commit events, and completion only after staging cleanup. New staging names are opaque
operation-derived hashes. The journal contains no origin path, filename, label,
checksum, source content, provider data, diagnostic projection, cleanup token,
or approval. Journal identifiers remain internal and are excluded from the
application result and count-only inventory.

The initial managed import remembers the canonical physical origin path in
sensitive local-only SQLite state; a later selected append path never replaces
it, including for an identical no-op. This binding is copied with the SQLite
database but is not portable continuity, becomes stale when the store moves
machines or the origin moves/disappears, is not automatically updated, and is
never provider-facing. An explicit local application operation can classify one
source as unbound, current, changed, missing, or inaccessible. Its immutable
result contains source identity and observation time but no path, checksum,
media type, size, label, or content; the observation is not persisted and
current is not a freshness claim. Exact host paths remain excluded from
the manifest, descriptor, journal, inventory, diagnostics, application
serialization, provider requests, filename provenance, filename-derived
physical names, and URLs. A separate explicit local operation may refresh from
the remembered binding after the same no-follow, size, extraction, and
latest-version checks. Only changed bytes are passed through stable capture and
managed copy as a new immutable version; other statuses create no version. The
result contains no path or observed metadata/content, the binding is unchanged,
and a path-free last observation is persisted against the exact source version
examined. A changed-byte success also records the new version and refresh time;
the state exposes only bounded status, source/version identities, and
timestamps. It is not transmitted to providers and is not proof that an origin
remains unchanged. A later version advance derives `stale` until the next
explicit refresh. A separate explicit rebind
accepts one user-selected file, repeats ingestion and stable no-follow capture,
and replaces the sensitive local binding only when media type, checksum, and
size exactly match the latest managed version. It creates no version, blob, or
journal event, returns no path or integrity metadata, and deletes the superseded
path from current local state rather than retaining path history or mutating
refresh-observation state. Changed moved
content must first be appended explicitly. The store has no directory binding,
background refresh, time-based freshness policy, moved-origin
discovery, automatic duplicate resolution, normalized facts, or retrieval
indexes. A read-only, one-CKB-scoped duplicate projection compares only latest
version integrity metadata and returns source/version IDs without checksums,
labels, paths, URLs, content, or a derived group identifier. It is a current
possible-duplicate signal, not ownership proof or merge/deletion authority.
A separate explicit logical-retirement operation persists only source identity,
the bounded reason `user-requested`, and retirement time. It blocks subsequent
source mutations but preserves the managed bytes, immutable versions, origin
binding, refresh observation, and journal evidence. Retirement is therefore
not deletion or secure erasure, does not remove derived indexes or backups, and
must not be presented as such. No reactivation operation is currently exposed.
Source identity and label do not change when a later selected path or
basename differs.
Application workspaces continue to own their current evidence and run history,
and no CKB data is provider data.

The store path and any future import path are host configuration and are excluded
from portable records, provider requests, content-free audit data, and
diagnostics. Source labels may themselves reveal candidate information, and a
checksum can correlate a record with known content. They are appropriate for a
local user-facing CKB view, not a content-free diagnostic projection. Files with
names such as `AGENTS.md`, `.env`, or other configuration-like names remain
inert, untrusted candidate data during initial intake and version append; their
names or contents cannot become application instructions, executable
configuration, provider policy, or permissions.

The CKB SQLite file and managed raw blobs are plaintext. DraftLoop applies
restrictive permissions where supported, but permissions are best-effort and
are not encryption or a defense against another process running as the same
user. Users remain responsible for the privacy properties of the selected
directory, filesystem, device or cloud backups, and copies made outside
DraftLoop.

Managed publication is no-replace, file first, and database second. Storage
migration version 6 marks source versions that require verified managed bytes.
Ordinary failures clean up their files, while a crash or concurrent loser can
leave unreferenced opaque entries. Their names and layout provide no
authenticated evidence that DraftLoop owns or abandoned them. Inventory must
therefore not delete, adopt, quarantine, repair, or assign ownership. Safe
cleanup requires prospective journal evidence, coordination with active
writers, and explicit approval; unjournaled entries remain unknown. Version 7
supplies that prospective evidence for new writes, but it does not retroactively
claim legacy version-6 writes or authorize cleanup. Inventory also does not
repair missing or corrupt referenced blobs, which continue to fail normal store
validation.

The journal is not a cleanup token, approval record, provider-facing field, or
diagnostic projection. It does not delete, adopt, quarantine, repair,
reconcile, automatically scan, or coordinate concurrent writers through locks
or leases. Safe future cleanup still requires writer coordination and explicit
visible approval. Same-current-byte managed appends record a terminal,
non-owning no-op.
Metadata-only versions may be explicitly materialized under the managed-copy
checks, but matching bytes or shape never authorize adoption of a pre-existing
unowned target.

The application must show the data class, provider, model, and retention choice
before the first request containing source or draft material. A denied policy
must fail before the SDK call.

The desktop host computes a canonical provider-transmission preflight from the
current workspace configuration. It shows the Anthropic and OpenAI company,
model, and API endpoint identities; the requested ephemeral retention policy;
round, cost, and duration limits; and the exact allowed categories: job
description and requirements, a candidate source manifest, selected
candidate-source excerpts, and the current draft and structured findings. The
complete candidate corpus is explicitly excluded. A SHA-256 fingerprint binds acknowledgement to
that projection, so a provider, model, endpoint, retention, scope, or budget
change requires acknowledgement again.

For live workspaces, the main process stores only the fingerprint, timestamp,
and policy projection in
`.draft-loop/provider-transmission-acknowledgement.json`. It reloads the
workspace descriptor and this metadata before every provider-transmitting
start, resume, or revision and fails closed when either is invalid or stale.
The metadata contains no candidate content or credentials, and the
acknowledgement is visible in review event history. Demo workspaces remain
local-only and require no acknowledgement.

In the packaged desktop, a key entered in the renderer crosses the allowlisted
native bridge once and is persisted by the main process. The host prefers
Electron `safeStorage`; when unavailable it uses local AES-256-GCM ciphertext
and a separate local key protected by user file permissions. That fallback is
not equivalent to an operating-system secret store. Credentials must not enter
workspace history, backups, diagnostic exports, or provider request content.
See [ADR 0004](adr/0004-desktop-credential-boundary.md).

Experimental local user-session mode delegates a complete structured request
to an installed Codex or Claude runtime. DraftLoop does not extract or persist
those runtimes' OAuth credentials. The runtime and authentication mode are part
of the approved endpoint identity, and their retention preference is shown as
provider-default rather than API-style ephemeral retention. Tools, repository
instructions, extensions, MCP servers, web search, and local session
persistence are disabled where supported; an observed tool event fails the
request. See [ADR 0006](adr/0006-provider-authentication-modes.md).

Workspace backup, restore, retention purge, and diagnostic export are explicit
local operations. Purging the primary history does not prove deletion of copies
the user made through backups or exports; the product must disclose that scope
and keep diagnostic output content-free. Those existing operations apply to
application workspaces; they do not yet export, restore, or delete the separate
portable CKB store. Deleting the selected original or an application workspace
does not delete the managed CKB copy. A SQLite-only backup is not a complete CKB
backup because it omits managed raw blobs. Complete deletion across raw,
unknown, derived, backed-up, and exported data and CKB backup/export/restore
remain future privacy boundaries and must not be implied by managed-file intake
or manual version append. Repair, lock/lease writer coordination, cleanup and
approval UI, app/run CKB selection, indexing and retrieval, CLI or desktop
controls, and origin lifecycle reporting are likewise not integrated.

## Redaction and logging

Credential-shaped values are redacted by the deterministic rules in
`packages/security/src/index.ts`. The rules cover common private keys, bearer
tokens, provider key prefixes, and credential assignments. Confidential
employer names and project terms are not reliably detectable; a user or
deployment must supply explicit rules for those terms.

Operational events are an allowlist, not a general-purpose message logger.
Events may contain bounded identifiers, provider/model identity, status,
durations, usage, cost, and error codes. They always include
`contentRedacted: true`. Unknown fields such as `prompt`, `response`, `source`,
`document`, and arbitrary messages are dropped. Raw source, prompts, model
responses, credentials, and hidden chain-of-thought must not be written to
logs, audit records, test fixtures, or error messages.

Provider failures persist only a generic explanation plus safe code, provider,
model, workflow step, bounded attempt count, retry classification, and a provider
request identifier when supplied separately by the SDK. Provider response bodies
and exception messages are never copied into run history or the desktop view.

Packaged credential acceptance uses random, process-only synthetic canaries.
Sanitized evidence records platform metadata, the non-secret protection label,
boolean lifecycle results, and named leak checks; it does not contain canaries,
credentials, provider traffic, workspace data, or raw process output.

Structured evidence excerpts and user-visible rationale are product data, not
operational logs. They remain subject to local retention and the explicit
provider policy.

## Evaluation harness

The evaluation harness in `packages/evaluations` runs the same deterministic
readiness rubric over three variants:

1. `first-draft`, the initial generated artifact;
2. `revised-draft`, the artifact after the author–critic loop;
3. `manual-baseline`, the human-produced reference artifact.

The harness reports every readiness dimension, readiness status, structured
user-effort deltas, and revised-versus-baseline comparisons. The CI gate is
first-to-revised: a revised draft must not regress a dimension or readiness
under the configured tolerance. The manual baseline is a comparison reference,
not an automatically declared ground truth.

For the real-application gate, the harness can require a private reporting
scope and a content-free outcome record containing approval/export completion,
rounds, provider cost, user confidence, and bounded misleading-evidence and
prompt-injection observations. It also reports deterministic critical-
requirement coverage and unsupported-claim counts without copying source text.
Follow the [consented outcome pilot protocol](pilot-protocol.md); a synthetic
fixture or an incomplete outcome remains indeterminate evidence.

Fixtures must be synthetic and must not contain real candidate documents,
provider responses, credentials, employer secrets, or hidden reasoning. A
quality regression raises `EvaluationRegressionError`; security and quality
regressions are therefore deterministic test failures rather than review-only
warnings.

Evaluation scores are signals, not truth proofs. Evidence references,
deterministic validation, explicit disagreements, and human approval remain
required even when the revised artifact passes the rubric.

## Approval boundary

DraftLoop can prepare a local artifact, but it must not submit an application,
send a message, publish a document, or perform uncontrolled web research without
an explicit user action and a visible approval boundary.
