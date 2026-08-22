# Product vision and roadmap

**Status:** Living document
**Last reviewed:** 2026-08-22
**Current stage:** Evidence-backed CV drafting

This document describes product direction, not fixed delivery dates. The
**Now** horizon is the current commitment; **Next** is planned but may change
after technical discovery or pilot evidence; **Later** is directional. Update
the review date and the change log whenever priorities materially change.

## Vision

DraftLoop helps a candidate produce a job-specific CV that is relevant,
source-traceable, and genuinely theirs. Independent author and critic agents can
propose and challenge changes, but the candidate retains control over source
material, provider exposure, factual claims, and final approval.

The initial product is a local-first desktop workspace for one CV and one job
application. Expansion to other application artifacts should follow only after
this workflow demonstrates better quality or lower user effort on real,
consented cases.

The reference workflow is approved opportunity URLs and instructions plus a
persistent local career corpus, followed by an Anthropic first complete draft,
an independent OpenAI critique, author adjudication and revision, final human
approval, and professional export. Anthropic as author and OpenAI as critic are
the default cross-company roles; the architecture keeps provider roles
configurable while preserving independent review and explicit provider
identity.

The persistent corpus is a Candidate Knowledge Base (CKB). A candidate normally
maintains one default CKB across applications, but may create additional
isolated CKBs and explicitly select one or an approved combination for a run.
Sources evolve over time; adding, updating, refreshing, or removing career
material must update normalized facts and retrieval indexes without losing
provenance.

## Product principles

- Sources before eloquence: substantive claims remain traceable to user-owned
  candidate materials.
- Agents advise; people decide: export requires a visible approval boundary.
- Local by default: provider transmission is explicit and scoped.
- Independent review: provider and model identities are visible, and
  cross-company diversity is the default.
- Durable candidate memory: reusable career material is maintained separately
  from an individual opportunity and selected explicitly for each application.
- Measured expansion: new retrieval, providers, and workflows must improve a
  defined outcome rather than only add capability.

Candidate-source traceability is not independent factual verification. A CV,
profile, or private-project description supplied by the candidate is legitimate
source material even when no public proof exists. DraftLoop prevents model-added
facts and surfaces contradictions; it does not conduct background checks,
contact employers, or replace recruiter references, interviews, or technical
evaluation. Public projects and credentials are optional corroboration.

## Status model

Roadmap status describes evidence, not percentage complete. A stage may contain
components at different levels; the table states the strongest level supported
for the stage outcome as a whole.

| Level       | Meaning                                                                                                                      | Required evidence                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Designed    | The user outcome, boundaries, and acceptance criteria are documented.                                                        | Roadmap scope and relevant architecture or ADRs  |
| Implemented | The capability exists behind package contracts and has focused automated checks.                                             | Code and deterministic tests                     |
| Integrated  | The capability is connected through the intended CLI or desktop workflow.                                                    | End-to-end or packaged workflow evidence         |
| Validated   | The outcome has been demonstrated under representative conditions, including real or safely sanitized inputs where required. | Recorded acceptance results and product measures |
| Released    | A versioned artifact has been published with traceable manifests, checksums, platform results, and known limitations.        | Release evidence linked from the stage record    |

Implementation is not validation, and a synthetic fixture or benchmark does
not by itself prove a real-user outcome. A release does not upgrade a stage to
Validated unless its exit criterion was demonstrated.

## Current state

The local author–critic foundation is substantially integrated. The CLI and
packaged Electron host share the application driver; local workspaces support
file and approved URL intake, provenance, SQLite history, bounded orchestration,
review decisions, restart recovery, and approved Markdown, DOCX, and PDF
exports. The desktop also has a renderer-to-host credential flow for live
Anthropic and OpenAI runs, with explicit provider-policy checks at the provider
boundary.

Automated tests, offline fixtures, retrieval benchmarks, packaging checks, and
installed-app acceptance on Linux, macOS, and Windows provide strong integration
evidence. The desktop transmission preflight, provider recovery, credential
lifecycle, restart behavior, and export path have automated cross-platform
coverage. They do not replace representative real-input outcome validation; the
first consented run exposed the quality failure recorded below.

