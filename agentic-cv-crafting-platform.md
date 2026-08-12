# Agentic CV Crafting Platform

*Product concept — starting wedge: job-specific CV creation*

## The idea in one sentence

An agentic application that uses two independent AI agents powered by different AI companies—as an author and a mutual critic—iterating on a candidate's CV until it meets an explicit readiness rubric and is approved by the candidate.

## The problem

Tailoring a CV to a specific job is a high-value but repetitive process. It requires combining:

- the job description and the employer's context;
- the candidate's career history, projects, certifications, and other evidence;
- formatting, tone, language, and length constraints;
- instructions about truthfulness, emphasis, and what must not be invented; and
- a judgment about whether the final document is actually ready to submit.

Today, this process can be improved by asking multiple AI tools to review one another's work. In practice, however, the user has to manually transfer the same context, generated CVs, review notes, and revision requests between tools. The workflow is powerful but slow, fragmented, difficult to audit, and easy to derail when context is lost.

## The insight

The value is not only in selecting the “best” model. Models from different companies are trained, tuned, and evaluated through different processes, so they bring meaningfully different blind spots, writing styles, and evaluation tendencies. Running them as independent participants in a structured review loop can produce a more reliable result than asking one model—or two models from the same provider—to draft and self-review.

The application would turn this manual relay into a repeatable quality-control protocol:

> Shared evidence and requirements → draft → independent critique → revision → critique → convergence → human approval

The two agents should not be treated as authorities. Their agreement is a useful signal, not proof of correctness. The application must preserve evidence links, surface unresolved disagreements, and leave the final decision with the user.

## Non-negotiable model-diversity constraint

The product's central premise depends on provider-level diversity. The default configuration must use models from two different companies:

- **One of Anthropic's current top-tier frontier models**; and
- **One of OpenAI's current top-tier frontier models**.

The default pairing should be configurable so that either provider can act as the author or the critic, and the roles can be swapped for a second pass. However, two different models from the same company do not satisfy the product's default mutual-criticism mode. The point is to create genuine independence of perspective, not merely variation in model names or versions.

Users may later connect other providers, but the application should always make the provider identities explicit, warn when both agents use the same company, and preserve the selected model versions in the run history. Provider diversity reduces correlated blind spots; it does not eliminate the need for evidence checks and human approval.

## Initial use case: a tailored CV for one job application

### Inputs

The user creates an application workspace containing:

- the target job description;
- a project directory with the user's CV, work history, personal projects, GitHub repositories, certifications, publications, and other relevant resources;
- instructions for the application, such as language, length, format, tone, and target seniority;
- a truthfulness policy defining what may be stated, inferred, or omitted; and
- an evaluation rubric, such as relevance to the role, evidence strength, clarity, ATS compatibility, and overall credibility.

### Agent roles

**Agent A — author and synthesizer**

Builds an evidence-backed CV, selects the most relevant experience, explains its choices, and incorporates valid feedback.

**Agent B — independent reviewer and adversarial critic**

Reviews the CV against the canonical inputs and rubric. It looks for unsupported claims, missed evidence, weak positioning, vague language, contradictions, keyword gaps, poor structure, and overfitting to the job description.

The roles can alternate in later versions, or users can configure specialized agents—for example, a hiring-manager critic, an ATS critic, and a factuality checker.

### Iterative workflow

1. The application ingests and normalizes the source material into a canonical evidence base.
2. Agent A produces the first CV draft and records the evidence supporting each substantive claim.
3. Agent B receives the same canonical evidence, the job requirements, the draft, and the review rubric. It returns structured review notes rather than an untracked rewrite.
4. Agent A revises the draft, addressing each review item or documenting why it was rejected.
5. The application repeats the exchange for a configurable number of rounds.
6. The loop stops when the readiness criteria are met, the agents reach a stable state, the iteration budget is exhausted, or the user stops it manually.
7. The user reviews the final CV, unresolved disagreements, change history, and evidence links, then approves or requests another revision.
8. The application exports the approved CV in the required format.

## What makes the product valuable

- **It removes the manual relay.** Users no longer copy prompts, documents, drafts, and review notes between AI tools.
- **It makes context persistent.** Every agent works from the same source of truth instead of an incomplete conversational handoff.
- **It separates creation from evaluation.** The reviewer is explicitly incentivized to find weaknesses rather than merely produce another polished draft.
- **It makes quality visible.** The user can see what changed, why it changed, which claims are supported, and what remains disputed.
- **It supports provider diversity by design.** The default Anthropic–OpenAI pairing creates a meaningful difference in model perspective, rather than relying on two models from the same company.
- **It preserves human control.** The product accelerates preparation without automatically submitting applications or making unreviewed claims on the user's behalf.

## MVP scope

The first version should focus on one excellent workflow: producing a trustworthy, job-specific CV from a local project directory.

### MVP capabilities

- Create a job-application workspace.
- Paste or upload a job description.
- Select a local directory as the candidate evidence base.
- Extract and index relevant text from common files.
- Configure model providers, agent roles, instructions, language, and output constraints, with Anthropic and OpenAI as the default cross-company pair.
- Run an author–critic loop with two model adapters.
- Require structured critique categories and explicit severity levels.
- Track every round, prompt context, response, decision, and revision.
- Link important CV claims back to source evidence.
- Show a side-by-side diff between revisions.
- Highlight unresolved disagreements and unsupported claims.
- Apply basic deterministic checks for length, required sections, dates, duplicate content, and prohibited inventions.
- Export the approved result as Markdown and a polished document format such as PDF or DOCX.
- Allow the user to pause, edit, reject, or manually override any agent output.

