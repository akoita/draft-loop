# Data protection impact assessment (draft)

**Status:** Draft for lawyer review<br>
**Basis:** GDPR Article 35; CNIL guidance on impact assessments<br>
**Processing assessed:** Candidate records and drafting runs of the hosted
service (register rows 2, 4 and 5)<br>
**Controller:** `[Operator]`

## 1. Why an assessment

The processing meets several of the criteria the European Data Protection
Board lists for a likely high risk: it uses an innovative technology (large
language models) on data that can include special categories (a CV or a
career note may mention health, religion, union membership or orientation),
about people in a vulnerable position (job seekers, sometimes through an
employer-funded outplacement), and it sends that data to third-party
providers. Two or more criteria make an assessment advisable; the operator
carries it out before other users join.

## 2. Description of the processing

**Nature.** A candidate, or a coach for a candidate, uploads career material
and a job post. The service extracts requirements from the post, retrieves
the relevant parts of the material, sends bounded excerpts to an AI author
and an AI critic from different companies, and records the draft, the
critic's findings, the candidate's decisions and the models used. The
candidate edits, approves and exports the document.

**Scope.** Individual users and the candidates of coaching organisations in
the European Union. Phase 1 serves the operator alone; phase 2 a closed
pilot; a public beta after that. Volume: `[estimate]` records per month.

**Context.** The candidate controls what is uploaded, can mark sections as
sensitive or never-share, and consents to each provider by name. The
providers process under zero-retention terms. The desktop version keeps
everything on the user's machine and is outside this assessment.

**Purposes.** Produce a truthful, source-traceable CV draft for one job
application; let the candidate see where each statement came from.

**Assets.** Candidate material and briefs in Cloud Storage and Postgres
(EU); drafts and run history in Postgres; the consent ledger and audit trail;
provider requests in flight; exports.

## 3. Necessity and proportionality

- **Lawfulness.** Consent recorded in an append-only ledger for storing
  material and for each provider transmission; explicit consent for special
  categories; organisations attest their basis for the candidates they
  manage. Open question 1 in the [README](README.md) asks the lawyer whether
  contract is the better basis for storage.
- **Minimisation.** Only bounded excerpts reach a provider, and never a
  never-share section. Run history keeps structured findings and decisions,
  not the models' reasoning. Logs and alerts carry ids and closed codes only.
- **Accuracy.** Every substantive statement is linked to its source; the
  critic flags unsupported or contradicted statements; the service never
  invents facts, and the candidate approves before export.
- **Retention.** Stated per situation in the privacy policy; deletion
  removes objects, rows, ledger and audit trail; backups age out in 35 days.
- **Information.** Privacy policy at sign-up; the consent screen names each
  provider; the run shows which model received what.
- **Rights.** Export (record archive) and deletion in the service; the other
  rights by email within one month.
- **Processors.** Listed in the register with their agreements; zero
  retention from the model providers; EU hosting.
- **Transfers.** None by default. The direct Anthropic API fallback, if a
  deployment enables it, is a transfer to the United States and needs the
  safeguard named in the privacy policy.

## 4. Risks

Each risk is rated on likelihood and severity (low, medium, high) before the
measures in section 5, then after.

| Risk | Example | Likelihood | Severity | Residual |
| ---- | ------- | ---------- | -------- | -------- |
| Illegitimate access to candidate material | A tenant isolation defect lets one organisation read another's records; a leaked credential; a provider retaining prompts | Medium | High (career history, possibly special categories) | Low |
| Unwanted change of data | A draft states something the material does not support and the candidate sends it; an injection in a job page steers the AI | Medium | Medium (a false claim harms the candidate's credibility) | Low |
| Disappearance of data | A deletion bug removes a record still in use; a backup gap | Low | Medium | Low |
| Loss of control over disclosure | A coach uploads a candidate's material without a basis; a reviewer sees more than intended; a never-share section reaches a provider | Medium | High | Low |
| Re-identification from content-free records | Audit ids and usage figures combined with other data | Low | Low | Low |

## 5. Measures

| Measure | Addresses | Where |
| ------- | --------- | ----- |
| Tenant isolation on every record access, tested against cross-tenant reads | Illegitimate access | `apps/api` record access, Postgres tests |
| Encryption in transit and at rest; EU-only resources enforced by an organisation policy; no long-lived keys | Illegitimate access | Private infrastructure repository |
| Zero-retention provider terms; Vertex AI EU; direct API off by default | Illegitimate access, transfers | ADR 0011 D5, D7; `packages/model-gateway` |
| Never-share sections never sent; sensitive sections need per-run consent; enforced on the server | Loss of control | ADR 0011 D7; `packages/application` sensitivity rules |
| Consent ledger per record and provider; runs refused or paused without a current grant | Loss of control, lawfulness | Sprint 1k; `apps/api` consent enforcement, `apps/worker` |
| Source links on every statement; critic grounding review; no invented facts; human approval before export | Unwanted change | `packages/orchestrator`, `packages/validation` |
| Injection screening of material and job pages; quarantine until release; one-hop page fetcher with no data access | Unwanted change | Sprint 1m; `apps/page-fetcher` |
| Deletion of objects, rows, ledger and audit trail; record archive export; backups age out in 35 days | Disappearance, rights | Sprint 1l |
| Content-free audit trail and alerts; no text in logs | Re-identification, accountability | `apps/api`, observability |
| Members attest the basis for a candidate's material; candidate confirmation planned | Loss of control | ADR 0011 D7 |

## 6. Residual risk and decision

With the measures above, every risk is rated low. The assessment identifies
two conditions before the service admits other users:

1. The lawyer confirms the legal bases and the retention periods (README,
   open questions 1 and 3).
2. The zero-retention and residency terms of each provider route are on file
   (open question 2), and the direct Anthropic API fallback stays off in
   production until its transfer safeguard is documented.

No prior consultation of the CNIL (Article 36) is expected, since the
residual risk is low. The operator reviews this assessment when a data flow
changes, and at least once a year.

## 7. Consultation

- Data protection lawyer: `[name, date]`
- Users: the closed pilot's participants are asked about the consent screen
  and the privacy policy's clarity; findings go here.
- Security review: the public repository's threat model
  (`docs/security/threat-model.md`).

## Change log

| Date | Change |
| ---- | ------ |
| 2026-10-31 | First draft |