The workspace-scoped SQLite FTS/BM25 baseline is now connected to the local
orchestration engine, and live provider requests receive retrieved chunks rather
than the complete ingested candidate corpus. It does not yet provide integrated
reusable CKB data, multiple-CKB isolation, continuous source lifecycle, or
application-level CKB selection. A separate portable CKB store component now
persists a logical UUID, CKB lifecycle metadata, stable CKB-scoped source
identity, and immutable ordered source-version metadata. Sources record file/URL
kind and a local label; versions record SHA-256, media type, byte size, and
timestamp and parent lineage. Its approved managed-file commands accept one
local regular file of at most 20 MiB in the five supported media types, require
successful extraction plus stable-file and managed-copy checks, and copy
immutable raw bytes beneath an opaque ID-derived name. The application component
can explicitly append approved changed bytes as version N+1 of an existing file
source; identical current bytes are a no-op and do not advance time or imply
freshness. A successful managed create remembers its canonical verified origin
path in sensitive local-only SQLite state; a later manual append path is
runtime-only and never changes that binding. Source identity and label stay
stable even when its basename differs. An explicit local application query now
performs a bounded, non-destructive structural inventory of `sources/` after
normal referenced-blob validation. It reports only counts of verified managed
files, scanned entries, staging-shaped root files, other opaque root
files/directories, extra entries within expected managed-source directories,
symlinks, special/other entries, and complete/scan-limit status. It returns no
names, paths, IDs, labels, checksums, or content and neither follows unknown
symlinks, recurses unknown directories, reads unknown file bytes, mutates state,
nor runs automatically. Structural shape is not authenticated ownership
evidence: unreferenced entries remain unknown and cannot be deleted, adopted,
quarantined, or repaired. Successful managed creates now retain the canonical
verified origin path in a separate sensitive local-only SQLite binding table;
manual appends never update it. The binding is copied with the database but is
not portable continuity, becomes stale when the store moves machines or the
origin moves/disappears, is not automatically updated or rebound, and is never
provider-facing.
An explicit read-only application check now classifies one source as unbound,
current, changed, missing, or inaccessible without returning the path,
checksum, content, label, or observed file metadata. It does not persist the
observation or create freshness/last-refresh state; current is only a
point-in-time byte match with the latest stored version. A separate explicit
application operation now refreshes from that remembered origin: changed bytes
repeat stable capture and managed-copy validation before becoming the next
immutable parent-linked version, while current, unbound, missing, or
inaccessible origins create no version. Refresh returns no path or observed
content, never changes the binding, and persists no freshness or last-refresh
state. The store retains no
exact host paths in manifests, descriptors, journals, inventory, diagnostics,
or application/provider projections, and retains no filename provenance,
filename-derived physical names, or URLs. It remains independent of application workspaces and run
history. It does not yet refresh in the background, persist freshness or last
refresh, discover moved origins, or rebind them; ingest directories or URLs;
relate cross-source duplicates; index or retrieve; select a CKB for an
application or run; expose CLI/desktop controls; repair missing/corrupt
referenced blobs; coordinate writers through locks/leases; delete, clean up, or
reconcile unknown entries; or completely backup, export, or restore. Those
remaining CKB outcomes are split across #110–#113 while #78 remains their
tracking parent. Safe future cleanup requires
prospective journal proof, writer coordination, and explicit approval;
unjournaled entries remain unknown. SQLite migration v7 supplies that
prospective internal append-only journal for new managed creates and appends.
Opaque intent precedes staging; a monotonic event records the resolved target
before publication, followed by publication and the atomic managed-marker/database
commit; completion follows staging cleanup. New staging names are opaque operation-derived hashes. SQLite migration v8 adds the
separate local-only origin-binding table for successful managed creates;
existing v7 sources remain unbound, and the binding is committed atomically
with the source, version, managed marker, and committed journal event. Journal
records exclude origin paths, filenames, labels, checksums, source content,
provider data, diagnostic projections, cleanup tokens, and approvals, and
journal IDs are not exposed. Legacy v6 writes and entries without prospective
journal proof remain unknown. The journal supplies evidence for future policy
only: it does not delete, adopt, quarantine, repair, reconcile, auto-scan,
coordinate writers with locks/leases, provide approval UI, or authorize
cleanup. Same-current-byte managed appends record a terminal, non-owning no-op;
metadata-only
versions can be explicitly materialized without adopting pre-existing unowned
targets based on matching bytes or shape. This remains component implementation
under #78; the portable CKB is not authoritative for retrieval. The v0.7
retrieval path is the CKB-scoped lexical baseline in #80; local vector and
hybrid comparison moved to the later evaluation issue #114.

Several later-stage components also exist: local lexical/vector retrieval,
provider retry and progress behavior, a consented pilot harness, backup and
restore, retention purge, content-free diagnostics, ATS checks, additional
artifact schemas, multilingual templates, a local endpoint adapter, and
portfolio ingestion. These are component-level implementations or partial
integrations. They do not establish that the retrieval, pilot, production-beta,
or controlled-expansion outcomes are complete.

An initial workspace-scoped writing-policy slice for #70 is integrated behind
explicit local file selection. The selected policy remains separate from
candidate evidence, is versioned by checksum in run context, is visible before
provider transmission, and supplies deterministic checks for supported rules.
It does not complete #70: reusable global preferences, opportunity overrides,
and in-product policy editing remain part of the v0.7 drafting stage.

The sanitized real-application validation for issue #104 failed its quality
baseline: technical export completed, but major CV sections and chronology were
omitted, seniority changed, and unsupported quantification was introduced. No
personal CV or opportunity details are recorded here. Export completion is
therefore not application readiness; the core workflow still needs a complete,
factual, reviewed result that matches the proven manual baseline.

