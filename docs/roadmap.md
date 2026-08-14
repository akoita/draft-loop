# Product vision and roadmap

**Status:** Living document
**Last reviewed:** 2026-08-15
**Current stage:** Integration hardening and outcome validation

This document describes product direction, not fixed delivery dates. The
**Now** horizon is the current commitment; **Next** is planned but may change
after technical discovery or pilot evidence; **Later** is directional. Update
the review date and the change log whenever priorities materially change.

## Vision

DraftLoop helps a candidate produce a job-specific CV that is relevant,
evidence-backed, and genuinely theirs. Independent author and critic agents can
propose and challenge changes, but the candidate retains control over source
material, provider exposure, factual claims, and final approval.

The initial product is a local-first desktop workspace for one CV and one job
application. Expansion to other application artifacts should follow only after
this workflow demonstrates better quality or lower user effort on real,
consented cases.

## Product principles

- Evidence before eloquence: substantive claims remain traceable to user-owned
  sources.
- Agents advise; people decide: export requires a visible approval boundary.
- Local by default: provider transmission is explicit and scoped.
- Independent review: provider and model identities are visible, and
  cross-company diversity is the default.
- Measured expansion: new retrieval, providers, and workflows must improve a
  defined outcome rather than only add capability.

## Status model

Roadmap status describes evidence, not percentage complete. A stage may contain
components at different levels; the table states the strongest level supported
for the stage outcome as a whole.

| Level | Meaning | Required evidence |
| --- | --- | --- |
| Designed | The user outcome, boundaries, and acceptance criteria are documented. | Roadmap scope and relevant architecture or ADRs |
| Implemented | The capability exists behind package contracts and has focused automated checks. | Code and deterministic tests |
| Integrated | The capability is connected through the intended CLI or desktop workflow. | End-to-end or packaged workflow evidence |
| Validated | The outcome has been demonstrated under representative conditions, including real or safely sanitized inputs where required. | Recorded acceptance results and product measures |
| Released | A versioned artifact has been published with traceable manifests, checksums, platform results, and known limitations. | Release evidence linked from the stage record |

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
the packaged Linux smoke workflow provide strong implementation evidence. They
do not replace cross-platform installed-app acceptance with representative real
inputs. Windows and macOS real-input results, the complete desktop transmission
preflight, provider-error recovery, and measured real-application outcomes are
not yet recorded as validated stage evidence.

The workspace-scoped SQLite FTS/BM25 baseline is now connected to the local
orchestration engine, and live provider requests receive retrieved chunks rather
than the complete ingested candidate corpus. Local vector and hybrid retrieval
remain evaluation components pending representative comparison and lifecycle
evidence.

Several later-stage components also exist: local lexical/vector retrieval,
provider retry and progress behavior, a consented pilot harness, backup and
restore, retention purge, content-free diagnostics, ATS checks, additional
artifact schemas, multilingual templates, a local endpoint adapter, and
portfolio ingestion. These are component-level implementations or partial
integrations. They do not establish that the retrieval, pilot, production-beta,
or controlled-expansion outcomes are complete.

## Roadmap

| Horizon | Stage | Evidence status | Outcome | Remaining gate |
| --- | --- | --- | --- | --- |
| Now | Integration hardening and outcome validation | Integrated; validation incomplete | Complete a representative application safely and recoverably in the packaged desktop app | Cross-platform real-input acceptance, desktop provider preflight, recovery evidence, stage release |
| Next | Retrieval and provider quality | Integrated lexical baseline; candidate components have partial benchmark evidence | Improve evidence selection and make live runs dependable | Representative quality comparison, deletion/retention proof, integrated cancellation and provider recovery |
| Next | Real-application pilot | Implemented harness; not outcome-validated | Validate factuality, quality, and user-effort hypotheses | Consented cases, calibrated measures, recorded results and limitations |
| Later | Production-ready beta | Partial implementation; not production-validated | Distribute a safe, dependable desktop application | Signed installers, safe updates/migrations, platform acceptance, recovery and accessibility evidence |
| Later | Controlled expansion | Implemented prototypes and components; gated | Extend a proven workflow without weakening trust boundaries | Core CV pilot evidence, separate integration/validation, updated threat decisions |

### Now — Integration hardening and outcome validation

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

### Next — Retrieval and provider quality

Improve evidence selection only where measurement shows value.

- Preserve the provider-independent retrieval port and workspace-scoped SQLite
  FTS/BM25 baseline.
