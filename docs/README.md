# Documentation

DraftLoop is an alpha that runs as a self-hosted server on your own machine,
as a desktop app, or from the source-only CLI; a hosted service is in
development on the same packages. The desktop app is a client of the server.
This index routes candidates,
contributors, maintainers, and operators to the current information they need.

## Start here

| Need                                                                     | Document                                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install and run DraftLoop on your own machine                            | [Self-hosted server](operations/self-hosted.md)                                                                                                                                                                       |
| Find a feature, its status and where it runs                             | [Feature catalog](features/README.md)                                                                                                                                                                                 |
| Understand the current product and status                                | [Roadmap and current status](roadmap.md)                                                                                                                                                                              |
| Understand the ways to run, the components and a run's path, in diagrams | [Architecture overview](architecture/overview.md)                                                                                                                                                                     |
| Read source, policy, opportunity, and profile contracts                  | [Candidate evidence architecture](architecture/candidate-evidence.md)                                                                                                                                                 |
| Read drafting, review, and rendering boundaries                          | [Drafting and review architecture](architecture/drafting-and-review.md)                                                                                                                                               |
| Read what a run remembers and who writes it                               | [Memory model](architecture/memory.md)                                                                                                                                                                                |
| Read workflow, provider, and trust boundaries                            | [Runtime and trust architecture](architecture/runtime-and-trust.md)                                                                                                                                                   |
| Read the hosted service's queue, model routes, API and screening         | [Hosted service architecture](architecture/hosted-service.md)                                                                                                                                                         |
| Read storage ports, drivers and tenant isolation                         | [Storage and tenancy architecture](architecture/storage-and-tenancy.md)                                                                                                                                               |
| Run CLI and desktop commands                                             | [CLI and desktop reference](reference/cli-and-desktop.md)                                                                                                                                                             |
| Read the hosted service's record export format                           | [Record archive v1](reference/record-archive.md)                                                                                                                                                                      |
| Let an agent record your work for review                                 | [Agent channel](reference/agent-channel.md)                                                                                                                                                                           |
| Change how the guided career interview talks to candidates               | [Career interview method](reference/career-interview-method.md)                                                                                                                                                       |
| Use DraftLoop in French, or write documents in another language          | [Languages](reference/languages.md)                                                                                                                                                                                   |
| Turn on voice answers in the career interview                            | [Voice input](reference/voice-input.md)                                                                                                                                                                               |
| Change how cover letters and interview questions are drafted             | [Application material](reference/application-material.md)                                                                                                                                                             |
| Understand privacy and security boundaries                               | [Privacy and evaluation](security/privacy-and-evaluation.md) · [Threat model](security/threat-model.md) · [Server threat model](security/server-threat-model.md) · [Agent token audit](security/agent-token-audit.md) |
| Review release evidence                                                  | [Release evidence](releases/)                                                                                                                                                                                         |
| Run or review acceptance protocols                                       | [Evaluation protocols and results](evaluation/)                                                                                                                                                                       |
| Understand recorded design decisions                                     | [Architecture decision records](adr/)                                                                                                                                                                                 |
| Release DraftLoop                                                        | [Release procedure](operations/releasing.md)                                                                                                                                                                          |
| Follow the hosted version's design and phases                            | [ADR 0011](adr/0011-client-server-version.md) · [Client-server delivery plan](architecture/client-server-delivery-plan.md)                                                                                            |
| Translate a screen string                                               | [ADR 0012](adr/0012-screen-translations-with-lingui.md)                                                                                                                                                                 |
| Make a common code change: API route, shared screen, checklist           | [Engineering guides](engineering/README.md)                                                                                                                                                                           |
| Develop and test the server locally                                      | [Local server stack](operations/local-server-stack.md)                                                                                                                                                                |
| Deploy the hosted service                                                | [Server deploy](operations/server-deploy.md)                                                                                                                                                                          |

## Document types

- **Current architecture:** `architecture/` describes current boundaries and
  runtime flows. The overview is the stable entry point; its linked detail
  views are the canonical homes for their respective subjects. Keep them
  synchronized with package interfaces and executable behavior.
- **Engineering guides:** `engineering/` shows how to make common changes
  and what to check before a pull request. AGENTS.md links each guide.
- **Feature catalog:** `features/` lists every capability with its status,
  where it runs and its agent access. Update its row with the change.
- **Roadmap and status:** `roadmap.md` is the source for current stage, scope,
  evidence, and priorities. `roadmap-history.md` keeps finished stages and the
  older change log.
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
- **Reference:** `reference/` contains task-oriented CLI and desktop usage
  and the hosted service's record archive format.
- **Operations:** `operations/` contains release, maintenance and local server procedures.
- **Architecture decisions:** `adr/` records decisions that should remain
  durable even when implementation details change.
- **Design proposals:** `design/` holds proposals for issues not yet built,
  each with its options, recommendation, risks and test plan. Fold a proposal
  into the architecture pages, or delete it, when its work ships.

## Maintenance

When code, configuration, tests, or release behavior changes, update the
affected current-state document in the same change. Preserve historical
evidence and link to its canonical source instead of duplicating it. Before
sharing documentation changes, run `pnpm lint:docs` and verify that edited
local Markdown links resolve to existing paths.
