# Threat model

This page is the repository-grounded security baseline for DraftLoop. It is
written for anyone who changes a trust boundary or reviews a release, and it
lists what is protected, how, and what risk remains. It is not a claim that the
product is safe for every deployment. Revisit it whenever a boundary changes.
The [roadmap](../roadmap.md) records the current stage.

## Contents

- [Scope](#scope)
- [Assumptions](#assumptions)
- [Contract scopes](#contract-scopes)
- [Assets and trust boundaries](#assets-and-trust-boundaries)
- [Ranked abuse paths](#ranked-abuse-paths)
- [Hosted service: prompt injection through job posts and uploads](#hosted-service-prompt-injection-through-job-posts-and-uploads)
- [Runtime and build-time controls](#runtime-and-build-time-controls)
- [Open risks and review triggers](#open-risks-and-review-triggers)

## Scope

DraftLoop runs in four ways ([architecture overview](../architecture/overview.md#ways-to-run)).
This page covers the CLI and the engine every way shares. The server, its model
routes, the desktop client, the agent channel and the self-hosted stack are in
the [server threat model](server-threat-model.md).

| Way to run                | Covered here                                                                                              | Server boundaries                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| CLI and the shared engine | Fully: ingestion, the CKB, briefs, policies, profiles, retrieval, provider calls and exports              | none                                                        |
| Self-hosted server        | The shared engine, and prompt injection through job posts and uploads                                     | [Server threat model](server-threat-model.md)               |
| Hosted service (staging)  | The shared engine, and [prompt injection](#hosted-service-prompt-injection-through-job-posts-and-uploads) | [Server threat model](server-threat-model.md)               |
| Desktop client (alpha)    | The window boundary, in the table below                                                                   | [S-020 to S-022](server-threat-model.md#ranked-abuse-paths) |

The v0.8 desktop, with its own engine, renderer bridge and credential store, was
retired on 2026-11-04 (#2117–#2119), and its boundaries are no longer modelled.
DraftLoop has no browser extension and no job submission path.

## Assumptions

- **Network egress.** The CLI's network boundaries are approved Anthropic and
  OpenAI requests, the opt-in development providers, approved HTTPS URL intake
  and refresh, and an optional OpenAI-compatible local endpoint. The endpoint and
  its operator are part of the user's trust decision.
- **Credentials.** The CLI takes keys from SDK environment variables, or uses a
  provider-managed local session. Neither protects against a process that
  controls the same user account.
- **Untrusted inputs.** Source files, fetched pages, model output, exports,
  backups, diagnostics and retrieval indexes are sensitive or untrusted. Models
  and sources may contain errors or indirect instructions.
- **Data, not instructions.** DraftLoop treats source content as data, never as
  application policy or executable instructions.

## Contract scopes

Each contract below is canonical in
[Candidate evidence](../architecture/candidate-evidence.md). This section keeps
only the security properties that the threats rely on.

### Opportunity briefs

- **Facts versus instructions.** Opportunity facts and candidate instructions
  are kept apart (#67). Every structured field cites a known source, and
  candidate instructions can never establish an employer requirement.
- **Bounded intake.** Intake reuses the approval, HTTPS and SSRF, redirect,
  size, timeout, content-type and stable-file controls. There is no
  uncontrolled research.
- **What is stored.** Bounded provenance and checksums are stored, never raw
  source content or host paths.
- **Content-free failures.** Diagnostics omit paths, URL queries, content,
  ingestion messages and OS errors. Failed sources stay visible without a
  fabricated checksum.
- **Tamper-evident versions.** Composite identity, parent checks, canonical
  checksums and update and delete guards detect stale, conflicting or corrupted
  state. Reload never refetches a source.
- **Extraction.** Approved extraction sends only sanitized source records.
  Tools and research are unavailable, citations are allowlisted, and malformed
  output fails closed. Extraction cannot change provider policy, permissions or
  model selection.
- **Run binding.** A run takes only an exact reviewed brief ID and version with
  a valid checksum. Resume cannot replace it, and the provider-transmission
  approval is still required separately.

### Writing policies

- **Untrusted style data.** The policy is candidate-authored style data, stored
  as bounded, checksummed versions.
- **No authority.** Rules cannot override system instructions, evidence
  requirements, provider identity, transmission policy, permissions or tools.
- **Content-free findings.** Findings give rule, section and block positions,
  never the forbidden value or matched text.
- **Overrides.** A per-opportunity override is pinned in the run, and never
  changes the workspace policy.

### Canonical profiles

- **Sensitive data.** Profile facts are sensitive candidate data, stored only in
  workspace-local SQLite with checksums, lineage and immutable triggers. Audit
  events exclude values, messages, content, URLs and paths.
- **Verified reads.** Derivation reads exact managed versions as fresh,
  verified byte copies. Paths and origins never cross that boundary.
- **Checked before saving.** Derivation revalidates the lifecycle snapshot
  before extraction and again before saving, and needs explicit provider-data
  approval first.
- **Untrusted text.** Source text stays untrusted. A strict schema accepts only
  facts, grounded quotes with opaque citations, and issues.
- **Application-owned records.** The application owns provenance, IDs,
  severity, messages and conflict detection.
- **Fail closed on drift.** A profile whose CKB selection no longer matches
  cannot be reviewed or enter a run. Retirement, deletion, missing stores and
  changed versions therefore fail closed for future use, while history stays
  auditable.

### The portable CKB

- **A plaintext local store.** It has logical identity, immutable versions and
  opaque managed bytes.
- **Intake limits.** Intake enforces supported types, extraction, stable-file
  checks, a 20 MiB per-file limit, and bounded directory traversal.
- **Sensitive and local.** Host paths, URL provenance and membership hashes are
  not portable identity. Manifests, provider requests and diagnostics exclude
  them, and labels and checksums too.
- **Confirmed lifecycle actions.** Refresh, rebind, retirement, directory
  reconciliation and deletion are explicit and guarded, and each needs
  confirmation where it writes. Apply steps repeat their bounded scan and never
  trust preview state.
- **Ownership needs evidence.** File shape never proves ownership. Unknown,
  unjournaled or mismatched entries are preserved, and recovery acts only on
  verified, journalled records under a newer fencing generation.
- **Selection.** Indexing reads a frozen readiness projection, never the
  sensitive tables. A selection records only portable IDs and safe revisions,
  combining CKBs needs explicit approval, and runs revalidate readiness before
  each provider-capable step.
- **Retrieval.** Runs retrieve only exact selected source versions. Contracts
  are in [ADR 0007](../adr/0007-portable-candidate-knowledge-store.md) and
  [ADR 0008](../adr/0008-ckb-scoped-lexical-retrieval.md).

## Assets and trust boundaries

| Boundary                                        | Asset at risk                                                          | Current control                                                                                                                                                                                        | Residual concern                                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Selected files and approved pages → ingestion   | Career history, employer material, indirect instructions               | Explicit approval, type and size checks, extraction, source and evidence boundaries, bounded context, no autonomous tools                                                                              | Parsers and source text stay untrusted, and can carry prompt injection or edge cases                               |
| Workspace → model provider                      | Candidate context, prompts, drafts, provider identity                  | `DataExposurePolicy`, explicit `--allow-provider-data` per command, bounded scope, visible provider, model and endpoint, budgets                                                                       | Provider retention and training are external                                                                       |
| Workspace → approved URL                        | The URL, local network reachability, fetched bytes, provenance         | Explicit approval, HTTPS, literal and resolved-address checks, a connection pinned to the checked address, redirect, time, size and content limits, URL-free errors                                    | Tracking, malicious markup and sensitive query strings                                                             |
| Approved directory → CKB intake                 | Files, paths, traversal reachability, total size                       | A real non-symlink root outside the store, canonical containment, bounded deterministic traversal, no child symlinks or special entries, complete preflight                                            | Same-user mutation races; counts reveal limited shape; later changes do not reconcile automatically                |
| Local file or directory → portable CKB          | Plaintext bytes, identity, origins, labels, checksums, lifecycle state | Opaque managed copies, immutable versions, sensitive bindings, path-free results, confirmed add and retirement                                                                                         | Same-user processes and backups can read plaintext; reactivation is not built                                      |
| CKB filesystem → inventory and journal          | Unknown entries, ownership evidence                                    | Count-only inventory; versioned integrity and staging identity; durable recovery claims under a newer fencing generation; no shape-based adoption                                                      | Unjournaled, legacy, mismatched and unknown entries stay unknown and are kept                                      |
| Application → local model endpoint              | Candidate data, credentials, output                                    | Explicit adapter configuration, a structured provider boundary, a loopback policy for the `local` company                                                                                              | "Local" does not prove identity, same-machine operation or trustworthy retention                                   |
| Application → installed user-session runtime    | Context, local files, the provider session, the process environment    | Empty temporary directory, tools, customizations, MCP and web disabled where supported, bounded IO, structured output, no OAuth extraction                                                             | Vendor runtime and subscription behaviour can change; output ceilings are not fully enforceable                    |
| Workspace history and retrieval → local storage | Run metadata, evidence chunks, decisions, artifacts, derived indexes   | Workspace identifiers, checksums, immutable records, scoped lexical retrieval, safe-payload validation                                                                                                 | Host compromise, deletion bugs and isolation mistakes can expose or mix data                                       |
| CKB → approved backup or restore destination    | Candidate bytes, identity, provenance, lifecycle metadata              | Explicit destination approval and collision policy; strict versioned manifest; verified allowlisted objects; no-replace publication; origins, locks, journals, credentials and workspace data excluded | Hashes detect corruption, not authorship; copies can outlive the source and stay readable to same-user processes   |
| Backups, purge, diagnostics → copies            | Retained workspace data, operational metadata                          | Explicit local operations, confirmed purge, content-free diagnostics                                                                                                                                   | User backups, exports and restored stores can outlive deletion                                                     |
| Rendered artifact → viewer or export            | Links, markup, generated files                                         | Local rendering, controlled formats, checksum records, visible approval                                                                                                                                | Unsafe links, images, markup or viewers can create egress or spoofing                                              |
| Desktop client window → server                  | The owner token, the server's web screen                               | Loads only its server's origin; other links go to the system browser; other schemes refused; sandboxed page without Node or device permissions; token encrypted by the system keychain                 | See S-020 to S-022 in the [server threat model](server-threat-model.md); Linux without a keyring remembers nothing |
| Repository, CI, release → installed artifact    | Credentials, dependencies, build output, update trust                  | Secret-free fixtures, lockfile review, lint, type and test gates, scans, checksums, SBOM                                                                                                               | Unsigned installers, compromised dependencies, CI credentials or unsafe updates                                    |

## Ranked abuse paths

The ratings are qualitative priorities, not exploit likelihoods. A follow-up
must be done before its boundary is widened. IDs are stable, so a retired
threat keeps its number.

| ID    | Severity / confidence | Threat                                                                                                                                     | Current control                                                                                                                                                                                     | Residual risk / follow-up                                                                                         |
| ----- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| T-001 | High / high           | A file or fetched page injects instructions that produce unsupported claims or disclosure                                                  | Delimited source data, structured model ports, deterministic validation, bounded context, no autonomous tools. The hosted service adds screening and quarantine (below).                            | Keep adversarial fixtures for every source type, and review before enabling tools                                 |
| T-002 | High / high           | Sensitive material reaches an unapproved provider, model, endpoint or scope                                                                | `DataExposurePolicy`, explicit per-command approval, corpus exclusion, fail-closed stale policy. On the server, recorded transmission consent.                                                      | Keep provider-retention disclosures accurate                                                                      |
| T-003 | High / medium         | Prompts, responses, sources, credentials or confidential terms leak through logs, tests, diagnostics or errors                             | Allowlisted `contentRedacted` events, deterministic credential redaction, normalized errors, synthetic fixtures, safe-payload assertions                                                            | Route every diagnostic path through the allowlist, and add confidential-term rules                                |
| T-004 | Retired               | A compromised desktop renderer steals a stored provider credential                                                                         | Retired with the v0.8 desktop on 2026-11-04. The desktop client holds no provider keys.                                                                                                             | See the server threat model                                                                                       |
| T-005 | High / medium         | URL intake reaches a private service, an unsafe redirect, an excessive response or malicious markup                                        | HTTPS, literal and resolved-address checks, a connection pinned to the checked address, manual redirects with each hop re-checked, caps, content restrictions, exact-byte checks, URL-free failures | Continue redirect, parser and egress tests                                                                        |
| T-006 | High / medium         | A generated link, image, HTML fragment or export fetches remote content or spoofs trusted content                                          | Controlled rendering and visible export approval; external submission is out of scope                                                                                                               | Sanitize links and images, disable active content, and test supported viewers                                     |
| T-007 | Medium / high         | A provider, critic, malformed response or retry policy causes an unbounded loop or cost spike                                              | Round, cost, duration and attempt budgets; a per-call cost guard; bounded adapter retries; cancellation is non-retryable                                                                            | Keep deterministic timeout and restart tests                                                                      |
| T-008 | High / medium         | Data stays readable after a user believes history or a copy was deleted                                                                    | Explicit local purge, backup operations, content-free diagnostics, documented retention limits                                                                                                      | Define coverage for FTS, exports, backups, temp files and CKB copies on every platform                            |
| T-009 | High / medium         | Retrieval mixes workspaces, serves stale chunks, or keeps derived data after source deletion                                               | Workspace-scoped legacy queries; exact-version CKB indexes behind strict single-CKB scopes (migration 25); whole-projection invalidation on deletion; visible drift; content-free traces            | Prove lifecycle-triggered synchronization before vector or hybrid retrieval becomes a default                     |
| T-010 | High / medium         | A configured "local" endpoint is remote, malicious or impersonated                                                                         | Explicit endpoint policy; literal loopback host checks for the `local` company                                                                                                                      | Show and approve the exact endpoint identity; define authentication and certificate expectations                  |
| T-011 | High / medium         | A dependency, build workflow, installer or update path runs with local access                                                              | Pinned dependencies, lockfile review, secret and license scans, checksums, platform builds, SBOM; the desktop client's release check never downloads                                                | Add signed installers, provenance, verified update and rollback, and release-key procedures                       |
| T-012 | High / medium         | A subscription runtime loads tools, repository instructions, plugins or account settings beyond the request                                | Empty temporary directory, disabled tools, customizations, MCP and web, bounded output, rejected tool events, no OAuth copy                                                                         | Keep experimental until vendor terms, retention and enforceable budgets are tested                                |
| T-013 | High / medium         | Plaintext managed bytes or a copied CKB remain after the original or workspace is deleted                                                  | Opaque names; identity separate from paths; a six-class retention policy; destination-approved export and restore exclude machine-local state                                                       | Same-user access remains; exported and restored copies need their own deletion; derived-data cleanup is not built |
| T-014 | High / medium         | A label or checksum leaks information, a duplicate is treated as identity, or a config-like file becomes an instruction                    | Content-free projections omit labels and checksums; duplicate signals are read-only and per CKB; every candidate file is inert data                                                                 | Keep the screens and diagnostics separate; adversarial filename tests                                             |
| T-015 | High / medium         | A selected file changes during validation, copying, rebind or move                                                                         | Regular-file, type and size checks, stable capture, immutable copy, checksum and size verification, exact latest-version match, a guarded handle                                                    | Same-user races cannot be eliminated; keep boundary tests                                                         |
| T-016 | Medium / high         | A crash or concurrent writer leaves an unreferenced blob, or metadata without verified bytes                                               | File first and database second, no-replace targets, managed markers, versioned write records, durable recovery claims, fenced lease takeover, deterministic retry                                   | Legacy, unjournaled and unknown residue needs a separate visible decision                                         |
| T-017 | Medium / medium       | Inventory leaks entry identity, or is mistaken for cleanup authority                                                                       | Bounded counts only; no names, IDs, paths, checksums, content, unknown-byte reads, recursion, symlink following, mutation or provider exposure                                                      | Counts still reveal limited shape; scan limits can leave it incomplete                                            |
| T-018 | Medium / medium       | A journal entry, matching bytes or a staging-shaped name is mistaken for ownership                                                         | Recovery and retention need versioned ownership evidence; expiry plans and confirmed deletion act only on verified committed versions                                                               | Keep exact-plan confirmation, under-lease revalidation and interruption recovery at every destructive boundary    |
| T-019 | High / medium         | A retired or ineligible source stays selectable, or retirement is presented as deletion                                                    | Immutable retirement and a path-free readiness projection block ineligible state; deletion invalidates derived rows; confirmed deletion is limited to archived non-default CKBs                     | Reactivation is future work; same-user races remain                                                               |
| T-020 | High / medium         | Directory traversal follows a symlink, escapes its root, opens special or hidden files, exceeds limits, or writes after a failed preflight | Real non-symlink root, canonical containment, deterministic limits, skipped unsafe entries, complete preflight, guarded rebind and move                                                             | Same-user races remain; automatic reconciliation and deletion are deferred                                        |
| T-021 | High / medium         | A run combines an unapproved CKB, records ambiguous scope, accepts a replaced store, continues after drift, or leaks a store root          | Bindings pin logical identities; runs record path-free snapshots; provider-capable steps revalidate; retrieval binds to exact versions with content-free traces                                     | Cross-store validation is not atomic; same-user writes can race the final check                                   |
| T-022 | High / medium         | A malformed, traversing, incomplete or modified backup is accepted, or export or restore overwrites an unrelated destination               | Strict manifest and safe-name validation; complete bounded inventory; manifest and object hashes; symlink rejection; repeat inspection; fail-if-existing publication                                | Checksums do not authenticate the producer; merge and replace are unsupported                                     |

## Hosted service: prompt injection through job posts and uploads

A job post comes from a third party, and an upload may too. Either can carry
text that tries to steer the author or critic. It may override earlier
instructions, change the model's role, hide text from the reader, or plant a
link that exfiltrates the draft. The hosted service (ADR 0011, phase 2d) stops
such text before a model reads it. Screening is detection, not proof, so the
grounding checks and the candidate's approval stay in place behind it.

The routes and storage are in
[Hosted service](../architecture/hosted-service.md#intake-screening).

### Controls

- **Rule screener.** A deterministic screener in `packages/ingestion` always
  runs. It folds invisible characters, full-width forms, accents and Unicode tag
  characters before matching English and French patterns. It reports closed
  signal codes: instruction override, role change, hidden text and exfiltration
  link. It makes no model call.
- **Model screener.** With `DRAFT_LOOP_SCREENING=rules+model`, Claude Haiku 5.5
  on the EU Vertex route also classifies the text. A job post always goes to it.
  A candidate source goes only when the deployment allows provider data and the
  record's consent names Anthropic.
- **Fail closed.** A screener that fails, or an upload with no readable text,
  leaves the result `unscreened`, which is quarantined like `flagged`.
- **Quarantine.** The API refuses a run on quarantined material with 409
  `material_quarantined`. The worker asks the same question as it claims each
  job, so material flagged after queueing pauses the run before any provider
  call.
- **No result is not clear.** With screening on, material with no stored result
  also needs screening. That covers a source saved while screening was `off`, one
  that predates screening, and one whose result write failed. The API answers 409
  `material_unscreened`, and the worker pauses the run the same way.
- **Release with audit.** Only an owner or admin releases a result, once, with a
  written reason. A later flag quarantines the text again. The release appends a
  `content-screening.released` audit event, with ids and no text.
- **Content-free alerts.** Quarantine, release, a paused run and a refused
  access each log one `WARNING`, with ids and closed codes only.
- **Evidence.** A red-team flow test runs the synthetic corpus through the API.
  Every injected case, as a job post and as an upload, is quarantined by the
  rule screener, and no clean case is. A run on quarantined material is refused,
  a queued run pauses with no author or critic call, and one release lets a run
  finish with its audit event.

### Remaining gaps

- **The worker reads its own text.** The API screens the text it extracts from
  an upload, and the worker may extract slightly different text from the same
  file. The worker screens nothing and only checks stored results. Screening the
  exact text the worker reads is a follow-up.
- **Model screening is not deployed everywhere.** It runs only where Claude on
  Vertex AI in the EU is available to the API. Staging and production keep rules
  mode until then, so paraphrased or other-language injection is not caught by a
  model.
- **Brief edits are not re-screened.** A member types them, and they reach the
  author unscreened.
- **Prompts are unchanged.** The author and critic prompts carry no extra
  hardening until a D16 evaluation run shows it does not cost quality. Delimited
  source data, schema-only outputs and grounding validation are the second line.

## Runtime and build-time controls

**Runtime controls** reduce impact. They do not make model output or the local
machine authoritative.

- **Egress.** Provider egress is denied by default.
- **Approvals.** Every transmitting command needs explicit approval. On the
  server, the start, resume or revision needs recorded consent.
- **Intake.** URL and local-file intake need explicit approval.
- **Visibility.** Provider diversity is visible.
- **The loop.** Orchestration is bounded, with structured outputs, source
  references and human approval.
- **Data.** Retention is local, and operational events are content-free.

**The `local` company** is accepted only for an `http` or `https` endpoint
whose literal host is `localhost`, `::1` or in `127.0.0.0/8`, without embedded
credentials.

- **Literal hosts only.** A host that merely resolves to loopback is rejected.
- **Checked on create and load.** The workspace configuration is checked at
  creation and at load, so a hand-edited endpoint cannot silently change trust.

**CKB configuration.** The store path, selected roots and manual-append paths
are local configuration.

- **Sensitive tables only.** Origins, URL provenance, root bindings, labels and
  membership hashes live only in deliberate sensitive local tables.
- **Not provider data.** No CKB data is provider data, and no file shape proves
  ownership.
- **Runtime-only targets.** Root rebind and member move use bounded scans and a
  stable final check, and their target paths stay runtime-only.

**Build-time controls.**

- strict TypeScript and schema validation
- linting and deterministic tests
- lockfile review and secret-free fixtures
- security scans and release contract tests
- checksums and SBOM generation
- evaluation regression tests

CI must fail when a redaction, storage, provider-policy, URL-ingestion,
credential-boundary or quality invariant regresses.

## Open risks and review triggers

These risks remain open now:

- **Server boundaries.** The server's open gaps are listed in the
  [server threat model](server-threat-model.md#residual-risks-and-follow-ups).
- **Provider terms.** Provider retention and training settings need
  verification, and accurate disclosure to users.
- **URL fetching** needs continuing SSRF, redirect, DNS, parser and egress review
  whenever sources or formats expand.
- **Retrieval.** Deletion, rebuild, provenance and workspace isolation need
  integrated proof before vector or hybrid retrieval becomes a default.
- **Deferred CKB work.** Automatic move inference, automatic retirement,
  cross-store writer coordination, background refresh, and cleanup or secure
  erasure beyond verified CKB-owned data.
- **Local storage policy.** Plaintext permissions, copied stores, missing or
  corrupt blobs, writer coordination, cleanup approval, migration rollback and
  backup destinations need explicit policy and platform evidence.
- **Releases.** Signed desktop client updates, installer permissions and
  release-key response need a deployment review.

Each new trust boundary needs a review before it ships. Examples are remote
retrieval, browser access, autonomous tools and job submission.

Related pages:

- [Privacy and evaluation](privacy-and-evaluation.md): retention, redaction,
  logging and evaluation
- [ADR 0007](../adr/0007-portable-candidate-knowledge-store.md): the CKB contract
- [Architecture overview](../architecture/overview.md): system boundaries