- Compare local embeddings and hybrid lexical/vector retrieval against citation
  accuracy, recall, irrelevant context, and unsupported claims on
  representative cases.
- Demonstrate index deletion, rebuild, retention, workspace isolation, and
  provenance before enabling vector retrieval by default.
- Integrate cancellation, timeout, bounded retry, rate-limit recovery, safe
  streaming progress, and reproducible run manifests into the product path.
- Keep swapped provider roles and additional adapters independent of the
  orchestration domain.

**Exit criterion:** Retrieval or provider changes measurably improve coverage
or evidence accuracy on representative cases without increasing unsupported
claims, and failure/recovery behavior is demonstrated in the packaged app.

### Next — Real-application pilot

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

- A remote vector database before the local retrieval baseline proves value.
- Cloud sync, accounts, or multi-tenancy during integration hardening.
- Autonomous job discovery, messaging, publishing, or application submission.
- General availability of additional artifacts before the CV pilot validates
  the core hypothesis.

## Success measures

The primary product measures are factual accuracy, critical-requirement
coverage, useful critic findings, review time, manual edits, approval/export
completion, provider cost, and user confidence. Test count, model count, and
number of generated documents are health or activity indicators, not product
success by themselves.

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

| Date | Change | Reason |
| --- | --- | --- |
| 2026-08-15 | Implemented normalized provider-error states, bounded recovery, and content-free desktop/CLI projections for issue #101 | Provider failures must remain durable and user-recoverable across the shared application path while preserving the current integration-hardening stage gate for installed-app evidence |
| 2026-08-15 | Integrated the SQLite lexical retrieval baseline into live orchestration and hardened desktop review/export audit state | Provider requests should receive selected workspace evidence, and user-visible exposure, decisions, and export state must agree with durable history |
| 2026-08-15 | Reset Now to Integration hardening and outcome validation; introduced Designed/Implemented/Integrated/Validated/Released evidence levels; reclassified later stages as partial or component-level | Repository capabilities had been conflated with validated outcomes, while cross-platform real-input, release, and pilot evidence remained incomplete |
| 2026-08-12 | Created the living roadmap and set Integrated local alpha as Now | Phase-0 implementation was complete; product integration and real validation were the next constraints |
| 2026-08-12 | Added the shared local driver and Electron host path to the alpha scope | The renderer bridge gained a real local runtime; packaged acceptance remained the stage gate |
| 2026-08-13 | Added stage-based release automation as issue #46 | Each roadmap stage should leave a versioned, reproducible baseline for the next stage |
| 2026-08-13 | Added real-input onboarding and approved URL intake to the integrated alpha scope as issue #51 | The first Windows release exposed synthetic workspace data being shown as user input; retrieval and pilot work need real, provenance-bearing sources |
| 2026-08-13 | Added typed public-source extraction and explicit review-status semantics to the alpha slice | URL provenance alone is insufficient for useful source review, and approval must not imply unresolved warnings are validated |
| 2026-08-13 | Added deterministic directory and ZIP package-size diagnostics to beta packaging work | The Windows archive size needed evidence before payload reduction or installer changes |
| 2026-08-13 | Recorded automated alpha acceptance and kept the stage open for a real-source Windows check | Packaged Linux smoke was green, but synthetic smoke could not replace installed-app validation with real CV and job inputs |
| 2026-08-13 | Reported Retrieval and provider quality implementation (#63, #64, #65) | Added the retrieval port, SQLite FTS/BM25, retries, safe progress, swapped roles, local vector embeddings, and an RRF benchmark |
| 2026-08-13 | Delivered a consented pilot harness and adversarial fixtures (#66, #67) | Added the consent protocol, comparative benchmark runner, sanitized reporting, timeline-inversion detection, and security fixtures |
| 2026-08-13 | Advanced production-beta components (#73, #74, #75, #76) | Added backup/restore, ATS validation, Unicode handling, keyboard navigation, accessibility checks, and license/secret gates |
| 2026-08-13 | Implemented retention, diagnostics, and additional-artifact components (#81, #82) | Added confirmed retention purge, content-free diagnostic export, and Cover Letter/Application Q&A schemas and renderers |
| 2026-08-13 | Delivered local endpoint and multilingual components (#85, #86) | Added an OpenAI-compatible local endpoint adapter and section templates for en, fr, de, es, and ja |
| 2026-08-13 | Delivered portfolio ingestion and reported milestone releases v0.2.0–v0.5.0 (#93, #57) | Added portfolio/project-manifest ingestion and recorded the release work; release evidence still needs links in the stage record |
