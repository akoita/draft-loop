# Documentation

DraftLoop is a local-first desktop and CLI alpha. This index routes candidates,
contributors, maintainers, and operators to the current information they need.

## Start here

| Need | Document |
| --- | --- |
| Understand the current product and status | [Roadmap and current status](roadmap.md) |
| Understand system boundaries and flows | [Architecture overview](architecture/overview.md) |
| Read source, policy, opportunity, and profile contracts | [Candidate evidence architecture](architecture/candidate-evidence.md) |
| Read drafting, review, and rendering boundaries | [Drafting and review architecture](architecture/drafting-and-review.md) |
| Read workflow, provider, and trust boundaries | [Runtime and trust architecture](architecture/runtime-and-trust.md) |
| Run CLI and desktop commands | [CLI and desktop reference](reference/cli-and-desktop.md) |
| Understand privacy and security boundaries | [Privacy and evaluation](security/privacy-and-evaluation.md) · [Threat model](security/threat-model.md) |
| Review release evidence | [Release evidence](releases/) |
| Run or review acceptance protocols | [Evaluation protocols and results](evaluation/) |
| Understand recorded design decisions | [Architecture decision records](adr/) |
| Release DraftLoop | [Release procedure](operations/releasing.md) |

## Document types

- **Current architecture:** `architecture/` describes current boundaries and
  runtime flows. The overview is the stable entry point; its linked detail
  views are the canonical homes for their respective subjects. Keep them
  synchronized with package interfaces and executable behavior.
- **Roadmap and status:** `roadmap.md` is the source for current stage, scope,
  evidence, and priorities.
- **Historical product context:** `product/` contains the original concept
  document. It is historical context; the roadmap and architecture are
  authoritative now.
- **Evaluation records:** `evaluation/` contains protocols and case-level
  acceptance records. Candidate material remains local unless a protocol
  explicitly says otherwise and the user consents.
- **Release evidence:** `releases/` preserves stage evidence for shipped
  checkpoints; it is historical, not a statement of current readiness.
- **Security:** `security/` contains privacy, retention, threat, and evaluation
  policy that governs the product.
- **Reference:** `reference/` contains task-oriented CLI and desktop usage.
- **Operations:** `operations/` contains release and maintenance procedures.
- **Architecture decisions:** `adr/` records decisions that should remain
  durable even when implementation details change.

## Maintenance

When code, configuration, tests, or release behavior changes, update the
affected current-state document in the same change. Preserve historical
evidence and link to its canonical source instead of duplicating it. Before
sharing documentation changes, run `pnpm lint:docs` and verify that edited
local Markdown links resolve to existing paths.
