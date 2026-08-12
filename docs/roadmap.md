# Product vision and roadmap

**Status:** Living document  
**Last reviewed:** 2026-08-12  
**Current stage:** Integrated local alpha

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

## Current state

The phase-0 foundation is complete: canonical contracts, provider adapters,
author-critic orchestration, local ingestion, deterministic validation,
SQLite history, a review UI, approved Markdown/DOCX/PDF export, and an offline
synthetic pilot. The CLI and packaged Electron desktop path now share the local
application driver; the desktop can create/open a workspace, run the offline
fixture, review it, and recover persisted decisions after restart. Product
quality has not yet been demonstrated on real applications.

## Roadmap

| Horizon | Stage | Status | Outcome | Key dependencies |
| --- | --- | --- | --- | --- |
| Now | Integrated local alpha | Acceptance pending | Complete one application entirely in the desktop app | Shared application service, Electron host, lifecycle projection, binary extraction |
| Next | Retrieval and provider quality | Not started | Improve evidence selection and make live runs dependable | Alpha workflow, retrieval baseline, representative evaluation cases |
| Next | Real-application pilot | Not started | Validate quality and user-effort hypotheses | Consent process, sanitized cases, calibrated metrics |
| Later | Production-ready beta | Not started | Distribute a safe, dependable desktop application | Pilot decision, packaging and security review |
| Later | Controlled expansion | Not started | Extend proven workflows without weakening trust boundaries | Beta evidence and explicit product demand |

### Now — Integrated local alpha

Connect the implemented engine and review experience into one usable local
product.

- Introduce a shared application-service API used by the CLI and desktop.
- Connect desktop actions to real workspaces, orchestration, SQLite history,
  findings, decisions, and exports.
- Add workspace creation/opening, file selection, progress, restart/resume, and
  recoverable errors.
- Add a narrow native bridge and operating-system credential storage.
- Expose the latest lifecycle state through an append-only history projection.
- Configure local PDF and DOCX input extractors.
- Keep user and architecture documentation synchronized with shipped behavior.

**Exit criterion:** A user can create, run, review, approve, restart, resume,
and export one local CV entirely through the desktop application.

### Next — Retrieval and provider quality

Improve evidence selection only where measurement shows value.

- Define a retrieval port independent of a specific search engine.
- Keep workspace-scoped SQLite FTS/BM25 as the baseline.
- Evaluate optional local embeddings and hybrid lexical/vector retrieval
  against citation accuracy, recall, irrelevant context, and unsupported
  claims.
- Require index deletion, rebuild, retention, and provenance behavior before
  enabling vector retrieval.
- Support swapped provider roles and additional adapters without changing the
  orchestration domain.
- Add cancellation, timeout, retry, rate-limit, streaming progress, and
  reproducible run manifests.

**Exit criterion:** Retrieval or provider changes measurably improve coverage
or evidence accuracy on representative cases without increasing unsupported
claims.

### Next — Real-application pilot

Run a small, consented pilot with sanitized real applications. Compare first
drafts, revised drafts, and manual baselines using:

- unsupported-claim and critical-requirement coverage rates;
- useful versus rejected findings;
- review time, manual edits, and completed approvals;
- rounds, provider cost, export completion, and user confidence.

Add misleading-evidence and prompt-injection cases before interpreting a
passing score as readiness.

**Exit criterion:** Revised drafts do not regress factuality, outperform first
drafts, and reduce meaningful user effort.

### Later — Production-ready beta

- Signed installers, migrations, backup/restore, crash recovery, and safe
  upgrades.
- Accessibility and keyboard-complete review flows.
- ATS and cross-viewer DOCX/PDF compatibility, Unicode typography, templates,
  and visual regression tests.
- Dependency, secret, license, and supply-chain checks.
- Visible retention/deletion controls and opt-in content-free diagnostics.

**Exit criterion:** Repeatable signed releases with safe upgrades and no loss
of workspace history.

### Later — Controlled expansion

Potential directions include cover letters, application answers, multilingual
templates, additional or local model providers, portfolio imports, encrypted
sync, and coach review. Cloud accounts, shared workspaces, external tools, and
application submission each create new trust boundaries and require a separate
decision and threat-model update.

## Explicitly deferred

- A remote vector database before a local retrieval baseline proves value.
- Cloud sync, accounts, or multi-tenancy during the local alpha.
- Autonomous job discovery, messaging, publishing, or application submission.
- Broad artifact expansion before the CV pilot validates the core hypothesis.

## Success measures

The primary product measures are factual accuracy, critical-requirement
coverage, useful critic findings, review time, manual edits, approval/export
completion, provider cost, and user confidence. Test count, model count, and
number of generated documents are health or activity indicators, not product
success by themselves.

## Review cadence and change log

Review this roadmap after each stage exit, after material pilot evidence, or at
least monthly while active development continues. A roadmap change should say
what changed, why, and what moved out to make room.

| Date | Change | Reason |
| --- | --- | --- |
| 2026-08-12 | Created the living roadmap and set Integrated local alpha as Now | Phase-0 implementation is complete; product integration and real validation are the next constraints |
| 2026-08-12 | Added the shared local driver and Electron host path to the alpha scope | The renderer bridge now has a real local runtime; packaged acceptance is the remaining stage gate |
