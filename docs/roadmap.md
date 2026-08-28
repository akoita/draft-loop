# Product vision and roadmap

**Status:** Living document<br>
**Last reviewed:** 2026-08-28<br>
**Current stage:** Evidence-backed CV drafting (v0.7)

This document describes product direction, not fixed delivery dates. **Now** is
the current commitment, **Next** is planned work that may change after
discovery or pilot evidence, and **Later** is directional. The status model
describes evidence for a product outcome; it does not count lines of code or
package-level capabilities.

GitHub milestones are dependency-closed delivery sprints. Every open prerequisite
of a sprint issue belongs to the same milestone and is ordered before the work
it enables; completed prerequisites remain in their historical milestones.
This keeps execution inside the visible sprint scope. Broad outcome issues may
join a sprint when they are required for its exit, while implementation should
still proceed through independently closable slices.

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
| Integrated author–critic workspace | Integrated foundation; [Released alpha.4 checkpoint](stage-evidence-v0.7.0-alpha.4.md); [Released alpha.5 checkpoint](stage-evidence-v0.7.0-alpha.5.md); v0.7 incomplete/unvalidated | CLI and packaged Electron use the shared application driver for local file and approved URL intake, provenance, SQLite run history, bounded orchestration, review decisions, restart recovery, and Markdown/DOCX/PDF export. Desktop provider preflight, credential handling, and Anthropic/OpenAI live paths have focused cross-platform checks.                                                                                            |
| Application-grade quality          | v0.6 release; validation failed       | The sanitized representative run exported, but omitted major CV sections and chronology, changed seniority, and introduced unsupported quantification. v0.6.0 is an explicitly non-validated alpha baseline; this failure is the defining input to v0.7.                                                                                                                                                                                     |
| Workspace retrieval and policy     | Policy integrated; retrieval partial  | Workspace-scoped SQLite FTS/BM25 supplies selected chunks to live requests. Writing policies have immutable local history, structured preferences and deterministic rules, shared CLI/desktop controls, and explicit reviewed-opportunity overrides. Runs pin effective/base/override lineage and supply the effective policy to both model roles. Application-grade drafting and CKB retrieval integration remain open. |
| Opportunity brief                  | Integrated reviewed-version handoff      | A strict provider-independent contract and shared CLI/packaged-desktop host workflows assemble approved URLs, selected files, pasted content, and typed local candidate instructions into immutable draft/review versions with honest provenance and visible failures. New runs can pin one exact checksum-verified reviewed version; resume reuses the immutable context. Provider extraction and run transmission each retain explicit approval boundaries.                    |
| Portable CKB                       | [Released Sprint 2 checkpoint](stage-evidence-v0.7.0-alpha.2.md); [Released alpha.3 checkpoint](stage-evidence-v0.7.0-alpha.3.md); #78 accepted; v0.7 incomplete/unvalidated | The reusable CKB foundation is complete: stable source identity and immutable versions, explicit lifecycle/readiness evidence, isolated application/run selection, shared CLI/desktop controls, coordinated recovery, six-class retention planning, portable backup/restore, and exact-plan deletion. Retrieval/index construction remains #80 scope. |
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
and unknown event/item types remain fail-closed. See [the architecture](architecture.md) for stable boundaries and
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
that application. SQLite FTS/BM25 remains the current local baseline; vector or
hybrid retrieval requires measured gains in relevant-achievement recall and
citation accuracy without more unsupported claims. Remote embeddings or vector
storage require a separate architecture and privacy decision. User-approved
research remains distinct from candidate evidence and cannot create experience,
contact employers, or submit applications.

## Roadmap

