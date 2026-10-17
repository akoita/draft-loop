# Client-server delivery plan

- Status: Proposed, alongside [ADR 0011](../adr/0011-client-server-version.md)
- Date: 2026-10-16 (updated 2026-10-17)

This plan runs the client-server version as a stage-gated agentic-system
engagement, not as a feature backlog. Each stage has decisions to record,
artifacts to produce, and an evidence gate that must pass before the next
stage starts.

The stages cover:

- solution design from an ambiguous problem;
- the four platform decisions (entry point, capabilities, model, context);
- deployment paths and data residency;
- the safety stack and its failure handling;
- evaluations as a gate before changes;
- pilots with captured baselines;
- adoption and champions;
- hand-off and team enablement.

Anthropic's public guidance anchors the evaluation, safety and context
stages (see [Sources](#sources)).

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
6. **Both versions stay shippable.** The local-first version keeps evolving
   in parallel. Every stage keeps both clients green (ADR 0011, D15).

## Stage 1: Discovery and qualification

**Goal:** turn "a professional, hosted DraftLoop" into qualified use cases
with structural ROI per plan (ADR 0011, D13).

- **Decisions:**
  - Which use case each plan serves first: individual job search, coach
    portfolio, outplacement cohort.
  - What "value" means per plan, for example time to a sendable CV,
    candidate edits before sending, or coach throughput per week.
  - Which plan to pilot first.
- **Artifacts:**
  - a use-case qualification sheet per plan (problem, user, frequency,
    current manual cost, expected gain, risks), including the assumptions
    nobody has stated yet;
  - stakeholder interviews with three or more coaches or recruiters;
  - an **outcome document** per plan: the measurable fields that define
    success, agreed before any build, so the pilot measures the right
    thing.
- **Gate:** at least one plan has a qualified use case with a measurable
  value hypothesis and a pilot partner.

## Stage 2: Solution design

**Goal:** a defensible architecture for the qualified use cases.

- **The four platform decisions,** recorded for each agent role (planner,
  author, critic, coverage judge):
  1. **Entry point:** proposed in ADR 0011, D5. Claude on Vertex AI first
     with the direct Claude API as fallback, OpenAI's API in an EU project
     for the critic, all behind an internal gateway.
  2. **Capability features:** structured outputs (already used), prompt
     caching for the stable run context, batch for non-interactive
     scoring, and tool use (deferred #1111).
  3. **Model per role and per plan:** frontier versus economy, with the
     quality floor proven by evals, never assumed. A frontier model on every
     role is not the default.
  4. **Context strategy:** treat context as a finite attention budget.
     Decide full source versus retrieval, profile facts, and the
     application plan (#1304), each with its window and cost budget, and
     what is loaded just in time rather than up front.
- **Workflow pattern:** the fixed author–critic workflow and the rule for
  adding an agent (ADR 0011, D1).
- **Prompts as versioned assets:** each prompt has a version recorded in
  run history, and a prompt change goes through the stage 3 gate like code.
- **Sizing:** the measured cost per run, by role and model, from existing
  run history. It sets the credit price per plan (ADR 0011, D13) and shows
  whether each plan is viable before it is built.
- **Deployment path and residency:**
  - the region and data paths (ADR 0011, D14);
  - the parity gaps between the Claude API and Vertex AI (feature and
    model availability);
  - the gateway for keys, metering and routing, and per-service identity
    and egress (D5, D11).
- **Artifacts:** ADR 0011 accepted; one ADR per platform decision that
  departs from the local version; the threat model updated for hosting.
- **Gate:** ADR 0011 accepted, and the storage port (ADR 0011, phase 0)
  merged with both local clients green.

## Stage 3: Evaluation harness as the change gate

**Goal:** an evaluation suite that decides whether a change ships.

- **Decisions:**
  - **Success criteria:** specific, measurable and multidimensional, as
    Anthropic's guidance recommends. Start from the manual-parity rubric:
    recall, requirement coverage, leaks, format fit and edits before
    sending.
  - **Grading method per dimension,** in order of preference: code-based
    where exact (leaks, format fit, citation validity); an LLM grader for
    judgement (recall, coverage), validated against human scores before it
    is trusted at scale; humans only where neither works (edits before
    sending).
  - **The held-out cases,** expanded with Claude-generated synthetic
    variants of the baseline cases.
  - **The regression thresholds.**
  - **How variants are compared:** A/B comparisons fix their sample size
    and success metric in advance, so a winner over a few dozen runs is not
    mistaken for a real gain.
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
| Invented facts or employers | Every claim cites a supporting quote, and unsupported claims are retracted, as Anthropic's guidance recommends; grounding validation (validation package) and the candidate's approval before export | Approval is blocked, and the finding is shown with its evidence. These controls reduce hallucination but don't eliminate it, which is why the human approval stays |
| Indirect prompt injection through job posts, URLs or uploaded files (third-party content, trusted user) | Layered: a cheap screening model classifies untrusted content before it reaches the author or critic, plus untrusted-content delimiting, sandboxed ingestion and schema-only outputs (D11) | The content is quarantined or the output rejected by schema or grounding; the run pauses for review, and outputs are monitored for signs of injection |
| Leaking never-share or sensitive material | Server-side sensitivity tiers before any provider call (D7) | Transmission is refused, and an audit event is recorded |
| Cross-tenant access | Tenant scoping in services plus row-level security (D3) | The query returns nothing, and an alert is raised |
| Runaway cost | Per-run and per-tenant budgets, and entitlements (D13) | The run pauses at its budget, and the tenant is notified |
| Provider outage or limits | Retries, usage-limit pause (#1306), optional second route (D14) | The run pauses and is resumable; no silent route switch |
| Same-company author and critic | The pairing check and its warning (ADR 0005) | The warning is shown, and the override is recorded |
| Unequal quality across candidates | An evaluation slice with synthetic profile variants that differ only in name, age or gender signals (stage 3) | A gap beyond tolerance blocks the change, as a regression does |
| A service reaching more than it needs | Per-service identity and egress allowlists (D11, D14) | The call is denied, and an alert is raised |

- **Review routing by stakes:** the candidate approves every export.
  Team plans can also require a reviewer's approval by policy. Low-stakes
  steps, such as requirement extraction, need no human review.
- **Compliance map:** each GDPR and, for later services, EU AI Act
  obligation is mapped to the control that meets it and to its evidence.
- **Gate:** a threat model review and a red-team pass on injection through
  job posts and uploads, with no open high-severity finding.

## Stage 5: Pilot with baselines

**Goal:** prove value with real users before multi-tenant scale.

- **Decisions:** the pilot cohort (for example three coaches and their
  candidates), its duration, success metrics and exit criteria. Baselines
  are captured **before** the pilot, from the current manual process.
- **Artifacts:** a pilot plan, consent and data processing agreements, the
  baseline measurements, a weekly metrics review, and a feedback channel
  with a stated response time. Dashboards complement user feedback; they
  don't replace it.
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
- **Artifacts:** a production-readiness checklist, runbooks, alerting on
  the objectives, cost dashboards per tenant and per model, and recovery
  drills.
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

## Sources

- Anthropic, [Define your success criteria](https://platform.claude.com/docs/en/test-and-evaluate/define-success)
  and [Develop tests](https://platform.claude.com/docs/en/test-and-evaluate/develop-tests)
  (Stage 3).
- Anthropic, [Mitigate jailbreaks and prompt injections](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks)
  and [Reduce hallucinations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations)
  (Stage 4).
- Anthropic, [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
  (Stage 2).