### Deliberately out of scope for the MVP

- Automatic job discovery or application submission.
- A broad autonomous research agent that searches the entire internet without user control.
- A promise that two agreeing models guarantee a correct CV.
- A full recruiting CRM or job-search management suite.
- Large-scale multi-agent orchestration before the two-agent loop is demonstrably useful.

## Readiness rubric and stopping conditions

The product needs an explicit definition of “ready.” A possible rubric is:

| Dimension | Key question |
| --- | --- |
| Relevance | Does the CV clearly match the role's most important requirements? |
| Evidence | Can each important claim be supported by the candidate's source material? |
| Accuracy | Are dates, titles, technologies, outcomes, and responsibilities correct? |
| Differentiation | Does the CV communicate the candidate's strongest and most distinctive advantages? |
| Clarity | Can a recruiter understand the candidate's value quickly? |
| Format | Does the document satisfy length, language, layout, and ATS constraints? |
| Credibility | Does it avoid inflated, generic, or suspiciously keyword-stuffed claims? |

The system should stop on more than a vague “the agents agree.” It should consider:

- no unresolved high-severity factuality issues;
- all critical job requirements addressed or explicitly marked as gaps;
- stable quality scores across consecutive rounds;
- no newly introduced unsupported claims;
- a maximum number of rounds and a cost/time budget; and
- explicit user approval.

## Generalization beyond CVs

The CV workflow is the first wedge because the pain is concrete, frequent, and personally testable. The underlying product is a general-purpose **multi-model drafting and review workspace** for any artifact where quality depends on context, evidence, and iterative criticism.

Potential extensions include:

- cover letters and application questions;
- grant applications and funding proposals;
- business plans, pitch decks, and executive memos;
- technical specifications and architecture decision records;
- research summaries and literature reviews;
- marketing or sales content requiring brand and factual review;
- legal or compliance drafts subject to a defined checklist; and
- code changes reviewed by agents with different testing and security roles.

The reusable abstraction is:

> Given a canonical source of truth, a target artifact, a set of constraints, and a quality rubric, orchestrate independent creation and criticism until the artifact is ready for human approval.

## Product principles

1. **Evidence before eloquence.** A polished claim is not useful if the source material cannot support it.
2. **Canonical context.** Every round should use the same normalized requirements and evidence base.
3. **Critique before rewrite.** Review findings must be explicit and actionable before a new draft is generated.
4. **Disagreement is a feature.** The product should surface disagreement instead of hiding it behind a single blended answer.
5. **Human approval is mandatory.** The system prepares and explains; the user decides.
6. **Every change is auditable.** Drafts, critiques, evidence, prompts, and decisions should be recoverable.
7. **Budgets are first-class.** Users should control model cost, latency, number of rounds, and context exposure.

## Main risks and mitigations

### False consensus

Even models from different companies may agree because they share a blind spot, rely on the same source assumptions, or are pushed toward agreement by the prompts.

**Mitigation:** enforce cross-company model selection by default, use independent prompts, structured review criteria, adversarial checks, deterministic validation, and a human approval gate.

### Hallucinated or inflated achievements

CV writing creates strong pressure to make experience sound more impressive than the evidence allows.

**Mitigation:** maintain a claim-to-source evidence ledger, label uncertain claims, prohibit unsupported quantification, and require user confirmation for material additions.

### Context leakage and privacy

Career history can include personal data, confidential employer information, and proprietary project details.

**Mitigation:** local-first storage, explicit provider controls, redaction options, per-workspace data policies, and clear retention settings.

### Endless iteration and rising cost

Critics can continue finding stylistic improvements without increasing application quality.

**Mitigation:** define a readiness rubric, distinguish blocking issues from suggestions, cap rounds, and stop when quality stabilizes.

### Output convergence toward generic language

Repeated optimization against a job description can make every candidate sound interchangeable.

**Mitigation:** score for specificity and differentiation, preserve distinctive evidence, and include a user-controlled “voice and non-negotiables” brief.

## A practical first experiment

Before building a complete application, implement a small local prototype for one real job application:

1. Load a project directory and a job description.
2. Ask one model to produce a structured CV draft plus evidence references.
3. Ask a second model to critique it using a fixed rubric.
4. Feed the structured critique back to the first model.
5. Compare the result with the existing manual workflow across several applications.

Measure:

- time saved per application;
- number of useful issues found by the second model;
- number of unsupported or incorrect claims introduced;
- number of rounds before the user considers the CV ready; and
- whether the final CV is better than either model's first independent attempt.

The key validation question is not “can agents generate a CV?” They clearly can. It is:

> Does structured, independent multi-model criticism produce a more trustworthy and more relevant application artifact with materially less human effort?

## Working positioning

**A quality-control loop for important documents.** Start with CVs: give the application your target role and your evidence, then let two independent AI reviewers work until the document is ready for your approval.

Possible working names: **CrossDraft**, **Concord**, **DraftLoop**, or **Two-Pass**.
