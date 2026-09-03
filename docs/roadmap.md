# Product vision and roadmap

**Status:** Living document<br>
**Last reviewed:** 2026-09-01<br>
**Current stage:** Workflow parity and release (v0.9.0)

This document describes product direction, not fixed delivery dates. **Now** is
the current commitment, **Next** is planned work that may change after
discovery or pilot evidence, and **Later** is directional. The status model
describes evidence for a product outcome; it does not count lines of code or
package-level capabilities.

GitHub milestones are dependency-closed delivery sprints. Every open
prerequisite of a sprint issue belongs to the same milestone and is ordered
before the work it enables; completed prerequisites remain in their historical
milestones. This keeps execution inside the visible sprint scope.

Issue count is not a capacity measure. Broad outcome issues may remain as
rollups for a milestone exit, but they are never executable sprint units and
do not enter implementation until ordered child issues exist. Each execution
issue must target one observable outcome, one primary architecture boundary,
one focused test surface, and one PR. Active implementation and review is
limited to 20 minutes, excluding test and CI wait time; reaching the limit
requires another split rather than silent continuation. Quality gates remain
unchanged.

## Vision

DraftLoop helps a candidate produce a job-specific CV that is relevant,
source-traceable, and genuinely theirs. Independent author and critic agents
can propose and challenge changes, but the candidate controls source material,
provider exposure, factual claims, and final approval.

The initial product is a local-first desktop workspace for one CV and one job
application. Expansion to other artifacts follows only after this workflow
demonstrates better quality or lower effort on real, consented cases.

The reference workflow combines approved opportunity material with a persistent
local career corpus. An Anthropic author produces a complete draft, an
independent OpenAI critic challenges it, the author adjudicates findings, and
the candidate approves a professional export. Roles remain configurable, but
the default pair is cross-company and provider/model identities are recorded.

The reusable corpus is a Candidate Knowledge Base (CKB). A candidate normally
maintains one default CKB, with additional isolated CKBs available when
separation is intentional. Selection for an application must be explicit.

## Product principles

- Sources before eloquence: substantive claims remain traceable to
  candidate-owned material.
- Agents advise; people decide: export requires a visible approval boundary.
- Local by default: provider transmission is explicit and scoped.
- Independent review: provider and model identities are visible, with
  cross-company diversity as the default.
- Durable candidate memory: reusable material is separate from an opportunity
  and selected explicitly for each application.
- Measured expansion: retrieval, providers, and workflows must improve a
  defined outcome rather than only add capability.

Candidate-source traceability is not independent factual verification. A
candidate's private CV, profile, or project description is legitimate source
material even when no public proof exists. DraftLoop surfaces contradictions
and model-added facts; it does not conduct background checks, contact
employers, or replace references, interviews, or technical evaluation.

## Status model

| Level       | Meaning                                                                                                        | Required evidence                                |
| ----------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Designed    | Outcome, boundaries, and acceptance criteria are documented.                                                   | Roadmap scope plus relevant architecture or ADR  |
| Implemented | Capability exists behind package contracts with focused automated checks.                                      | Code and deterministic tests                     |
| Integrated  | Capability is connected through the intended CLI or desktop workflow.                                          | End-to-end or packaged workflow evidence         |
| Validated   | Outcome is demonstrated under representative conditions, using real or safely sanitized inputs where required. | Recorded acceptance results and product measures |
| Released    | Versioned artifact is published with manifests, checksums, platform results, and limitations.                  | Linked release evidence                          |

Implementation is not validation. Synthetic fixtures and benchmarks do not by
themselves prove a real-user outcome, and a release does not become Validated
unless its exit criterion was demonstrated.

## Current state

The product status is easiest to read by outcome:

| Outcome                            | Current evidence                      | What is true now                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integrated author–critic workspace | [Released v0.8.0-alpha.1](stage-evidence-v0.8.0-alpha.1.md); representative outcome not recorded | CLI and packaged Electron use the shared application driver for local file and approved URL intake, provenance, SQLite run history, bounded orchestration, review decisions, restart recovery, and Markdown/DOCX/PDF export. Desktop provider preflight, credential handling, and Anthropic/OpenAI live paths have focused cross-platform checks.                                                                                            |
| Application-grade quality          | v0.6 release; validation failed       | The sanitized representative run exported, but omitted major CV sections and chronology, changed seniority, and introduced unsupported quantification. v0.6.0 is an explicitly non-validated alpha baseline; this failure is the defining input to v0.7.                                                                                                                                                                                     |
| Workspace retrieval and policy     | Policy and CKB lexical runtime integrated | Explicit CKB selections rebuild and query exact source-version indexes, fail visibly on unavailable retrieval, persist immutable content-free traces, and provide only selected opaque chunk references and bounded text to live author/critic requests. Legacy unselected workspaces retain the earlier evidence path. Writing policies remain integrated with immutable lineage and shared controls. |
| Opportunity brief                  | Integrated reviewed-version handoff      | A strict provider-independent contract and shared CLI/packaged-desktop host workflows assemble approved URLs, selected files, pasted content, and typed local candidate instructions into immutable draft/review versions with honest provenance and visible failures. New runs can pin one exact checksum-verified reviewed version; resume reuses the immutable context. Provider extraction and run transmission each retain explicit approval boundaries.                    |
| Portable CKB                       | [Released Sprint 2 checkpoint](stage-evidence-v0.7.0-alpha.2.md); [Released alpha.3 checkpoint](stage-evidence-v0.7.0-alpha.3.md); #78 accepted; v0.7 incomplete/unvalidated | The reusable CKB foundation is complete: stable source identity and immutable versions, explicit lifecycle/readiness evidence, isolated application/run selection, shared CLI/desktop controls, coordinated recovery, retention, backup/restore, exact-plan deletion, and exact-version lexical retrieval. |
| CKB directory recovery             | Implemented bounded components        | Root rebind and one-source member move are guarded, one-scan operations. The #135 reconciliation contract partitions every member path-free, requires explicit retirement selections, and processes them in deterministic source-ID order. Each marker is atomic; a later failure returns explicit partial progress. No operation accepts or returns a path.                  |
| Product CKB workflow               | [Released alpha.3 checkpoint](stage-evidence-v0.7.0-alpha.3.md); #111 accepted | Shared CLI/desktop controls create, open, select, rename, archive, preview/delete, export, inspect, and restore CKB stores without projecting roots through the renderer. Workspace bindings produce immutable path-free source-version snapshots for new runs, survive restart and legacy migration, and block lifecycle drift before provider execution. Retrieval, reactivation, visual lifecycle UI, and provider use remain outside the product path. |

The CKB foundation has a [Released Sprint 2 checkpoint](stage-evidence-v0.7.0-alpha.2.md),
and v0.7.0-alpha.3 is a [Released drafting and review foundations checkpoint](stage-evidence-v0.7.0-alpha.3.md), not a v0.7
stage exit. It freezes the post-alpha.2 confirmed-deletion slice,
provider-independent readiness/adjudication/stopping/layout foundations, the
first dormant runtime carrier, and Windows user-session environment hardening.
The v0.7 stage remains incomplete and unvalidated; profile, opportunity,
retrieval, planning, complete CV, writing-policy, runtime/UI integration, and
representative validation remain. The [Released v0.7.0-alpha.4 checkpoint](stage-evidence-v0.7.0-alpha.4.md)
carries forward Windows user-session environment hardening
and adds packaged-desktop OpenAI authentication selection (API key or
authenticated Codex/ChatGPT session), independent per-provider persisted
preferences, strict environment precedence, restart-required/no-silent-fallback
behavior, and Codex reasoning lifecycle compatibility while continuing to
reject tool events and ignore reasoning content.

