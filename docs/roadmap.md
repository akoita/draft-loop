# Product vision and roadmap

**Status:** Living document<br>
**Last reviewed:** 2026-08-24<br>
**Current stage:** Evidence-backed CV drafting (v0.7)

This document describes product direction, not fixed delivery dates. **Now** is
the current commitment, **Next** is planned work that may change after
discovery or pilot evidence, and **Later** is directional. The status model
describes evidence for a product outcome; it does not count lines of code or
package-level capabilities.

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
| Integrated author–critic workspace | Integrated foundation                 | CLI and packaged Electron use the shared application driver for local file and approved URL intake, provenance, SQLite run history, bounded orchestration, review decisions, restart recovery, and Markdown/DOCX/PDF export. Desktop provider preflight, credential handling, and Anthropic/OpenAI live paths have focused cross-platform checks.                                                                                            |
| Application-grade quality          | v0.6 release; validation failed       | The sanitized representative run exported, but omitted major CV sections and chronology, changed seniority, and introduced unsupported quantification. v0.6.0 is an explicitly non-validated alpha baseline; this failure is the defining input to v0.7.                                                                                                                                                                                     |
| Workspace retrieval and policy     | Partial integration                   | Workspace-scoped SQLite FTS/BM25 supplies selected chunks to live requests. The initial workspace writing-policy slice is integrated behind explicit local selection. Neither establishes reusable CKB selection or application-grade drafting.                                                                                                                                                                                              |
| Portable CKB                       | Implemented component; not integrated | The separate local store has logical identity, source/version provenance, managed bytes, local-only origins, URL provenance, retirement markers, and a prospective write journal. Explicit file/URL operations and bounded directory operations are available behind application contracts.                                                                                                                                                  |
| CKB directory recovery             | Implemented bounded components        | Root rebind and one-source member move are guarded, one-scan operations. The #135 reconciliation contract partitions every member path-free, requires explicit retirement selections, and processes them in deterministic source-ID order. Each marker is atomic; a later failure returns explicit partial progress. No operation accepts or returns a path.                  |
| Product CKB workflow               | Integrated control foundation         | Shared CLI/desktop controls create, open, select, rename, and archive CKBs without projecting roots through the renderer; archive has an explicit confirmation boundary. Read-only adapters expose bounded path-free source/version summaries, duplicate groups, lifecycle readiness, structural inventory, origin status, persisted refresh state, and retirement state. Explicit single-file, directory, and URL intake, one-source file-version append, remembered-file refresh, approved URL refresh, exact-byte file-origin rebind, confirmed logical retirement, and guarded directory-root rebind use shared application contracts; host paths and URL provenance remain local. Workspace bindings pin store/CKB identities and record freshly validated source/version selections in new run contexts, with fail-closed drift checks. Retrieval, remaining directory lifecycle, reactivation, deletion, backup/restore, and provider use remain outside the product path. |

The portable store is therefore component progress, not a v0.7 stage exit. See
[the architecture](architecture.md) for stable boundaries and
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
membership; add-members, observation, existing-member refresh, missing-member
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
| Now      | Evidence-backed CV drafting ([milestone v0.7.0](https://github.com/akoita/draft-loop/milestone/2))                | Designed; portable CKB component implemented         | Produce a complete factual, source-traceable application draft                        | Integrated CKB selection/lifecycle, reviewed profile and opportunity, lexical RAG, plan, complete CV, and policy checks |
| Next     | Independent review and readiness ([milestone v0.8.0](https://github.com/akoita/draft-loop/milestone/3))           | Designed; foundation components partially integrated | Turn the factual draft into a reviewed, revised, human-approvable artifact            | Structured critique, adjudication, calibrated readiness gates, and professional rendering                               |
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
storage components:

- Finish CKB intake, refresh, selection, shared CLI/desktop controls, and
  lifecycle safety through #110–#113, with #78 tracking the combined outcome.
- Derive a candidate-reviewed canonical profile (#66), assemble a reviewed
  opportunity brief (#67), and use the CKB-scoped SQLite FTS/BM25 baseline
  (#80).
- Plan requirement-to-achievement coverage, compose every required CV section
  without factual or chronological regression, and apply a versioned writing
  policy (#68–#70).

Optional user-approved research (#79) and vector/hybrid evaluation (#114) are
outside this critical path. Source lifecycle work through #136, workspace/run
binding through #111, and the first path-safe CLI/desktop CKB controls from #112
are implemented, including explicit selection and combination approval plus
bounded source, duplicate, and structural inventory inspection and explicit
single-file, bounded directory, and approved URL intake, one-source file-version
append, path-free status/refresh controls, exact-byte rebind, and confirmed
logical retirement. They do not satisfy the stage without remaining directory
lifecycle controls beyond root rebind, retrieval enforcement, and drafting
integration.

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
  normalized facts, source repair, reactivation, deletion,
  backup/export/restore, directory reconciliation/member-move adapters, and
  cross-store writer coordination.
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
