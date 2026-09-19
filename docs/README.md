# Documentation

DraftLoop is a local-first desktop and CLI alpha. This index routes candidates,
contributors, maintainers, and operators to the current information they need.

## Start here

| Need | Document |
| --- | --- |
| Understand the current product and status | [Roadmap](roadmap.md) |
| Understand system boundaries and flows | [Architecture overview](architecture/overview.md) |
| Run CLI and desktop commands | [CLI and desktop reference](reference/cli-and-desktop.md) |
| Understand privacy and security boundaries | [Privacy and evaluation](security/privacy-and-evaluation.md) · [Threat model](security/threat-model.md) |
| Review release evidence | [Release evidence](releases/) |
| Run or review acceptance protocols | [Evaluation protocols and results](evaluation/) |
| Understand recorded design decisions | [Architecture decision records](adr/) |
| Release DraftLoop | [Release procedure](operations/releasing.md) |

## Document types

- **Current system:** `architecture/` describes stable boundaries and runtime
  flows. Keep it synchronized with package interfaces and executable behavior.
- **Decisions:** `adr/` records decisions that should remain durable even when
  implementation details change.
- **Plans and status:** `roadmap.md` is the source for current stage, scope,
  evidence, and priorities.
- **Reference:** `reference/` contains task-oriented CLI and desktop usage.
- **Operations:** `operations/` contains release and maintenance procedures.
- **Security:** `security/` contains privacy, retention, threat, and evaluation
  policy that governs the product.
- **Evaluation:** `evaluation/` contains protocols and case-level acceptance
  records. Candidate material remains local unless a protocol explicitly says
  otherwise and the user consents.
- **Release history:** `releases/` preserves stage evidence for shipped
  checkpoints; it is historical, not a statement of current readiness.
- **Product context:** `product/` contains the original concept document. It
  is historical context; the roadmap and architecture are authoritative now.

## Maintenance

When code, configuration, tests, or release behavior changes, update the
affected current-state document in the same change. Preserve historical
evidence and link to its canonical source instead of duplicating it. Before
sharing documentation changes, run `pnpm lint:docs` and the repository link
validation included by `pnpm validate`.