The [Released v0.7.0-alpha.5 checkpoint](stage-evidence-v0.7.0-alpha.5.md)
follows merged feature PR [#202](https://github.com/akoita/draft-loop/pull/202)
and release prep PR [#203](https://github.com/akoita/draft-loop/pull/203). It
carries forward alpha.4 authentication selection and fixes Windows/session
critic compatibility by accepting and discarding passive `todo_list` and
`item.updated` lifecycle output while commands, mutations, search, tool, error,
and unknown event/item types remain fail-closed. The v0.7 implementation history
is retained here; the current release candidate is documented below. See [the architecture](architecture.md) for stable boundaries and
[ADR 0007](adr/0007-portable-candidate-knowledge-store.md) for the canonical
CKB contract. The [privacy and evaluation policy](privacy-and-evaluation.md)
and [threat model](threat-model.md) remain authoritative for their concerns.

## Reference workflow and parity target

The private parity baseline is the proven manual workflow using approved
opportunity URLs and instructions together with a persistent local career
corpus. For each application, the candidate selects the CKBs the agents may
use; retrieval recalls relevant facts and source excerpts; the workflow
produces a complete factual CV, checks requirements, adjudicates edits, and
creates a professional export after human approval.

Repository fixtures, reports, and stage evidence must be sanitized. They must
not contain personal CV content, real names, contact details, real employers,
or private opportunity URLs or instructions.

## Candidate knowledge-base model

A CKB is durable candidate memory, not a per-application upload bucket. It may
contain CVs, experience notes, certification references, project descriptions,
authored work, and candidate-maintained fact documents. Combining CKBs always
requires explicit selection.

The portable component gives each source a stable CKB-scoped identity and
ordered immutable versions. Versions retain checksum, media type, size,
timestamp, and lineage; source labels and exact local origins remain sensitive.
Approved files are captured only after extraction and stable-file checks, and
raw bytes are stored under opaque ID-derived names. Approved URLs use the
bounded HTTPS boundary and retain exact fetched bytes plus local per-version
provenance. Explicit refresh, append, rebind, retirement, inventory, and
directory operations never imply background monitoring or provider exposure.

Directory intake is bounded and deterministic. A complete import records a
sensitive local root binding and immutable hashes of normalized relative
membership; observation, existing-member refresh, missing-member
retirement, root rebind, one-source member move, and complete explicit
missing-member reconciliation each have bounded contracts. These are
component/application-contract capabilities. They do not automatically infer
renames, retire sources, or authorize cleanup. The exact constraints and
privacy invariants live in [ADR 0007][adr-0007].

RAG for an application is scoped to the CKB and source versions recorded by
that application. [ADR 0008](adr/0008-ckb-scoped-lexical-retrieval.md) defines
the local lexical baseline: each CKB owns a replaceable exact-version FTS index,
the application queries only the selected source versions, and the workspace
retains immutable content-free retrieval traces. Missing, stale, fallback, and
empty-query outcomes remain visible rather than becoming silent zero-context
runs. Vector or hybrid retrieval requires measured gains in
relevant-achievement recall and citation accuracy without more unsupported
claims. Remote embeddings or vector storage require a separate architecture
and privacy decision. User-approved research remains distinct from candidate
evidence and cannot create experience, contact employers, or submit
applications.

## Roadmap

| Horizon  | Stage                                                                                                             | Evidence status                                      | Outcome                                                                               | Remaining gate                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Previous | Integration hardening and outcome validation ([v0.6.0](https://github.com/akoita/draft-loop/releases/tag/v0.6.0)) | Released; validation failed                          | Preserve a reproducible integrated baseline without overstating application readiness | Failed representative result carried into v0.7; see [stage evidence](stage-evidence-v0.6.0.md)                          |
| Previous | Evidence-backed CV drafting (v0.7 program) | [Released alpha.5 checkpoint](stage-evidence-v0.7.0-alpha.5.md); implementation history carried forward; outcome not validated | Produce a complete factual, source-traceable application draft | v0.8 candidate evidence now covers the bounded drafting and review vertical |
| Previous | Usable CV MVP ([v0.8.0-alpha.1](https://github.com/akoita/draft-loop/releases/tag/v0.8.0-alpha.1)) | [Released alpha](stage-evidence-v0.8.0-alpha.1.md); 17/17 issues closed; representative outcome not recorded | Produce one complete, factual, reviewed, human-approved, ATS-readable CV | Representative outcome evidence remains without overstating DOCX visual coverage |
| Now      | Workflow parity and release ([milestone v0.9.0](https://github.com/akoita/draft-loop/milestone/4)) | [Eight observations of one consented case are indeterminate](consented-pilot-v0.9.md); parity not validated | Demonstrate the complete application-grade workflow and publish evidence              | Classify and correct the repeated adjudicated-revision validation failure under #293; #75 and #250 remain blocked |
| Later    | Retrieval and provider quality                                                                                    | Integrated lexical baseline; partial components      | Improve evidence selection and dependable live runs                                   | Vector/hybrid comparison, cancellation, and provider recovery in the packaged path                                      |
| Later    | Broader real-application pilot                                                                                    | Implemented harness; not outcome-validated           | Test factuality, quality, and effort across more cases                                | Consented cases, calibrated measures, and recorded limitations                                                          |
| Later    | Production-ready beta                                                                                             | Partial implementation; not production-validated     | Distribute a safe, dependable desktop application                                     | Signed installers, safe migrations, recovery, accessibility, and platform evidence                                      |
| Later    | Controlled expansion                                                                                              | Prototypes and components; gated                     | Extend a proven workflow without weakening trust boundaries                           | Core CV evidence plus separate integration, privacy, and threat decisions                                               |

### Released — Integration hardening and outcome validation (v0.6)

v0.6 established the integrated local alpha: installed-app acceptance covered
the supported desktop targets, provider transmission and recovery controls
were exercised, and a release candidate was published. The consented
representative workflow did not meet its product outcome. Major sections and
chronology were omitted, seniority changed, and unsupported quantification was
introduced despite successful technical export.

The release is therefore explicitly non-validated. The [stage-evidence
record](stage-evidence-v0.6.0.md) carries the negative result into v0.7; it is
not waived by the integration or packaging evidence.

### Previous — Evidence-backed CV drafting (v0.7)

v0.7 is the first complete drafting vertical for the application-grade program.
It must connect reusable CKB data to the application path, not merely add more
storage components. The first two sprints used bounded leaf issues. Milestone 3
now carries every open prerequisite needed to complete the drafting and review
vertical, ordered dependency-first:

- Sprint 1 is complete: the single legacy selection-migration slice #160 closed
  [Sprint 1](https://github.com/akoita/draft-loop/milestone/2).
- Sprint 2 is complete. Store-wide writer leases in #161 prevent current CKB
  commands from interleaving, and #162 deterministically reconciles interrupted
  owned writes after lease takeover without claiming legacy or unknown data.
  #163 defines six-class retention, expiry eligibility, and preservation
  overrides without deleting data. #164 exports strict integrity-checkable
  packages without machine-local state, and #165 restores them into approved
  new directories without overwriting identities. The completed
  [Sprint 2](https://github.com/akoita/draft-loop/milestone/5) deliberately
  deferred confirmed deletion #166; its later standalone delivery completes
  the #113 aggregate storage outcome.
- Derive a candidate-reviewed canonical profile (#66), assemble a reviewed
  opportunity brief (#67), and use the CKB-scoped SQLite FTS/BM25 baseline
  (#80).
- Plan requirement-to-achievement coverage, compose every required CV section
  without factual or chronological regression, and apply a versioned writing
  policy (#68–#70).

Optional user-approved research (#79) and vector/hybrid evaluation (#114) are
outside this critical path. Source lifecycle work through #136, workspace/run
binding slices under #111, and the shared path-safe CLI/desktop controls rolled
up by #112 are implemented. Sprint 1 is complete, #160 is closed, and the CKB
foundation is a [Released checkpoint](stage-evidence-v0.7.0-alpha.1.md).

Sprint 2 is complete with writer coordination, interrupted-write recovery,
retention, backup export, and collision-safe restore. Its five feature PRs
added 10,365 lines across 71 file-changes, so #166 was removed instead of
extending an already oversized sprint. Future sprint admission requires
measured, independently closable units. Confirmed deletion #166 was subsequently
implemented as a standalone prerequisite on the #69 dependency chain.
Milestone 3 contains the six remaining MVP capabilities and their satisfied
prerequisites. Their issue bodies define bounded exits; standalone architecture
programs and generalized infrastructure are deferred until after the MVP.

**Exit criterion:** One default and optional additional isolated CKBs can be
maintained and explicitly selected without source or retrieval leakage; selected
source versions produce a reviewed profile and opportunity brief; CKB-scoped
lexical retrieval supports a planned, complete CV whose required sections,
chronology, factual invariants, provenance, and writing-policy checks pass.

### Released alpha — Usable CV MVP (v0.8.0-alpha.1)

Turn selected candidate evidence and one reviewed opportunity into a complete,
independently reviewed, human-approved, ATS-readable CV.

Retrieval #80, planning #68, complete CV composition #69, the #72 runtime
author handoff, exact approval readiness #73, and bounded rendering QA #74 are
integrated. All 17 v0.8 issues are closed and deterministic validation is
complete. The cross-platform alpha artifact is Released with manifests,
checksums, an SBOM, and platform workflow evidence. No representative consented
outcome has been recorded, so do not label the v0.8 outcome Validated.

Existing #71, #72, and #73 contracts are supporting components, not reasons to
build generalized frameworks. The MVP adds only the runtime behavior required
for one CV workflow. Vector or hybrid retrieval, extra provider roles,
multiple template families, exhaustive evaluation infrastructure, standalone
architecture programs, and autonomous submission remain outside v0.8.

The first #67 component defines a strict, versioned opportunity-brief contract
and pure builder. It preserves source-linked role, employer, responsibilities,
requirements, priorities, and candidate instructions; visible source failures
and contradictions survive acknowledgement; and only a complete state with no
open issue can become reviewed. Persistence, secure multi-source intake,
provider extraction, shared CLI/desktop editing and review, and binding one
exact reviewed brief version into run planning were left to later work by that
initial contract slice. The current job-description path and provider context
were unchanged.

The next #67 component adds application intake for multiple
explicitly approved URLs, selected local files, pasted content, and candidate
instructions. It preserves caller order, records captured checksums, keeps
unavailable/unsupported/partial results and duplicate bytes visible without
leaking raw content or host paths, and creates immutable edit/review versions.
SQLite schema v22 and an adapter-neutral persistence service now store those
versions append-only, enforce immediate lineage and explicit stale-version
checks, verify canonical payload checksums, and reload deeply frozen briefs
after restart without refetching sources. Audit events retain only opaque,
content-free version metadata. A further slice extracts source-linked facts
through the configured author-provider adapter only after explicit
transmission approval. It excludes candidate inputs and local provenance,
validates the strict output and citations, assigns application-owned IDs, and
records contradictions or fixed content-free failures. Shared CLI/desktop
application operations create, reload, list, edit, and review immutable
versions. The CLI keeps paths in runtime-only JSON input, while the packaged
desktop host owns native file selection and returns a bounded path- and
URL-free projection. New runs can now bind one exact reviewed version after
checksum verification and persist its safe reference and structured content in
immutable context. Resume cannot replace that selection, and later edits do
not alter the run. This completes #67; the milestone remains incomplete pending
its downstream planning and drafting work.

The completed #66 canonical-profile path derives a draft from the exact latest source versions
in an explicitly selected CKB or approved combination. Managed reads return
fresh path-free bytes after one-handle integrity verification, and byte
ingestion reuses the bounded text/PDF/DOCX pipeline. Explicit provider-data
approval is required before any read; the application checks the lifecycle
snapshot before extraction and again before persistence. A strict
provider-independent proposal covers all 12 profile
categories; every fact needs a locally verified quote from its cited normalized
source that contains the proposed value, and the quote is discarded after exact CKB provenance is mapped.
Application code owns deterministic IDs, conflicts, possible duplicates,
omissions, and append-only persistence. Concrete
provider execution now uses the configured author model through the existing
API-key, authenticated user-session, or local transports while retaining the
strict path-free request and response boundaries. Shared application and
local-driver operations now derive from the workspace's validated pinned
selection and provide provider-free exact/latest reads, history, optimistic
edits, and review without exposing store roots. The CLI now exposes those five
operations with an explicit provider-data flag for derivation. The packaged
desktop host provides equivalent strict capabilities and returns only a bounded
profile projection. New runs can select an exact reviewed profile version;
DraftLoop verifies its checksum and current CKB lifecycle selection, pins a
safe ID/version/checksum reference in immutable context, and never accepts a
replacement on resume. Review and new-run use now fail closed when that stored
selection is no longer current, while immutable profile history, existing run
references, and approved exports remain intact. Whole-workspace backup and
retention preserve those records; #80 owns removal and rebuild of derived index
rows. The collecting desktop workspace now provides a dedicated profile
history, edit, review, derivation-approval, and exact run-selection surface.
The [sanitized representative acceptance](profile-acceptance.md) now proves
12-of-12 category preservation, exact candidate-source provenance, private
project handling without public proof, visible unresolved conflicts,
duplicates and omissions, path-free schema round trips, and SQLite restart.
This completes #66. Exact selected source versions now drive the CKB lexical
runtime, with lifecycle-checked rebuilds and content-free workspace traces.

The #70 writing-policy outcome is integrated. Local SQLite history stores
immutable checksum-addressed versions and migrates existing managed policies;
activation and import are separate actions. Structured rules and preferences
cover forbidden terms and punctuation, transparent anti-formulaic defaults,
tone, spelling locale, verbosity, page target, section order, and emphasis.
The exact effective policy reaches both model roles, while deterministic
findings and ordinary status views remain content-free.

Shared CLI and desktop controls expose activation, import, history, safe run
lineage, and explicit content reads. One reviewed opportunity may bind an
imported policy as a complete run override without mutating the active
workspace policy. The run pins both base and override versions. This completes
issue #70; the milestone remains incomplete pending its other drafting outcomes.

Issue #74 now connects the controlled A4 renderers to a strict, content-free
rendering-QA report at export time. Markdown uses deterministic checks; PDF and
DOCX use named byte inspectors for recovered text order, package integrity, and
bounded page/layout failures. Export refuses incomplete or failing PDF/DOCX QA
and persists the report with export history. DOCX OOXML cannot establish true
office pagination or visual clipping, so that limitation remains explicit
rather than being represented as viewer certification. Cross-viewer golden
tests, link modeling, UI profile selection, and broader validation remain out
of scope. The bounded v0.8 implementation and deterministic validation are
complete; representative outcome evidence remains before a Validated outcome
claim.

**Exit criterion:** The complete factual draft receives an independent critique
and traceable revision; unresolved disagreements remain visible; deterministic
factuality, completeness, chronology, ATS, and approval gates prevent a
regressed artifact from being labelled application-ready.

### Now — Workflow parity and release (v0.9)

After v0.8.0-alpha.1 publication, compare the complete workflow with the
consented private manual baseline using predeclared factuality, completeness, recall, coverage, effort, cost,
confidence, and usability measures (#75), then publish evidence, artifacts,
manifests, checksums, platform results, limitations, and the next decision
(#76).

Issues #75 and #76 remain outcome rollups rather than executable sprint units.
The dependency-ordered v0.9 work first enforces a private predeclared
comparison gate (#248), runs the provider-free synthetic trust preflight
(#253), then records one consented parity result (#249). It prepares the exact
release candidate after #75 closes (#250) and publishes the release evidence
and next decision (#251) before closing #76. Each child keeps one primary
boundary, focused verification, and a one-PR exit.

The [consented result](consented-pilot-v0.9.md) remains indeterminate. An
initial run reached independent critique but timed out during revision; the one
approved fresh retry timed out during authoring because the user-session
adapter's 120-second request limit could not use the 20-minute case budget. No
revised, approved, or exported artifact was produced. The private manual
baseline also targets a related but different role, which limits any future
comparison. The bounded provider-timeout, author-grounding, and corrective
retry blockers #256, #258, and #260 are closed. The corrective observation
under issue #262 is closed as indeterminate: it used all three author attempts,
with output-token excess followed by two different single claim-text
factual-invariant failures. No draft reached the critic. The per-evidence
author-grounding guide blocker #264 then closed. The authorized observation
under #266 repeatedly failed before author output because structured Claude
nonzero-exit errors were classified generically. Issue #267 delivered the
bounded classification fix. Keep #75 unvalidated; another authorized
comparison under #271 then reached all three author attempts. Output-token
excess was followed by three claim-text factual-invariant paths; the final
corrective attempt reduced them to one repeated path, but no proposal reached
the critic. Issue #272 delivered bounded exact-value citation completion: local
normalization may append only exact supporting retrieved chunks, while the
unchanged validator still rejects unsupported values. The authorized
post-completion observation under #275 then completed both provider roles on
their first attempts and reached the human boundary. Readiness remained false
with eight warnings and one unresolved chronology omission; the unsupported-
claim finding was a warning rather than a factuality error. No adjudication,
revision, approval, export, or submission occurred. Issue #277 stages the
candidate's exact adjudication through the shared application/local boundary,
and #278 preserves active provider-duration accounting across human waits and
restart boundaries. The fresh observation under #286 used 307 seconds of
active time, reached an accepted author draft on attempt three, and completed
independent critique on attempt one. Its twelve findings were materially
different from the previously confirmed nine, so no adjudication was applied.
Typed history then rejected the distinct new artifact because another run in
the workspace already held version 1. Migration 26 under #287 removed that
storage blocker. Under #290, the candidate then confirmed one accept, two
rejects, and nine nuanced decisions; the exact package persisted before any
provider call. The first revision attempt used an incorrect API-key default,
and the two authenticated user-session attempts retained the 120-second
per-request default and timed out. No revised artifact or new critique exists.
The fresh observation under #291 applied the explicit 20-minute request timeout
to every user-session subprocess. Authoring completed on attempt three and the
critic on attempt one. After the candidate confirmed two accepts, two rejects,
and six nuanced decisions, all three revision calls returned before timeout but
failed structured-response validation. The run exhausted after 959 active
seconds without a revised artifact or second critique. Issue #293 owns
content-free failure-stage classification and the narrow correction before
another live observation. Keep #75 unvalidated and leave #250 blocked.

**Exit criterion:** The representative comparison records no factual-invariant
violations or unsupported model-added facts, preserves required sections and
chronology, meets the agreed relevance and coverage thresholds, and produces a
professionally usable artifact after bounded human review.

### Later — Retrieval and provider quality

Preserve the provider-independent retrieval port and workspace-scoped lexical
baseline. Compare local embeddings and hybrid retrieval against citation
accuracy, recall, irrelevant context, and unsupported claims on representative
cases. Demonstrate index deletion, rebuild, retention, workspace isolation,
and provenance before enabling vector retrieval by default. Integrate bounded
cancellation, timeout, retry, rate-limit recovery, progress, and reproducible
run manifests into the packaged path. Any additional transport or provider
needs its own architecture, privacy, billing, and release decision.

**Exit criterion:** Retrieval or provider changes measurably improve coverage or
evidence accuracy without increasing unsupported claims, and failure/recovery
behavior is demonstrated in the packaged app.

### Later — Broader real-application pilot

Run a small, consented pilot comparing first drafts, revised drafts, and manual
baselines. Measure unsupported claims, critical-requirement coverage, useful
findings, review time, edits, rounds, cost, export completion, and confidence.
The implemented harness and adversarial fixtures make the study possible; they
are not the study result. Include misleading-evidence and prompt-injection
cases before treating a passing score as readiness.

**Exit criterion:** Revised drafts do not regress factuality, improve the agreed
measures over first drafts, and reduce meaningful user effort on representative
consented cases.

### Later — Production-ready beta

Complete signed installers, safe migrations and updates, backup/restore, crash
recovery, rollback, package diagnostics, accessibility review, ATS and
cross-viewer DOCX/PDF compatibility, dependency and supply-chain checks, and
visible retention/deletion controls with opt-in content-free diagnostics.

**Exit criterion:** Signed releases upgrade and roll back repeatably, preserve
workspace history, and pass supported-platform acceptance with known
limitations.

### Later — Controlled expansion

Cover letters, application answers, multilingual templates, additional or local
providers, portfolio imports, encrypted sync, and coach review remain gated by
the CV workflow. Cloud accounts, shared workspaces, external tools, and
application submission each require a separate architecture and threat-model
decision.

## Explicitly deferred

- Retrieval and index-version enforcement of bound CKB selection snapshots,
  normalized facts, source repair, reactivation, and cross-store writer
  coordination.
- Automatic move inference, reconciliation of unknown entries, background
  refresh, time-based freshness, and automatic retirement or deletion. The
  path-free lifecycle projection does not perform those actions or establish
  index freshness.
- Remote embeddings or a vector database before the local lexical baseline
  proves value and receives a separate architecture/privacy decision.
- Cloud sync, accounts, multi-tenancy, uncontrolled web research, job
  discovery, messaging, publishing, or application submission.
- General availability of additional artifacts before the CV workflow has
  outcome evidence.

## Success measures

Primary product measures are factual-invariant violations, required-section and
chronology preservation, CKB isolation, source/index freshness,
relevant-achievement recall, citation accuracy, irrelevant retrieval context,
requirement coverage, research-approval compliance, policy violations, useful
critic findings, ATS/visual readiness, review time, editing effort versus the
private manual baseline, approval/export completion, provider cost, and user
confidence. Test count, model count, and document count are activity indicators,
not product success.

## Stage evidence

Each stage exit records the achieved status level and date, acceptance criteria
and supported-platform results, product measures and representative-case
limitations, release tag and artifact manifest with checksums/SBOM, known
limitations, unresolved risks, and the next decision. Until those references
are recorded here or in a linked repository artifact, a stage is not Validated
or Released.

## Review cadence and change log

Review this roadmap after each stage exit, material pilot evidence, or at least
monthly while active development continues. A material change states what
changed, why, and what moved out to make room. Every stage exit also produces a
versioned release using [the release procedure](releasing.md).

The entries below record material product and stage decisions. Git history and
issues retain implementation chronology.

| Date       | Decision                                                                                                                                                                                                                   | Product implication                                                                                                                                                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-02 | Recorded #291 as indeterminate after the declared request timeout enabled a complete initial author/critic round but three confirmed-adjudication revision responses failed validation. | The exact two-accept, two-reject, six-nuance package and two accepted effects persisted before provider execution. The run exhausted after 959 active seconds without timeout, authentication, credit, or quota failure. #293 owns safe failure-stage classification and correction; #75 and #250 remain blocked. |
| 2026-09-02 | Recorded #290 as indeterminate after exact candidate adjudication staged successfully but revision execution exhausted its attempts. | Migration 26 persisted both version-1 artifact lineages and the confirmed one-accept, two-reject, nine-nuance package. One incorrect API-key attempt and two authenticated 120-second defaults produced no revision; this was not a credit failure. #291 must use the existing explicit 20-minute request timeout before #75 or #250 can advance. |
| 2026-09-02 | Implemented the bounded multi-run artifact-history fix #287; landing remains subject to review. | Distinct immutable artifact IDs can each start at version 1 in one workspace, while migration 26 preserves dependent history and foreign-key/immutability safeguards. After #287 lands, the materially different #286 findings still require review; #75 and #250 remain blocked. |
| 2026-09-02 | Recorded the fresh post-adjudication-infrastructure observation under #286 as indeterminate and bounded storage blocker #287. | The author succeeded on attempt three and the critic on attempt one within 307 active seconds, but twelve materially different findings required new human review. The durable run remained readable after typed history rejected a second run's distinct artifact version 1. No revision, approval, export, or submission occurred; #75 and #250 remain blocked. |
| 2026-09-01 | Delivered #278 persisted active-duration accounting for bounded orchestration. | Configured duration budgets now measure active author, critic, and revision time while excluding explicit human-review, pause, and provider-retry waits; focused deterministic checks cover legacy and restart behavior. The representative parity outcome remains unvalidated, and #75 and #250 remain blocked. |
| 2026-09-01 | Delivered #277 exact adjudication staging through the shared application/local boundary. | The application persists one immutable readiness report with complete accept/reject/nuance decisions and optional accepted-effect overrides without opening a provider. #277 is the prerequisite for #278 duration accounting; #75 and #250 remain blocked. |
| 2026-09-01 | Recorded the post-citation-completion observation under #275 as indeterminate. | Both provider roles completed on their first attempts, but readiness stopped on eight warnings and one unresolved chronology omission; the unsupported-claim finding was a warning, not a factuality error. Candidate adjudication is the next explicit boundary; #75 stays open and #250 remains blocked. |
| 2026-09-01 | Delivered bounded exact-value evidence citation completion in #272. | Omitted provider citations may be completed from exact matching retrieved chunks without changing claim content; unsupported protected values remain rejected. Another authorized #75 comparison is next, and #250 remains blocked pending that result. |
| 2026-08-31 | Recorded #271 as indeterminate and bounded exact-value evidence citation completion as #272. | Structured recovery reached all three author attempts, but one claim-text factual-invariant path remained after correction. No accepted author or critic result exists; #75 stays open and #250 remains blocked. |
| 2026-08-31 | Delivered the bounded structured Claude nonzero-exit classification fix in #267. | Structured session errors now retain safe classification without provider output; #75 remains unvalidated, another authorized comparison is next, and #250 remains blocked. |
| 2026-08-31 | Recorded #266 as indeterminate and bounded structured Claude nonzero-exit classification as #267. | The authenticated author transport returned a structured 429 without quota markers, but the adapter persisted non-retryable `unknown` before parsing it. No author or critic result exists; #75 stays open and #250 remains blocked. |
| 2026-08-31 | Closed #262 as indeterminate and bounded the per-evidence author-grounding guide as #264. | The guide is the current blocker before another authorized #75 attempt; parity remains unvalidated and #250 remains blocked. |
| 2026-08-31 | Recorded the corrective consented rerun under #262 as indeterminate. | Retry feedback moved the author beyond its initial output-token failure, but two subsequent attempts failed different single claim-text factual invariants. No accepted draft or critic result exists; #75 stays open and #250 remains blocked. |
| 2026-08-31 | Closed author-grounding blocker #258 and bounded author retry feedback as #260. | Parity remains unvalidated; #260 must close before another consented #75 attempt, and #250 remains blocked pending that outcome. |
| 2026-08-31 | Closed provider-timeout blocker #256 and bounded the next author-grounding blocker as #258. | #258 became the next gate before a fresh consented attempt; the pilot remained incomplete and unvalidated. |
| 2026-08-31 | Identified the provider-timeout blocker as #256 after the indeterminate #249 result. | The blocker was bounded for execution while the pilot remained incomplete and unvalidated. |
| 2026-08-30 | Recorded the first consented v0.9 workflow-parity observation as indeterminate. | The initial run timed out during revision and its one approved fresh retry timed out during authoring at the user-session adapter's 120-second limit. No revised or approved artifact exists; the role-mismatched manual baseline remains a limitation, #75 stays open, and #250 remains blocked. |
| 2026-08-30 | Added a provider-free synthetic trust preflight between the private comparison gate and the consented parity run. | #253 exercises eight sanitized deterministic scenarios before #249; its results are implementation evidence and cannot satisfy the consented outcome requirement. |
| 2026-08-30 | Split the v0.9 workflow-parity and release rollups into four dependency-ordered execution issues. | #248 predeclares the private comparison gate before #249 records the consented outcome; #250 prepares the release candidate only after #75 closes, and #251 records released evidence and the next decision before #76 closes. |
| 2026-08-30 | Integrated #74 controlled rendering QA into approved export. | Markdown uses deterministic integrity checks; PDF and DOCX use named byte inspectors before any file is written, and the content-free report is retained with export history. DOCX office pagination and clipping remain explicit limitations rather than implied certification. |
| 2026-08-30 | Integrated #73 exact application-readiness approval and export binding. | Human approval now follows a fresh deterministic decision for the current reviewed artifact, revisions invalidate it, and export accepts only the exact approved content checksum. |
| 2026-08-30 | Integrated the #72 live author handoff for adjudicated revisions. | The matching revision author receives the persisted content-safe plan with explicit accepted-effect, disagreement-preservation, and evidence-safety instructions; the remaining v0.8 sequence is #73, then #74. |
| 2026-08-30 | Added deterministic requirement-to-achievement planning before provider drafting. | Each selected achievement cites one unique retrieved chunk, uncovered requirements remain explicit, and zero relevant evidence blocks provider drafting. The implementation lives in a focused module while the local-runtime hotspot shrinks. |
| 2026-08-30 | Froze growth in the six concentrated TypeScript architecture hotspots. | New MVP behavior must live in focused modules, validation rejects hotspot line-count growth, and every extraction lowers the permanent baseline instead of allowing the monoliths to regrow. |
| 2026-08-30 | Cut live selected-CKB runs over to exact-version lexical retrieval. | The application rebuilds only the explicit lifecycle-ready selection, deterministically fuses multi-CKB hits, records content-free per-CKB traces, and sends only opaque chunk IDs with bounded text. Retrieval failure blocks selected runs instead of silently becoming zero context. |
| 2026-08-30 | Reset v0.8 around the smallest usable CV workflow and direct Luna execution. | Six existing issues now carry bounded MVP exits in dependency order. Standalone refactors, routine Maestro orchestration, subagents, generalized frameworks, and non-blocking polish are deferred; active work stops at 20 minutes. |
| 2026-08-30 | Replaced unbounded epic execution with an enforceable sprint-size and active-work budget. | Outcome rollups no longer enter implementation directly. Each child must fit one boundary, focused test surface, and PR; active implementation and review stops at 30 minutes and splits again instead of silently consuming hours. Required quality gates remain unchanged. |
| 2026-08-30 | Persisted the first CKB lexical projection and immutable workspace retrieval traces without cutting over live runs. | Migration 25 keeps CKB chunks and FTS rows separate from legacy evidence, binds one projection to an exact single-CKB source-version manifest, exposes stale/unindexed states, uses bounded deterministic fallback, and invalidates the whole derived projection on source-version deletion. Lifecycle-triggered indexing and application fan-out remain open #80 work. |
| 2026-08-30 | Defined the CKB-scoped lexical retrieval boundary before persistence and runtime integration. | Each CKB owns a replaceable exact-source-version FTS projection, multi-CKB retrieval is explicit application fan-out with deterministic fusion, and the workspace stores immutable content-free traces. Provider projections contain only bounded text and opaque citable chunk IDs; stale or unavailable indexes cannot silently become empty context. |
| 2026-08-30 | Validated the canonical candidate profile with a deterministic sanitized representative career. | A real temporary CKB and SQLite round trip preserves all 12 categories with exact candidate provenance, accepts private-project evidence without public proof, and keeps conflicts, duplicates, and omissions visible before review. This completes #66 while #80 retains ownership of future derived-index lifecycle behavior. |
| 2026-08-30 | Added the candidate-facing canonical-profile review surface. | The collecting desktop workspace can derive with explicit transmission approval, load immutable history, inspect bounded provenance, edit latest-draft fact values and issue statuses, review, and bind the exact selected reviewed version to the next run without exposing roots or stored selections. |
| 2026-08-30 | Defined canonical-profile lifecycle reconciliation without erasing audit history. | Drafts cannot become reviewed and reviewed profiles cannot enter new runs when their exact CKB selection is unavailable or changed. Immutable profiles, run references, and approved exports survive workspace backup/restore and audit retention; #80 owns derived-index cleanup. |
| 2026-08-30 | Bound exact reviewed canonical-profile versions to new runs. | Shared application, CLI, and desktop start contracts accept an opaque profile ID/version pair, verify reviewed status, checksum, and current CKB lifecycle selection, and persist only a safe reference in immutable context. Resume cannot replace it; legacy unbound runs remain readable. |
| 2026-08-30 | Added packaged-desktop host capabilities for the canonical-profile workflow. | Strict bridge and native-host operations use the active workspace, accept no store roots, require explicit derivation approval, and return an explicit bounded facts/issues/provenance projection without the stored selection snapshot. Lifecycle reconciliation, run binding, and visual profile UI remain open #66 work. |
| 2026-08-30 | Exposed canonical-profile derivation and review through the CLI. | The CLI derives only from the workspace's configured selection, requires an explicit provider-data flag, accepts no CKB store root, and provides provider-free exact/latest reads, history, edits, and review. Desktop host controls, lifecycle reconciliation, and run binding remain open #66 work. |
| 2026-08-30 | Added the shared application and local-driver canonical-profile workflow. | Adapter-neutral operations derive from the workspace's validated pinned CKB selection and provide provider-free immutable reads, history, edits, and candidate review without accepting or returning store roots. CLI/desktop host controls, lifecycle reconciliation, and exact reviewed-profile run binding remain open #66 work. |
| 2026-08-30 | Added configured-provider execution for canonical-profile extraction. | Explicitly approved, bounded path-free source text can use the workspace author model through existing API-key, authenticated user-session, or local transports. Strict local schema, citation, and grounding checks still own what can become a profile; application/CLI/desktop invocation, lifecycle reconciliation, and run binding remain open #66 work. |
| 2026-08-28 | Added integrity-verified, explicitly approved canonical-profile derivation from selected managed CKB versions. | Exact managed bytes are normalized without exposing paths; every proposed fact needs a locally verified source quote before its opaque citation maps to candidate-provided provenance, while application logic owns IDs, conflicts, duplicates, omissions, and append-only draft persistence. Provider/adapters, lifecycle reconciliation, and run binding remain open #66 work. |
| 2026-08-28 | Added workspace-local immutable canonical-profile history and provider-independent edit/review transitions. | Migration 24 stores checksum-verified linear versions with content-free audits. Profiles may combine CKBs and therefore remain outside single-CKB portable backups; derivation, retention/deletion, run binding, and adapters remain open #66 work. |
| 2026-08-28 | Added the first #66 canonical candidate-profile contract. | Profile versions can represent complete normalized career facts with exact selected CKB source-version provenance, visible conflicts and omissions, review blockers, and deterministic immutable round trips. Persistence, derivation, retention/backup behavior, run binding, and adapters remain open. |
| 2026-08-28 | Integrated immutable writing-policy history and explicit opportunity-bound overrides through shared application, CLI, and desktop contracts. | Candidates can activate or import local versions, inspect safe history, and select one complete imported override for an exact reviewed opportunity. Runs pin base and override lineage without mutating the workspace default; both model roles receive the effective policy. |
| 2026-08-28 | Bound an exact reviewed opportunity version into immutable run context. | Start requires an explicit brief ID/version pair, verifies reviewed status and checksum, derives opportunity context only from that record, and stores a safe reference. Resume reuses the snapshot; URLs, paths, raw intake, and provenance do not enter provider-facing context. |
| 2026-08-28 | Integrated durable opportunity create, reload, list, edit, and review through the shared application, CLI, and packaged-desktop host contracts. | CLI paths remain runtime-only, desktop files use native pickers, renderer results omit paths and URLs, provider extraction requires explicit per-create approval, and stale edits or reviews fail closed. Exact reviewed planning handoff remains open. |
| 2026-08-27 | Added provider-backed structured opportunity extraction and typed local candidate instructions. | Approved opportunity text crosses the existing author-provider boundary only after explicit consent; candidate inputs and local provenance stay local, response citations are allowlisted, application IDs are deterministic, and failures remain visible without leaking provider or source content. Shared adapters and exact reviewed planning handoff remain open. |
| 2026-08-27 | Added durable local opportunity-brief version persistence and restart recovery. | Workspace-scoped SQLite versions are append-only, checksum-verified, parent-linked, and protected from stale edits; audit events remain content-free. Extraction, shared adapters, and exact reviewed planning handoff remain open. |
| 2026-08-27 | Added structured tone, spelling-locale, and verbosity preferences to the selected writing-policy snapshot. | Both model roles receive the same bounded advisory preferences through immutable run context. Spell checking, numeric length enforcement, layout selection, policy history/migration, anti-formulaic defaults, opportunity overrides, and shared editing remain open. |
| 2026-08-27 | Added the next #67 secure process-local opportunity intake and review component. | Multiple approved URL/file/pasted/instruction sources can form one immutable versioned draft with honest checksums and content-free visible failures. Persistence, extraction, shared adapters, and planning handoff remain open. |
| 2026-08-27 | Added the next #70 structured writing-policy enforcement component. | Exact forbidden-term and punctuation rules compiled from the selected local policy are frozen into run context and checked during normal orchestration with stable, content-free locations. Policy history/migration, broader preferences, opportunity overrides, and shared editing remain open. |
| 2026-08-27 | Added the first #67 provider-independent opportunity-brief contract and pure builder. | Draft and reviewed versions distinguish opportunity facts from candidate instructions, retain source provenance and visible limitations, and reject unreviewed or instruction-contaminated facts. Persistence, ingestion, adapters, provider extraction, and exact reviewed-version planning handoff remain open. |
| 2026-08-27 | Accepted the #78 reusable CKB foundation after its source-lifecycle, selection, product-control, and storage-safety deliveries passed the program audit. | Candidates can maintain and explicitly select isolated CKBs through shared CLI/desktop contracts; immutable run snapshots retain exact source versions, while lifecycle, retention, backup/restore, and deletion preserve provenance and unknown data. #80 remains the sole owner of retrieval/index construction, freshness, and query enforcement. |
| 2026-08-27 | Accepted the delivered #113 storage-safety boundary after auditing all six leaf outcomes and the current validation gate. | Store-wide leases and prospective journals make owned mutations recoverable; six retention classes are explicit, with classes not yet supplied by #80 reported as not materialized. Portable backup/restore preserves logical provenance without machine-origin continuity, and exact-plan deletion retains an immutable content-free audit while preserving unknown or unowned data. |
| 2026-08-27 | Accepted the delivered #111 CKB-selection boundary after a criterion-by-criterion audit and a green repository validation gate. | One default and optional isolated CKBs can be selected only through explicit local action; immutable path-free source-version snapshots persist in new runs, survive restart and legacy migration, and fail closed on lifecycle drift. Retrieval/index versions, freshness, and query enforcement remain owned by #80. |
| 2026-08-26 | Published [v0.7.0-alpha.3](https://github.com/akoita/draft-loop/releases/tag/v0.7.0-alpha.3) with [checkpoint evidence](stage-evidence-v0.7.0-alpha.3.md) after release prep PR [#197](https://github.com/akoita/draft-loop/pull/197). | The released checkpoint freezes the post-alpha.2 confirmed-deletion slice, provider-independent readiness/adjudication/stopping/layout foundations, the first dormant runtime carrier, and Windows user-session environment hardening. It does not validate or complete v0.7; profile, opportunity, retrieval, planning, complete-CV, writing-policy, runtime/UI integration, and representative validation remain. |
| 2026-08-26 | Published [v0.7.0-alpha.4](https://github.com/akoita/draft-loop/releases/tag/v0.7.0-alpha.4) with [checkpoint evidence](stage-evidence-v0.7.0-alpha.4.md) after feature PR [#199](https://github.com/akoita/draft-loop/pull/199) and release prep PR [#200](https://github.com/akoita/draft-loop/pull/200). | The released checkpoint carries forward Windows user-session environment hardening and adds packaged-desktop OpenAI authentication selection (API key or authenticated Codex/ChatGPT session), independent per-provider persisted preferences, strict environment precedence, restart-required/no-silent-fallback behavior, and Codex reasoning lifecycle compatibility while continuing to reject tool events and ignore reasoning content. It does not validate or complete v0.7; profile, opportunity, CKB retrieval/reactivation, planning, complete CV, writing policy, runtime review/readiness/rendering integration, and representative validation remain, with signing, updates, and CLI packaging incomplete. |
| 2026-08-26 | Published [v0.7.0-alpha.5](https://github.com/akoita/draft-loop/releases/tag/v0.7.0-alpha.5) with [checkpoint evidence](stage-evidence-v0.7.0-alpha.5.md) after feature PR [#202](https://github.com/akoita/draft-loop/pull/202) and release prep PR [#203](https://github.com/akoita/draft-loop/pull/203). | The released checkpoint carries forward alpha.4's packaged-desktop OpenAI authentication selection and fixes Windows/session critic compatibility by accepting and discarding passive `todo_list` and `item.updated` lifecycle output while commands, mutations, search, tool, error, and unknown event/item types remain fail-closed. It does not validate or complete v0.7; profile, opportunity, CKB retrieval/reactivation, planning, complete CV, writing policy, runtime review/readiness/rendering integration, and representative validation remain. |
| 2026-08-26 | Added packaged-desktop provider authentication mode selection for OpenAI API keys or an authenticated Codex/ChatGPT session. | Windows subscription-backed provider authentication is now represented in the desktop preference and UI; focused checks cover the boundary, while representative Windows validation and release support remain open. |
| 2026-08-26 | Made milestone 3 dependency-closed and ordered its open prerequisites before the review/readiness outcomes. | #66–#70, #78, #80, #111, and #113 joined the sprint. Work now proceeds #111 → #113 → #78; #67/#70; #66 → #80 → #68; #69; then #72 → #73 → #74, without leaving the sprint for an open blocker. |
| 2026-08-26 | Implemented confirmed deletion #166 as an independently closable prerequisite on the #69 dependency chain. | An archived non-default CKB can be deleted only with an exact fresh-plan token under the store-wide lease. Verified managed data is staged and recoverable, blockers fail closed, unknown or unowned entries are preserved, and CLI/desktop results stay path-free. |
| 2026-08-26 | Added the first #74 controlled-layout and rendering-QA contract component. | A4 profile selection, content-free deterministic integrity signals, local active-content checks, and inspectable PDF page targets are available behind package contracts; independent viewer evidence, visual golden tests, adapters, persistence, UI selection, approval/export wiring, and full #74/#69/#73 integration remain out of scope. |
| 2026-08-26 | Integrated #73 application-readiness stopping decisions into the approval and export boundary. | Approval freshly evaluates the current artifact and persists the strict decision plus exact content/version binding; deterministic/report errors, unmet thresholds, disputed dimensions, incomplete independence or inputs, and missing accepted revision effects block approval. Revision or artifact replacement clears the binding, and export verifies the exact application-ready approval. Provider, presentation, rendering-QA, and broader #69/#70/#72 integration remain open. |
| 2026-08-26 | Added the first #72 author-adjudication and artifact-revision trace component behind strict provider-independent contracts. | The contract requires one explicit accept/reject/nuance rationale for each report finding; accepted effects are proven only by bounded artifact diffs or explicit effect overrides, while disagreements remain visible. The separate runtime-carrier slice is limited to existing snapshots and revision execution; report generation, provider prompt, CLI, and desktop integration remain gated by #69. |
| 2026-08-26 | Added the first #72 runtime-carrier slice in the dormant orchestrator boundary. | Existing run snapshots retain the exact report, canonical plan, accepted-effect overrides, and derived trace across restart; only the matching revision author receives the pending carrier. Report generation, persistence tables, provider prompt integration, UI controls, approval/export wiring, and complete #69/#70/#72 integration remain out of scope. |
| 2026-08-25 | Published [v0.7.0-alpha.2](https://github.com/akoita/draft-loop/releases/tag/v0.7.0-alpha.2) with [Sprint 2 checkpoint evidence](stage-evidence-v0.7.0-alpha.2.md). | The released storage-safety foundation does not complete or validate the v0.7 drafting outcome. |
| 2026-08-25 | Ended Sprint 2 after #161–#165 and returned confirmed deletion #166 to the unmilestoned backlog following a capacity audit. | Five storage feature PRs added 10,365 lines across 71 file-changes. Future sprint work must be admitted from measured, independently closable units rather than broad feature narratives. |
| 2026-08-25 | Bounded portable CKB restore to new destinations with an explicit fail-if-existing collision policy. | Restore re-inspects and migrates a package transactionally, preserves logical IDs and safe provenance, publishes only a validated store, and deliberately recreates no machine origin or active ownership; merge and rename modes remain out of scope. |
| 2026-08-24 | Defined portable CKB backup as a strict directory package with a logical manifest and checksum-addressed managed objects. | Export requires destination approval, complete ownership evidence, self-inspection, and no-replace manifest-last publication; machine-local origins, locks, journals, credentials, and workspace data stay out, while #165 owns restore. |
| 2026-08-24 | Defined append-only CKB retention policy and deterministic effective-revision planning across six explicit data classes. | Legacy data remains retained by default; holds override expiry, only proven managed raw versions can become eligible, and #166 retains the separate confirmation and physical-deletion boundary. |
| 2026-08-24 | Made new managed CKB writes recoverable from versioned owned journal records under the store-wide lease. | Restart reconciliation rolls back verified pre-commit artifacts or completes verified committed cleanup, reports only path-free operation status, and preserves legacy, unknown, unjournaled, or mismatched data. |
| 2026-08-24 | Started Sprint 2 with #161's recoverable store-wide writer lease and fenced, content-free conflict contract. | Current direct and multi-step CKB mutations share one exclusive command scope; a private coordinator remains separate from replaceable CKB data so #164–#166 can reuse it for backup, restore, and deletion. |
| 2026-08-24 | Completed Sprint 1 by closing #160 and published [v0.7.0-alpha.1](https://github.com/akoita/draft-loop/releases/tag/v0.7.0-alpha.1), with [checkpoint evidence](stage-evidence-v0.7.0-alpha.1.md). | The CKB foundation is a Released checkpoint; the v0.7 stage remains incomplete and unvalidated, with Sprint 2 planned but not started. |
| 2026-08-24 | Reframed GitHub milestones as bounded delivery sprints: Sprint 1 closes the CKB foundation with #160, while Sprint 2 delivers storage safety through #161–#166; broad issues #66–#70, #80, #111, and #113 remain unmilestoned epics. | Milestone progress now measures independently closable outcomes instead of PR volume inside long-lived epics. Closing #112 records the delivered shared lifecycle surface while its storage, retrieval, and migration residuals remain explicit in their leaf issues. |
| 2026-08-24 | Exposed confirmed directory add-members through shared CLI and desktop contracts.                                                                                                                                          | One bounded scan appends unmatched files in deterministic order; complete or partial results contain capped opaque source identities and counts while roots, paths, labels, hashes, checksums, and content remain local.                                                       |
| 2026-08-24 | Exposed directory reconciliation preview and confirmed retirement apply through shared CLI and desktop contracts.                                                                                                         | Complete scans partition member state path-free; apply acts only on explicitly approved missing source IDs, preserves deterministic partial progress, and refuses incomplete scans through the shared application contract.                                                    |
| 2026-08-24 | Exposed moved-candidate preview and confirmed one-source directory member move through shared CLI and desktop contracts.                                                                                                  | Both controls derive targets from one bounded local scan and expose only opaque identity, time, status, and counts. Move changes only the selected member origin under atomic guards; no target path crosses an adapter boundary.                                                |
| 2026-08-24 | Exposed bounded directory-refresh preview and confirmed apply through shared CLI and desktop contracts.                                                                                                                    | The remembered root remains sensitive local state. Preview is read-only; apply rescans, records observations, and appends changed same-member sources in deterministic order, with capped path-free complete or partial progress.                                                  |
| 2026-08-24 | Exposed guarded directory-root rebind preview and confirmed apply through shared CLI and desktop contracts.                                                                                                                | Candidate roots remain runtime-only or native-host local; apply repeats the bounded exact-membership scan and atomically guards the root revision plus member origins. Results contain only opaque identity, status, time, and counts.                                             |
| 2026-08-24 | Exposed exact-byte single-file origin rebind, path-free retirement state, and confirmed logical retirement through shared CLI and desktop contracts.                                                                       | Replacement paths remain runtime-only or native-host local; retirement is idempotent, preserves evidence, blocks later mutation, and is not presented as deletion. No reactivation control exists.                                                                                |
| 2026-08-24 | Exposed bounded directory intake through shared CLI and desktop contracts.                                                                                                                                                 | The CLI root is runtime-only and the desktop owns a native picker; complete and partial results expose scan counts plus capped opaque source/version identities while roots, filenames, hashes, labels, checksums, and content remain local. Rebind and reconciliation were separate controls. |
| 2026-08-24 | Exposed path-free source origin status, persisted refresh state, remembered-file refresh, and separately approved URL refresh through shared CLI/desktop contracts.                                                        | File origins and URL provenance remain sensitive local state; adapter results contain only opaque identity, lifecycle status, timestamps, and a created version ID. Rebind was delivered as a separate control.                                                                |
| 2026-08-24 | Exposed explicit one-source file-version append through the shared CLI and desktop application contracts.                                                                                                                  | Runtime append paths remain outside renderer IPC and generic results, identical bytes are a no-op, changed bytes extend immutable lineage, and the remembered origin binding is preserved. Refresh/rebind remain separate controls.                                               |
| 2026-08-24 | Exposed explicitly approved CKB URL intake through the shared CLI and desktop application contracts.                                                                                                                       | Both adapters preserve centralized HTTPS/network safety and emit only opaque source/version identity; URLs, query strings, labels, and fetched content remain local. Later-version mutation remains a separate control.                                                          |
| 2026-08-24 | Exposed explicit single-file CKB intake through shared CLI and desktop application contracts.                                                                                                                              | The CLI accepts an intentional local path while the desktop host owns a dedicated picker; renderer results contain only opaque source/version identity. URL/directory intake and later-version mutation were delivered as separate controls.                                    |
| 2026-08-23 | Exposed bounded, path-free CKB source, duplicate, and managed-file inventory inspection through the shared CLI/desktop boundary.                                                                                           | Users can review source identities and structural warnings without renderer-visible roots or generic diagnostic leakage; intake, refresh/rebind, cleanup, and one cross-command snapshot remain separate controls.                                                               |
| 2026-08-23 | Added fail-closed application-operation drift checks for immutable run CKB selections.                                                                                                                                    | Provider-capable start, resume, and revision compare fresh lifecycle evidence with the run record before execution or mutation; retrieval/index versions, adapter controls, and cross-store writer coordination remain separate.                                                  |
| 2026-08-23 | Bound explicit local CKB choices to workspace configuration and freshly validated, immutable run-context snapshots.                                                                                                      | New runs pin exact path-free store/CKB/source/version identities while old runs remain reproducible; adapter controls, CKB retrieval, provider use, index versions, and pre-provider drift enforcement remain separate work.                                                      |
| 2026-08-23 | Added the first #111 contract slice: canonical path-free CKB/source-version selection snapshots with explicit multi-CKB approval.                                                                                         | Safe lifecycle revisions make the selected versions auditable and available to immutable context records, while workspace/run binding, provider use, adapter controls, index versions, and drift enforcement remain unintegrated.                                               |
| 2026-08-23 | Added the deterministic path-free lifecycle-readiness projection for #136 without claiming indexing or product integration.                                                                                               | One consistent CKB snapshot blocks ineligible latest source versions and exposes a structured non-sensitive revision for #80. Live checks, TTLs, index construction/freshness, application selection, adapters, deletion, and repair remain separately owned.                         |
| 2026-08-23 | Added complete explicit missing-member reconciliation for #135 without advancing the v0.7 stage beyond component implementation.                                                                                          | One bounded scan partitions every member and unmatched file path-free; explicit retirement selections run in lexical source-ID order with guarded atomic markers and an explicit partial result after a later failure. Physical deletion, automatic decisions, adapters, indexing, and #136 remain deferred. |
| 2026-08-23 | Completed the bounded #110/#134 directory-member component slices, including append-only member revisions, guarded root rebind, and the explicit one-source member move.                                                   | Root rebind and one-source move are implemented at component/application-contract level. The move is one-scan, exact-integrity, selected-source only, path-free, and returns `moved`/`current`; automatic inference and complete reconciliation under #135/#136 remain deferred. |
| 2026-08-22 | Split the oversized application-grade milestone into v0.7 evidence-backed drafting, v0.8 independent review/readiness, and v0.9 workflow parity/release; decomposed #78 into #110–#113 and moved hybrid retrieval to #114. | The current stage has one coherent drafting outcome; optional research (#79) and vector/hybrid optimization (#114) are outside its critical path.                                                                                                                                |
| 2026-08-15 | Reset stage claims to Designed/Implemented/Integrated/Validated/Released evidence levels and published v0.6.0 as a non-validated alpha after the representative quality failure.                                           | Integration, packaging, and synthetic evidence remain useful, but application readiness must be demonstrated again in v0.7.                                                                                                                                                      |
| 2026-08-12 | Created the living roadmap for a local integrated alpha.                                                                                                                                                                   | Product direction moved from phase-0 implementation toward packaged integration and real outcome validation.                                                                                                                                                                     |

[adr-0007]: adr/0007-portable-candidate-knowledge-store.md
