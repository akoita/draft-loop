# Client-server delivery plan

- Status: Proposed, alongside [ADR 0011](../adr/0011-client-server-version.md)
- Date: 2026-10-16

This plan runs the client-server version as a stage-gated agentic-system
engagement, not as a feature backlog. Each stage has decisions to record,
artifacts to produce, and an evidence gate that must pass before the next
stage starts.

The structure follows the public outlines of Anthropic's Claude Certified
Architect (Foundations and Professional) and Forward Deployed Engineer
learning paths:

- solution design from an ambiguous problem;
- the four platform decisions (entry point, capabilities, model, context);
- deployment paths and data residency;
- the safety stack and its failure handling;
- evaluations as a gate before changes;
- pilots with captured baselines;
- adoption and champions;
- hand-off and team enablement.

Only the public outlines were consulted. Where the course content refines a
step, update this plan rather than this summary.

## Principles

1. **Evidence before scale.** No stage starts on intent alone. A gate names
   the measurement that proves the previous stage worked.
2. **Evals are the change gate.** A prompt, model, retrieval or orchestration
   change ships only if the evaluation suite shows no regression against the
   recorded baseline.
3. **Decisions are recorded where they are made.** Each decision below
   becomes an ADR, or a section of ADR 0011, with its alternatives and its
   reason.
4. **Safety is designed per control.** For every control: what it stops,
   where it sits, and what happens when it fails.
5. **Parity is the floor.** The hosted version may never produce a weaker
   CV than the local-first version that met the parity exit (#1309).

## Stage 1: Discovery and qualification

**Goal:** turn "a professional, hosted DraftLoop" into qualified use cases
with structural ROI per plan (ADR 0011, D13).

- **Decisions:**
  - Which use case each plan serves first: individual job search, coach
    portfolio, outplacement cohort.
  - What "value" means per plan, for example time to a sendable CV,
    candidate edits before sending, or coach throughput per week.
  - Which plan to pilot first.
- **Artifacts:** a use-case qualification sheet per plan (problem, user,
  frequency, current manual cost, expected gain, risks) and stakeholder
  interviews with three or more coaches or recruiters.
- **Gate:** at least one plan has a qualified use case with a measurable
  value hypothesis and a pilot partner.

## Stage 2: Solution design

**Goal:** a defensible architecture for the qualified use cases.

- **The four platform decisions,** recorded for each agent role (planner,
  author, critic, coverage judge):
  1. **Entry point:**
     - Claude API, Claude on Vertex AI (ADR 0011, D14), or both behind a
       gateway;
     - OpenAI's API for the critic.
  2. **Capability features:** structured outputs (already used), prompt
     caching for the stable run context, batch for non-interactive
     scoring, and tool use (deferred #1111).
  3. **Model per role and per plan:** frontier versus economy, with the
     quality floor proven by evals, never assumed.
  4. **Context strategy:** full source versus retrieval, profile facts, and
     the application plan (#1304), each with its window and cost budget.
- **Deployment path and residency:**
  - the region and data paths (ADR 0011, D14);
  - the parity gaps between the Claude API and Vertex AI (feature and
    model availability);
  - the gateway pattern for keys, metering and routing (D5).
- **Artifacts:** ADR 0011 accepted; one ADR per platform decision that
  departs from the local version; the threat model updated for hosting.
- **Gate:** ADR 0011 accepted, and the storage port (ADR 0011, phase 0)
  merged with both local clients green.

## Stage 3: Evaluation harness as the change gate

**Goal:** an evaluation suite that decides whether a change ships.

- **Decisions:**
  - The scored dimensions. They start from the manual-parity rubric:
    recall, requirement coverage, leaks, format fit and edits before
    sending.
  - Which can be automated and which need a human scorer.
  - The held-out cases.
  - The regression thresholds.
- **Artifacts:**
  - a versioned evaluation set of synthetic cases plus consented private
    references kept outside the repo;
  - a runner that executes a configuration against the set;
  - a report that compares with the baseline. This pulls #1105–#1107
    (deferred) into this stage.
- **Gate:** the suite reproduces the local-first parity baseline (#1307)
  within tolerance. It runs before every prompt, model or orchestration
  change.

## Stage 4: Safety stack

**Goal:** every risk has a placed control and a defined failure behaviour.

| Risk | Control (where) | When the control fails |
|---|---|---|
| Invented facts or employers | Grounding validation and claim citations (validation package), with the candidate's approval before export | Approval is blocked, and the finding is shown with its evidence |
| Prompt injection through job posts, URLs or uploaded files | Untrusted-content delimiting in prompts, sandboxed ingestion, schema-only outputs (D11) | The output is rejected by the schema or grounding, and the run pauses for review |
| Leaking never-share or sensitive material | Server-side sensitivity tiers before any provider call (D7) | Transmission is refused, and an audit event is recorded |
| Cross-tenant access | Tenant scoping in services plus row-level security (D3) | The query returns nothing, and an alert is raised |
| Runaway cost | Per-run and per-tenant budgets, and entitlements (D13) | The run pauses at its budget, and the tenant is notified |
| Provider outage or limits | Retries, usage-limit pause (#1306), optional second route (D14) | The run pauses and is resumable; no silent route switch |
| Same-company author and critic | The pairing check and its warning (ADR 0005) | The warning is shown, and the override is recorded |

- **Gate:** a threat model review and a red-team pass on injection through
  job posts and uploads, with no open high-severity finding.

## Stage 5: Pilot with baselines

**Goal:** prove value with real users before multi-tenant scale.

- **Decisions:** the pilot cohort (for example three coaches and their
  candidates), its duration, success metrics and exit criteria. Baselines
  are captured **before** the pilot, from the current manual process.
- **Artifacts:** a pilot plan, consent and data processing agreements, the
  baseline measurements, and a weekly metrics review.
- **Gate:** the metrics beat the baseline (for example, edits before
  sending and time to a sendable CV), with no safety incident.

## Stage 6: Production readiness

**Goal:** an enterprise-ready service with explicit cost and reliability
targets.

- **Decisions:**
  - service level objectives (availability, run completion, time to first
    draft);
  - a cost target per CV per plan;
  - backup and recovery objectives;
  - the incident process;
  - the release process (the local release guardrail's equivalent).
- **Artifacts:** runbooks, alerting on the objectives, cost dashboards per
  tenant and per model, and recovery drills.
- **Gate:** the objectives met for four weeks in the pilot, and a recovery
  drill passed.

## Stage 7: Adoption and go-to-market

**Goal:** plans that people adopt and keep using.

- **Decisions:** onboarding per plan, pricing levels (ADR 0011, open
  decision 2), champions in each pilot organisation, and the provenance
  report as the professional differentiator (D8).
- **Gate:** retention and expansion within pilot organisations, and the
  first paid plan of each tier.

## Stage 8: Operation and enablement

**Goal:** the system runs without its original builders.

- **Artifacts:** an operations handbook, admin training for Business
  plans, and an evaluation-gated change process documented for
  contributors.
- **Gate:** a change ships end to end by someone other than the original
  builder, with the evaluation gate passing.

## Failure modes to anticipate

- **Starting with scale before value:** multi-tenant work before a pilot
  proves the use case. Stage 5 precedes multi-tenant phase 2.
- **Shipping changes without evals:** prompt or model swaps judged by
  impressions. Stage 3 makes the suite the gate.
- **A parity regression on hosting:** a different model route or context
  strategy silently lowers quality. The parity floor is checked on every
  route change.
- **Privacy debt:** consent and deletion designed late. They are part of
  the pilot gate, not of production.