The fail-closed PDF extraction quality gate (#168), independent-critique
approval/export gate (#169), critic-only provider recovery path (#173),
Anthropic author-output completion diagnostics (#175), and deterministic
full-flow NativeHost regression (#177) are complete. They established a strong
integration baseline but did not correct the representative output-quality
failure. [v0.6.0](https://github.com/akoita/draft-loop/releases/tag/v0.6.0) was
published as an explicitly non-validated alpha baseline; its
[stage-evidence record](stage-evidence-v0.6.0.md) carries the negative outcome
into the application-grade v0.7 work.

## Reference workflow and parity target

The private parity baseline is the proven manual workflow using approved
opportunity URLs and instructions together with a persistent local career
corpus. For each application, the candidate selects the CKBs the agents may use;
RAG then recalls the strongest relevant facts and source excerpts. The workflow
produces a complete factual CV, checks the opportunity requirements, adjudicates
edits, receives final human approval, and creates a professional export. The
product target is to automate this sequence while retaining local control,
source traceability, provider visibility, and the human approval boundary.

The private baseline may contain candidate material that must never enter the
repository. Repository fixtures, test data, reports, and stage evidence must
remain sanitized and contain no PII, private CV content, real names, contact
details, real employers, or private opportunity URLs or instructions.

## Candidate knowledge-base model

A CKB is durable candidate memory, not a per-application upload bucket. It can
contain previous CVs, career and experience notes, certification references,
repository and project descriptions, authored work, and candidate-maintained
facts documents. One default CKB should be sufficient for most candidates;
additional CKBs support intentional separation, and combining them always
requires explicit selection.

CKB sources have identity, provenance, versions, checksums, freshness, duplicate
relationships, and indexing state. Source addition, update, removal, directory
refresh, retention, deletion, backup, and restore must apply consistently to raw
material, normalized facts, lexical/vector indexes, and run references. Files
whose names resemble agent configuration remain untrusted candidate data and
must never change application instructions, provider policy, or permissions.

RAG is scoped to the CKB IDs and source versions recorded by an application.
SQLite FTS/BM25 remains the local baseline; local vector or hybrid retrieval is
enabled only after measured gains in relevant-achievement recall and citation
accuracy without more unsupported claims. Remote embeddings or vector storage
require a separate architecture and privacy decision.

Agents may propose bounded internet research when opportunity or candidate
context is insufficient, but search or fetch requires visible per-research user
approval. Opportunity research, candidate evidence, and optional public
corroboration remain distinct source roles. Research cannot create candidate
experience, contact employers, or submit applications.

## Roadmap

| Horizon  | Stage                                                                                                             | Evidence status                                                                   | Outcome                                                                               | Remaining gate                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Previous | Integration hardening and outcome validation ([v0.6.0](https://github.com/akoita/draft-loop/releases/tag/v0.6.0)) | Released; validation failed                                                       | Preserve a reproducible integrated baseline without overstating application readiness | Closed with failed representative outcome carried into v0.7; see the [stage evidence](stage-evidence-v0.6.0.md) |
| Now      | Evidence-backed CV drafting ([milestone v0.7.0](https://github.com/akoita/draft-loop/milestone/2))                | Designed; portable CKB store component implemented                                | Produce a complete factual, source-traceable application draft                        | Integrated CKB lifecycle and selection, reviewed profile and opportunity, lexical RAG, plan, complete CV, policy |
| Next     | Independent review and readiness ([milestone v0.8.0](https://github.com/akoita/draft-loop/milestone/3))           | Designed; foundation components partially integrated                              | Turn the factual draft into a reviewed, revised, human-approvable artifact             | Structured critique, adjudication, calibrated readiness gates, professional rendering                              |
| Next     | Workflow parity and release ([milestone v0.9.0](https://github.com/akoita/draft-loop/milestone/4))                | Designed; parity validation not started                                            | Demonstrate the complete application-grade workflow and publish its evidence           | Consented comparison, zero factual regression, bounded editing, cross-platform release evidence                    |
| Later    | Retrieval and provider quality                                                                                    | Integrated lexical baseline; candidate components have partial benchmark evidence | Improve evidence selection and make live runs dependable                              | Vector/hybrid comparison, integrated cancellation and provider recovery                                               |
| Later    | Broader real-application pilot                                                                                    | Implemented harness; not outcome-validated                                        | Validate factuality, quality, and user-effort hypotheses across more cases             | Consented cases, calibrated measures, recorded results and limitations                                               |
| Later    | Production-ready beta                                                                                             | Partial implementation; not production-validated                                  | Distribute a safe, dependable desktop application                                     | Signed installers, safe updates/migrations, platform acceptance, recovery and accessibility evidence                |
| Later    | Controlled expansion                                                                                              | Implemented prototypes and components; gated                                      | Extend a proven workflow without weakening trust boundaries                           | Core CV pilot evidence, separate integration/validation, updated threat decisions                                   |

### Released — Integration hardening and outcome validation (v0.6)

Turn the substantially integrated alpha into a coherent, evidence-backed local
workflow rather than adding more surface area.

- Record installed-app acceptance on Linux, macOS, and Windows for workspace
  creation, real or safely sanitized file intake, approved URL intake, run,
  review, restart/resume, approval, and export.
- Complete and verify the desktop preflight before the first provider request:
  data class, provider and model identities, transmission scope, retention
  preference, budget, and explicit acknowledgement.
- Make provider failures and recovery visible and test the allowed transition
  back to a safe review, retry, or stopped state.
- Verify credential set, status, removal, environment fallback, and storage
  limitations on every supported operating system.
- Run at least one consented real-application workflow and record factuality,
  critical-requirement coverage, useful findings, review time, manual edits,
  provider cost, and approval/export completion.
- Publish a stage evidence record containing platform results, test and smoke
  references, release manifest and checksums, known limitations, and the next
  product decision.

**Exit criterion:** The acceptance matrix is complete across supported desktop
targets, at least one consented real application completes without factuality
regression, provider exposure and recovery are visibly controlled, and an alpha
release has traceable evidence and known limitations.

**Validation outcome:** The integration and platform criteria were demonstrated,
but the representative application regressed factual completeness and
application readiness. v0.6.0 was published as an explicitly non-validated
alpha baseline. The unmet outcome moves forward as the defining input to v0.7
rather than being waived.

### Now — Evidence-backed CV drafting (v0.7)

Issue #4 remains the application-grade program parent, while milestone v0.7.0
is limited to the first complete drafting vertical:

- Finish the reusable CKB through bounded delivery issues for source intake and
  refresh (#110), application selection and immutable source-version snapshots
  (#111), shared CLI/desktop controls (#112), and lifecycle storage safety
  (#113). Issue #78 tracks the combined program outcome.
- Derive a candidate-reviewed canonical profile (#66), assemble a reviewed
  opportunity brief from explicitly supplied sources (#67), and use the
  CKB-scoped SQLite FTS/BM25 baseline with lifecycle evidence (#80).
- Plan requirement-to-achievement coverage, compose every required CV section
  without factual or chronological regression, and apply a versioned candidate
  writing policy (#68–#70).

Optional user-approved research (#79) and vector/hybrid retrieval evaluation
(#114) are outside the critical path. They may improve a later workflow but are
not required to prove that approved local evidence can produce a complete
factual draft.

**Exit criterion:** One default and optional additional isolated CKBs can be
maintained and explicitly selected without source or retrieval leakage; the
selected source versions produce a reviewed canonical profile and opportunity
brief; CKB-scoped lexical retrieval supports a planned, complete CV whose
required sections, chronology, factual invariants, provenance, and writing
policy checks pass.

### Next — Independent review and readiness (v0.8)

- Produce the structured independent application-readiness report (#71).
- Record per-finding author adjudication and traceable artifact revision (#72).
- Apply calibrated readiness stopping rules while preserving exact-artifact
  human approval (#73).
- Render a professional ATS-readable DOCX/PDF with visual QA (#74).

**Exit criterion:** The complete factual draft receives an independent critique
and traceable author revision; unresolved disagreements remain visible;
deterministic factual, completeness, chronology, ATS, and approval gates prevent
a regressed artifact from being labelled application-ready.

### Next — Workflow parity and release (v0.9)

- Compare the complete workflow with the consented private manual baseline
  using predeclared factuality, completeness, recall, coverage, effort, cost,
  confidence, and usability measures (#75).
- Publish the application-grade release evidence, artifacts, manifests,
  checksums, platform results, limitations, and next decision (#76).

**Exit criterion:** The representative comparison records zero factual
invariant violations or unsupported model-added facts, preserves required
sections and chronology, meets the private relevance and coverage thresholds,
and produces a professionally usable artifact after bounded human review;
v0.9.0 is released with traceable cross-platform evidence.

### Later — Retrieval and provider quality

Optimize evidence selection and provider behavior only after the application-
grade workflow demonstrates parity.

- Preserve the provider-independent retrieval port and workspace-scoped SQLite
  FTS/BM25 baseline.
- Compare local embeddings and hybrid lexical/vector retrieval against citation
  accuracy, recall, irrelevant context, and unsupported claims on
  representative cases.
- Demonstrate index deletion, rebuild, retention, workspace isolation, and
  provenance before enabling vector retrieval by default.
- Integrate cancellation, timeout, bounded retry, rate-limit recovery, safe
  streaming progress, and reproducible run manifests into the product path.
- Evaluate a separately consented OpenRouter transport for users who prefer
  one in-product paid balance over bringing provider API keys or subscriptions.
  It must use the same production path in validation and release checks, expose
  OpenRouter plus the downstream model host, and receive its own architecture,
  privacy, and billing decision before implementation.
- Keep swapped provider roles and additional adapters independent of the
  orchestration domain.

**Exit criterion:** Retrieval or provider changes measurably improve coverage
or evidence accuracy on representative cases without increasing unsupported
claims, and failure/recovery behavior is demonstrated in the packaged app.

### Later — Broader real-application pilot

Run a small, consented pilot with sanitized reporting. Compare first drafts,
revised drafts, and manual baselines using:

- unsupported-claim and critical-requirement coverage rates;
- useful versus rejected findings;
- review time, manual edits, and completed approvals;
- rounds, provider cost, export completion, and user confidence.

The implemented harness and adversarial fixtures make this study possible; they
are not the study result. Include misleading-evidence and prompt-injection cases
before interpreting a passing score as readiness.

**Exit criterion:** Revised drafts do not regress factuality, outperform first
drafts on the agreed measures, and reduce meaningful user effort on consented
representative cases.

### Later — Production-ready beta

- Signed installers, migrations, backup/restore, crash recovery, rollback, and
  safe updates.
- Reproducible package-size diagnostics and justified payload changes.
- Accessibility and keyboard-complete review flows validated with representative
  users and assistive technology.
- ATS and cross-viewer DOCX/PDF compatibility, Unicode typography, templates,
  and visual regression tests.
- Dependency, secret, license, provenance, and supply-chain checks.
- Visible retention/deletion controls and opt-in content-free diagnostics with
  documented export and deletion behavior.

**Exit criterion:** Repeatable signed releases with safe upgrades and rollback,
complete supported-platform acceptance, and no loss of workspace history.

### Later — Controlled expansion

Candidate directions include cover letters, application answers, multilingual
templates, additional or local model providers, portfolio imports, encrypted
sync, and coach review. Existing prototypes remain gated until the CV workflow
has outcome evidence. Each direction needs its own integration criteria; cloud
accounts, shared workspaces, external tools, and application submission also
require a separate architecture decision and threat-model update.

## Explicitly deferred

- Remote embeddings or a vector database before the local CKB-scoped retrieval
  baseline proves value and receives a separate architecture/privacy decision.
- Cloud sync, accounts, or multi-tenancy during integration hardening.
- Uncontrolled or autonomous web research, job discovery, messaging,
  publishing, or application submission. Bounded research approved per request
  remains planned in #79 but is outside the application-grade critical path.
- General availability of additional artifacts before the CV pilot validates
  the core hypothesis.

## Success measures

The primary product measures are factual-invariant violations, required-section
and chronology preservation, CKB isolation, source/index freshness,
relevant-achievement recall, citation accuracy, irrelevant retrieval context,
job-requirement leakage, research-approval compliance, writing-policy
violations, critical-requirement coverage, useful critic findings, ATS and
visual readiness, review time, editing effort compared with the private manual
baseline, approval/export completion, provider cost, and user confidence. Test
count, model count, and number of generated documents are health or activity
indicators, not product success by themselves.

## Stage evidence

Each stage exit must record:

- the achieved status level and evidence date;
- acceptance criteria and results, including the supported-platform matrix;
- product measures and representative-case limitations;
- release tag, artifact manifest, checksums, SBOM, and known limitations; and
- unresolved risks and the decision that follows from the evidence.

Until those references are recorded here or in a linked repository artifact, a
stage must not be described as Validated or Released.

## Review cadence and change log

Review this roadmap after each stage exit, after material pilot evidence, or at
least monthly while active development continues. Every stage exit should also
produce a versioned release using [the release procedure](releasing.md). A
roadmap change should say what changed, why, and what moved out to make room.

The entries below are a historical delivery log. “Implemented,” “delivered,” or
“completed” in an older entry records what was reported at that time; the status
model above controls current stage claims.

| Date       | Change                                                                                                                                                                                                                    | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-22 | Split the oversized application-grade milestone into v0.7 evidence-backed drafting, v0.8 independent review/readiness, and v0.9 workflow parity/release; decomposed #78 into #110–#113 and split hybrid retrieval from lexical #80 into #114 | Fifteen open issues combined storage lifecycle, drafting, review, rendering, validation, and publication in one release. The new sequence preserves the same #4 program outcome while giving each milestone a coherent exit, moving optional research (#79) and unproven vector/hybrid optimization (#114) off the critical path. |
| 2026-08-22 | Added explicit refresh from a managed file source's remembered origin without advancing #78 or the application-grade stage beyond component implementation                                                               | Changed bytes can become the next immutable version only after the existing no-follow ingestion and stable managed-copy gates; current, unbound, missing, and inaccessible origins create no version, the path and observed content stay out of results, and background refresh, freshness persistence, moved-origin discovery, rebind, directory/URL intake, selection, retrieval, deletion, and UI integration remain pending                    |
| 2026-08-22 | Added an explicit, read-only managed-file origin status check without advancing #78 or the application-grade stage beyond component implementation                                                                       | A local caller can distinguish unbound, current, changed, missing, and inaccessible origins without path/checksum/content projection or mutation; the observation is not persisted, “current” is point-in-time only, and automatic refresh, rebind, moved-origin discovery, directory/URL intake, selection, retrieval, deletion, and UI integration remain pending                                                                                 |
| 2026-08-22 | Added remembered local-file origin bindings for successful managed CKB creates in SQLite migration v8 without advancing the application-grade stage beyond component implementation                                       | The canonical verified origin is useful local state but is sensitive, stale when the store or origin moves, not portable continuity, not yet refreshable/rebindable/status-checked, and never provider-facing; manual appends and legacy v7 sources remain unbound                                                                                                                                                                            |
| 2026-08-21 | Added the prospective internal managed-write ownership journal in SQLite migration v7 without advancing #78 or the application-grade stage beyond component implementation                                                | New managed writes gain append-only intent/publication/commit/completion provenance and opaque operation-derived staging names, while legacy or unjournaled entries remain unknown and cleanup still requires writer coordination plus explicit visible approval                                                                                                                                                                              |
| 2026-08-21 | Added an explicit bounded, count-only structural inventory query for the portable store without advancing the application-grade stage beyond component implementation                                                     | Inventory validates referenced blobs and classifies `sources/` entries without names, content, traversal, mutation, or provider exposure; unreferenced entries lack authenticated ownership evidence, so repair and cleanup remain blocked on a future durable journal, writer coordination, and explicit approval                                                                                                                            |
| 2026-08-21 | Exposed explicit managed-file version append at the application component boundary without advancing the application-grade stage beyond component implementation                                                          | A candidate can manually approve changed bytes as parent-linked version N+1 after repeated media, extraction, 20 MiB, stable-file, and managed-copy checks; identical current bytes are a true no-op, paths stay runtime-only, and automatic refresh/freshness, origin reporting, directory/URL intake, duplicates/indexing/retrieval, app/run selection, UI controls, deletion/reconciliation, and complete backup/export/restore remain out |
| 2026-08-21 | Added approved single-file managed CKB intake without advancing the application-grade stage beyond component implementation                                                                                               | One regular file can now cross the portable boundary only after type, 20 MiB, and extraction checks; opaque immutable bytes and a version-6 marker establish exact managed provenance without host paths, while directory/URL intake, refresh/freshness, duplicates/indexing, retrieval/UI integration, deletion, reconciliation, backup, export, and restore remain out                                                                      |
| 2026-08-21 | Added portable CKB source identity and immutable ordered source-version metadata without advancing the application-grade stage beyond component implementation                                                            | Stable source IDs and SHA-256 version records establish portable provenance without retaining host paths, URLs, or content; physical intake, refresh, duplicates/indexing, application selection, retrieval, CLI/desktop UI, deletion, export, and restore remain unintegrated                                                                                                                                                                |
| 2026-08-21 | Implemented the portable CKB store identity and local SQLite lifecycle-metadata component for #78 without advancing the application-grade stage beyond component implementation                                           | A user-selected store needs a logical UUID independent of its filesystem path and must remain separate from application workspaces and run history; source versions, selection, retrieval cutover, CLI/desktop UI, deletion, export, and restore remain unintegrated                                                                                                                                                                          |
| 2026-08-21 | Published [v0.6.0](https://github.com/akoita/draft-loop/releases/tag/v0.6.0) as Released but not Validated and moved Application-grade CV workflow to Now                                                                 | The exact-revision local live-provider preflight, release dry run, three platform builds, manifest, checksums, SBOM, and known limitations passed; the representative output-quality failure remains the defining v0.7 input rather than being waived                                                                                                                                                                                         |
| 2026-08-21 | Approved v0.6.0 as a non-validated alpha release baseline and kept v0.7 next until publication evidence is complete                                                                                                       | The live workflow reached approval and export but did not preserve factual completeness, chronology, or application readiness; a prerelease can preserve the integrated baseline without claiming validation, while v0.7 owns the canonical profile, customizable structure, complete composition, stopping rules, and parity work exposed by the failure                                                                                     |
| 2026-08-21 | Integrated an explicit workspace writing-policy source role as an early partial slice of #70 without moving the current stage                                                                                             | Representative use showed that recurring candidate rules must guide both model roles without treating files named like agent configuration as evidence or executable repository instructions; reusable global policy and per-opportunity overrides remain v0.7 work                                                                                                                                                                           |
| 2026-08-20 | Added a mandatory local `release:preflight` guardrail and agent policy before any release action                                                                                                                          | The paid live-provider check must run on the release revision without placing API keys or subscription sessions in CI/CD; a repository command is more portable and auditable than an optional per-clone Git hook                                                                                                                                                                                                                             |
| 2026-08-20 | Made the paid live-provider E2E a local-only release validation and removed its GitHub Actions gate                                                                                                                       | Provider API keys and interactive subscription sessions should remain outside CI/CD; hosted automation continues to run deterministic credential-free validation and packaged offline acceptance                                                                                                                                                                                                                                              |
| 2026-08-20 | Added explicit per-provider API-key and experimental local user-session authentication modes, including deterministic mixed transport selection, and scheduled OpenRouter evaluation under provider quality               | Local validation should reuse supported vendor logins without copying OAuth tokens and may select an API key when one subscription is unavailable, while hosted CI remains credential-free; OpenRouter is a future product billing option rather than a test-only backend                                                                                                                                                                     |
| 2026-08-16 | Required a deterministic real-mode full-draft NativeHost regression (#177) before another consented Electron rerun (#104)                                                                                                 | The packaged fixture acceptance bypasses the provider adapters and canonical live-author proposal path, so repeated manual testing was discovering integration failures too late                                                                                                                                                                                                                                                              |
| 2026-08-15 | Inserted the repeated Anthropic author-output completion failure (#175) before the consented rerun (#104)                                                                                                                 | A real-input structured response can end before a complete proposal is available; the product must budget author output explicitly and report safe completion diagnostics before representative validation can continue                                                                                                                                                                                                                       |
| 2026-08-15 | Replaced the incomplete-critic approval dead end with bounded critic-only recovery (#173)                                                                                                                                 | A failed independent critic must preserve the completed author draft and retry that exact step; it must not imply approval readiness or force another author round                                                                                                                                                                                                                                                                            |
| 2026-08-15 | Completed the independent-critique approval/export gate (#169); the consented quality rerun (#104) is now the next v0.6 gate                                                                                              | Recovered author drafts remain inspectable, but approval and export now require a completed independent critic execution for the current round                                                                                                                                                                                                                                                                                                |
| 2026-08-15 | Completed the PDF extraction quality gate (#168) and kept the independent-critique approval/export gate (#169) before the consented quality rerun (#104) and stage release (#106)                                         | The first real-application failure requires unreliable extracted text to be rejected before indexing or provider exposure, with the remaining hardening gate sequenced before outcome validation and release                                                                                                                                                                                                                                  |
| 2026-08-15 | Refined the v0.7 stage with reusable Candidate Knowledge Bases (#78), approved research (#79), and CKB-scoped hybrid RAG (#80)                                                                                            | The proven workflow depends on durable candidate memory that evolves across applications; a per-workspace evidence folder and generic retrieval stage did not explicitly cover one-or-more datasets, continuous updates, safe research, or retrieval isolation                                                                                                                                                                                |
| 2026-08-15 | Inserted the Application-grade CV workflow as the next stage for issue #4 and milestone v0.7.0, covering #66–#76                                                                                                          | The sanitized #104 real-run baseline showed that technical export completion is not application readiness, so core workflow parity must precede broader retrieval/provider quality and pilot capability expansion                                                                                                                                                                                                                             |
| 2026-08-15 | Reframed candidate claim handling around source traceability rather than objective verification for issue #130                                                                                                            | Private professional experience is commonly not publicly provable; DraftLoop must prevent model invention without pretending to perform recruiter investigations or technical assessment                                                                                                                                                                                                                                                      |
| 2026-08-15 | Hardened the live author boundary and terminal desktop projections for issue #126                                                                                                                                         | The real-application run exposed that models must propose content while the application owns canonical artifact metadata and evidence resolution, and that failed or stopped runs must not appear completed, validated, or approvable                                                                                                                                                                                                         |
| 2026-08-15 | Extended packaged Linux, macOS, and Windows acceptance with observable execution, interrupted-run recovery, and deterministic in-flight cancellation evidence for issue #119                                              | The desktop control is only stage evidence when installed artifacts exercise the same background worker and Stop path                                                                                                                                                                                                                                                                                                                         |
| 2026-08-15 | Added cancellable desktop workers, explicit interrupted-run recovery, and live provider/step/attempt/elapsed/timeout projection for issue #119                                                                            | A long-running review must remain understandable and stoppable, and restart must never imply that a missing worker is still running                                                                                                                                                                                                                                                                                                           |
| 2026-08-15 | Propagated cancellation signals from the application resume contract through orchestration and Anthropic, OpenAI, and local provider requests for issue #119                                                              | A desktop Stop action must be able to abort the actual in-flight request before persisting a terminal run state                                                                                                                                                                                                                                                                                                                               |
| 2026-08-15 | Moved desktop provider execution behind an immediate durable run response and active-state refresh for issue #119                                                                                                         | Long provider calls must not hold the initiating IPC request open or leave the installed app looking unresponsive                                                                                                                                                                                                                                                                                                                             |
| 2026-08-15 | Added a durable begin-without-execution contract for issue #119                                                                                                                                                           | Desktop progress needs a run identity and persisted initial state before provider work can move outside the initiating IPC request                                                                                                                                                                                                                                                                                                            |
| 2026-08-15 | Added immediate pending-review acknowledgement and bounded serialized bridge-error message preservation for issue #118                                                                                                    | Integration hardening needs duplicate-safe review starts and user-visible recovery without exposing arbitrary thrown error content                                                                                                                                                                                                                                                                                                            |
| 2026-08-15 | Verified the v0.6.0 release candidate from commit `dd933cf81c4161191281108b6f44c3d8cec94f8f` across Linux x64, macOS arm64, and Windows x64; reviewed checksums, SBOM, artifact privacy, smoke results, and package sizes | Issue #105 can close with a reproducible candidate while publication and any Validated or Released claim remain blocked by the consented real-application outcome in issue #104                                                                                                                                                                                                                                                               |
| 2026-08-15 | Aligned every package manifest to v0.6.0 and corrected release-note traceability to milestone issue #106 for issue #105; publication remains blocked by issue #104                                                        | A reproducible release candidate needs one version source across the monorepo and must link the current stage issue, while a version bump alone cannot satisfy the real-outcome exit criterion                                                                                                                                                                                                                                                |
| 2026-08-15 | Added a truthful v0.6.0 stage-evidence working record for issue #105; release preparation remains gated by the missing real consented outcome in issue #104                                                               | Automated acceptance and release contracts are reviewable, but versioning and publication must wait for the representative product result and its limitations                                                                                                                                                                                                                                                                                 |
| 2026-08-15 | Added an explicit consented outcome record, sanitized product measures, and a private/public pilot protocol for issue #104; no real application result is claimed yet                                                     | The pilot gate must record completion, factuality signals, critical coverage, unsupported claims, effort, rounds, cost, confidence, and adversarial limitations without putting personal or provider content in the repository                                                                                                                                                                                                                |
| 2026-08-15 | Added a sanitized two-launch installed-app acceptance matrix for issue #103 across Linux x64, macOS arm64, and Windows x64                                                                                                | Cross-platform integration needs workspace, URL provenance, preflight, restart, review, and export evidence without exposing candidate material or contacting live providers                                                                                                                                                                                                                                                                  |
| 2026-08-15 | Added explicit credential resolution, truthful storage-protection projection, and a packaged two-launch Linux/macOS/Windows credential acceptance matrix for issue #102; platform results remain pending                  | Removing an app key must not leave it usable through a mutated environment, and implementation infrastructure is not cross-platform validation evidence until its workflow artifacts pass and are reviewed                                                                                                                                                                                                                                    |
| 2026-08-15 | Implemented normalized provider-error states, bounded recovery, and content-free desktop/CLI projections for issue #101                                                                                                   | Provider failures must remain durable and user-recoverable across the shared application path while preserving the current integration-hardening stage gate for installed-app evidence                                                                                                                                                                                                                                                        |
| 2026-08-15 | Integrated the SQLite lexical retrieval baseline into live orchestration and hardened desktop review/export audit state                                                                                                   | Provider requests should receive selected workspace evidence, and user-visible exposure, decisions, and export state must agree with durable history                                                                                                                                                                                                                                                                                          |
| 2026-08-15 | Reset Now to Integration hardening and outcome validation; introduced Designed/Implemented/Integrated/Validated/Released evidence levels; reclassified later stages as partial or component-level                         | Repository capabilities had been conflated with validated outcomes, while cross-platform real-input, release, and pilot evidence remained incomplete                                                                                                                                                                                                                                                                                          |
| 2026-08-12 | Created the living roadmap and set Integrated local alpha as Now                                                                                                                                                          | Phase-0 implementation was complete; product integration and real validation were the next constraints                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-12 | Added the shared local driver and Electron host path to the alpha scope                                                                                                                                                   | The renderer bridge gained a real local runtime; packaged acceptance remained the stage gate                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-13 | Added stage-based release automation as issue #46                                                                                                                                                                         | Each roadmap stage should leave a versioned, reproducible baseline for the next stage                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-13 | Added real-input onboarding and approved URL intake to the integrated alpha scope as issue #51                                                                                                                            | The first Windows release exposed synthetic workspace data being shown as user input; retrieval and pilot work need real, provenance-bearing sources                                                                                                                                                                                                                                                                                          |
| 2026-08-13 | Added typed public-source extraction and explicit review-status semantics to the alpha slice                                                                                                                              | URL provenance alone is insufficient for useful source review, and approval must not imply unresolved warnings are validated                                                                                                                                                                                                                                                                                                                  |
| 2026-08-13 | Added deterministic directory and ZIP package-size diagnostics to beta packaging work                                                                                                                                     | The Windows archive size needed evidence before payload reduction or installer changes                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-13 | Recorded automated alpha acceptance and kept the stage open for a real-source Windows check                                                                                                                               | Packaged Linux smoke was green, but synthetic smoke could not replace installed-app validation with real CV and job inputs                                                                                                                                                                                                                                                                                                                    |
| 2026-08-13 | Reported Retrieval and provider quality implementation (#63, #64, #65)                                                                                                                                                    | Added the retrieval port, SQLite FTS/BM25, retries, safe progress, swapped roles, local vector embeddings, and an RRF benchmark                                                                                                                                                                                                                                                                                                               |
| 2026-08-13 | Delivered a consented pilot harness and adversarial fixtures (#66, #67)                                                                                                                                                   | Added the consent protocol, comparative benchmark runner, sanitized reporting, timeline-inversion detection, and security fixtures                                                                                                                                                                                                                                                                                                            |
| 2026-08-13 | Advanced production-beta components (#73, #74, #75, #76)                                                                                                                                                                  | Added backup/restore, ATS validation, Unicode handling, keyboard navigation, accessibility checks, and license/secret gates                                                                                                                                                                                                                                                                                                                   |
| 2026-08-13 | Implemented retention, diagnostics, and additional-artifact components (#81, #82)                                                                                                                                         | Added confirmed retention purge, content-free diagnostic export, and Cover Letter/Application Q&A schemas and renderers                                                                                                                                                                                                                                                                                                                       |
| 2026-08-13 | Delivered local endpoint and multilingual components (#85, #86)                                                                                                                                                           | Added an OpenAI-compatible local endpoint adapter and section templates for en, fr, de, es, and ja                                                                                                                                                                                                                                                                                                                                            |
| 2026-08-13 | Delivered portfolio ingestion and reported milestone releases v0.2.0–v0.5.0 (#93, #57)                                                                                                                                    | Added portfolio/project-manifest ingestion and recorded the release work; release evidence still needs links in the stage record                                                                                                                                                                                                                                                                                                              |