| Horizon  | Stage                                                                                                             | Evidence status                                      | Outcome                                                                               | Remaining gate                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Previous | Integration hardening and outcome validation ([v0.6.0](https://github.com/akoita/draft-loop/releases/tag/v0.6.0)) | Released; validation failed                          | Preserve a reproducible integrated baseline without overstating application readiness | Failed representative result carried into v0.7; see [stage evidence](stage-evidence-v0.6.0.md)                          |
| Now      | Evidence-backed CV drafting (v0.7 program) | [Released alpha.3 checkpoint](stage-evidence-v0.7.0-alpha.3.md); [Released alpha.4 checkpoint](stage-evidence-v0.7.0-alpha.4.md); [Released alpha.5 checkpoint](stage-evidence-v0.7.0-alpha.5.md); v0.7 incomplete/unvalidated | Produce a complete factual, source-traceable application draft | Reviewed profile and opportunity, lexical retrieval, planning, complete CV, writing policy, runtime/UI integration, and representative validation remain |
| Next     | Independent review and readiness ([milestone v0.8.0](https://github.com/akoita/draft-loop/milestone/3))           | Dependency-closed sprint; #71 report, #72 adjudication/trace plus its first runtime-carrier slice, and #73 stopping-decision contract component implemented | Turn the factual draft into a reviewed, revised, human-approvable artifact            | Finish the in-sprint CKB, profile, opportunity, retrieval, planning, artifact, and policy prerequisites before the remaining review, readiness, and rendering integration |
| Next     | Workflow parity and release ([milestone v0.9.0](https://github.com/akoita/draft-loop/milestone/4))                | Designed; parity validation not started              | Demonstrate the complete application-grade workflow and publish evidence              | Consented comparison, zero factual regression, bounded editing, and cross-platform release evidence                     |
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

### Now — Evidence-backed CV drafting (v0.7)

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
implemented as a standalone prerequisite on the #69 dependency chain. Milestone
3 now includes open prerequisite epics #66–#70 and #80 so no
remaining sprint issue depends on open work outside the sprint.

**Exit criterion:** One default and optional additional isolated CKBs can be
maintained and explicitly selected without source or retrieval leakage; selected
source versions produce a reviewed profile and opportunity brief; CKB-scoped
lexical retrieval supports a planned, complete CV whose required sections,
chronology, factual invariants, provenance, and writing-policy checks pass.

### Next — Independent review and readiness (v0.8)

Produce the structured independent readiness report (#71), record per-finding
author adjudication and artifact revision (#72), apply calibrated stopping
rules (#73), and render a professional ATS-readable DOCX/PDF with visual QA
(#74).

The milestone executes its dependency graph rather than starting with the final
review issues. The CKB foundation roll-ups (#111, #113, and #78) and the
independent opportunity and writing-policy inputs (#67 and #70) are complete.
Next deliver the profile, lexical retrieval, and planning chain: #66, #80, and
issue #68, followed by the complete artifact (#69). Then complete issues #72, #73,
and #74; #71 is already closed. Closed prerequisites such as #60 and #110 remain
in their historical milestones.

The #71 component is implemented as a strict, provider-independent report
contract and pure assembler. The first #72 component is implemented as strict
author-adjudication and artifact-revision trace contracts with pure plan,
diff, and effect helpers. The first #73 component is implemented as a strict
application-readiness stopping-decision contract and pure evaluator. Runtime
lifecycle, human approval/export/version invalidation, persistence/history,
budget accounting, providers, CLI/desktop wiring, and full #69/#70/#72
integration remain out of scope. The v0.8 outcome remains blocked on the
complete drafting and writing-policy dependencies in #69 and #70. The v0.8
stage remains Next and incomplete; these components do not claim the
milestone is complete.

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

The first #74 component is implemented as controlled A4 layout profiles and a
strict, content-free rendering-QA report builder. It preserves exact visible
content and ordering signals, detects local active-content signatures, and
inspects PDF page targets. PDF/DOCX reports remain incomplete without an
independent viewer observation; renderer self-extraction is not independent
ATS or visual evidence. The current PDF/DOCX implementations remain minimal.
Visual golden tests, viewer adapters, link modeling, persistence, UI profile
selection, approval/export wiring, and complete #69/#73 integration are not
delivered. This is the first #74 component only; #74 and v0.8 remain incomplete
and unvalidated.

**Exit criterion:** The complete factual draft receives an independent critique
and traceable revision; unresolved disagreements remain visible; deterministic
factuality, completeness, chronology, ATS, and approval gates prevent a
regressed artifact from being labelled application-ready.

### Next — Workflow parity and release (v0.9)

Compare the complete workflow with the consented private manual baseline using
predeclared factuality, completeness, recall, coverage, effort, cost,
confidence, and usability measures (#75), then publish evidence, artifacts,
manifests, checksums, platform results, limitations, and the next decision
(#76).

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
| 2026-08-26 | Added the first #73 application-readiness stopping-decision component behind strict provider-independent contracts. | Deterministic and report errors, unmet thresholds, disputed dimensions, incomplete independence or inputs, and missing accepted revision effects block readiness; stop precedence and limitations remain inspectable. Runtime lifecycle, human approval/export/version invalidation, persistence/history, budget accounting, providers, CLI/desktop, and full #69/#70/#72 integration remain out of scope. |
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
