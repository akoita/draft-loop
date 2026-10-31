# Legal pack (drafts)

**Status:** Drafts for lawyer review. Nothing here is published or in force.<br>
**Scope:** The hosted DraftLoop service ([ADR 0011](../adr/0011-client-server-version.md)).
The desktop and the self-hosted stack process data on the user's own machine
and need no privacy policy from the operator.

The production readiness review of 2026-10-29 found no privacy policy, terms,
legal notice, record of processing or data protection impact assessment in
the repository. These drafts close that gap far enough for a lawyer to review
them. They are written against the architecture as built, so every statement
about data flows points at the code or ADR that implements it.

## Documents

| Document | Purpose | Readers |
| -------- | ------- | ------- |
| [Privacy policy](privacy-policy.md) | GDPR Articles 13 and 14 information for candidates and coaches | Every user, before sign-up |
| [Terms of service](terms-of-service.md) | The contract for the hosted plans, including what the AI output is and is not | Every user, at sign-up |
| [Legal notice](legal-notice.md) | The publisher and host identification French law requires on every site | Every visitor |
| [Record of processing activities](processing-register.md) | GDPR Article 30 register, one row per processing activity | The operator and the supervisory authority |
| [Data protection impact assessment](dpia.md) | GDPR Article 35 assessment of the candidate-material processing | The operator and the lawyer |

## Conventions

- **Placeholders.** Square brackets mark what the operator fills in before
  publication: `[Operator]`, `[Operator address]`, `[Contact email]`,
  `[Registration number]`. No personal data of the operator enters this
  repository; the published versions live on the service, not here.
- **Facts come from the code.** Each document states only what the service
  does today. A planned feature is named as planned. When the code changes a
  data flow, the affected document changes in the same PR, like any other
  documentation (`AGENTS.md`, Documentation synchronization).
- **Language.** The drafts are in English, the repository's language. The
  published terms and policy for consumers in France need a French version,
  and the French version prevails for consumers (Consumer Code, L. 211-1 and
  the Toubon law).

## Open questions for the lawyer

1. Legal basis for storing candidate material: the service records consent
   (ADR 0011, D7). Is consent the right basis, or is performance of the
   contract (Article 6(1)(b)) the better one, with consent kept only for the
   provider transmission and for special-category data (Article 9(2)(a))?
2. Zero-retention terms with the model providers: confirm the contractual
   basis for each route (Vertex AI in the EU, the direct Claude API fallback,
   OpenAI's EU endpoint) and whether any route is a transfer outside the EU.
3. Retention periods: candidate material and run history until deletion by the
   user or [N] months of inactivity; invoices ten years (Commercial Code
   L. 123-22); security logs [N] days. Confirm each.
4. Whether a data protection officer is required (Article 37). The draft
   assumes not, with a named contact instead.
5. Consumer withdrawal right for digital content supplied immediately
   (Consumer Code L. 221-28): confirm the wording and the express-consent
   step at purchase.
6. The coach plans (Team, Business): the coach's organisation is the
   controller for its candidates' data and the operator a processor. Confirm
   and draft the data processing agreement (Article 28).
