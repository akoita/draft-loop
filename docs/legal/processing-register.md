# Record of processing activities (draft)

**Status:** Draft for lawyer review<br>
**Basis:** GDPR Article 30<br>
**Controller:** `[Operator]`, `[Operator address]`, `[Contact email]`<br>
**Data protection contact:** `[Name or role]` (no DPO designated; see the
open questions in the [README](README.md))

One row per processing activity of the hosted service. "Processor" rows are
activities the operator performs on behalf of an organisation that holds a
Team or Business plan (ADR 0011, D7). Security measures common to every row
are listed once at the end.

## Activities

| # | Activity | Purpose | Legal basis | Data subjects | Data categories | Recipients | Transfers outside the EU | Retention |
| - | -------- | ------- | ----------- | ------------- | --------------- | ---------- | ------------------------ | --------- |
| 1 | Accounts and sign-in | Create accounts, authenticate, apply roles and plans | Contract | Users (candidates, coaches, admins) | Email, display name, organisation, role, sign-in events | Identity provider host (processor, France) | None | With the account; identity accounts deleted on request |
| 2 | Candidate records | Store the material a candidate or an organisation uploads for drafting | Consent (individual plans); organisation's attested basis (processor rows) | Candidates | CVs, career notes, profiles, project descriptions, job posts and briefs; may contain special categories if the subject includes them | Google Cloud (hosting, EU) | None | Until deleted; 30 days read-only after cancellation; inactive free account deleted at 12 months |
| 3 | Consent ledger | Record the basis attested for storing material and the consent to send it to each provider, with withdrawals | Legal obligation (Art. 7(1)) | Candidates, members | Grant and withdrawal events, kinds, providers named, who recorded them, when | None | None | With the record; deleted with it |
| 4 | Drafting runs | Write and review a CV draft with AI models | Contract; consent for the provider transmission | Candidates | Bounded excerpts of material and the brief; drafts, findings, decisions, edits; model identities, token counts, estimated cost | Anthropic (Vertex AI EU, zero retention); OpenAI (EU endpoint, zero retention); direct Anthropic API only if the deployment enables it | None by default; direct Anthropic API, if enabled: United States under `[safeguard]` | With the record |
| 5 | Material screening | Detect instructions aimed at the AI in uploaded material and job pages before a run | Legitimate interest (security) | Candidates, members | Screening results and releases by ids, closed codes; the screened text is sent to Claude only when consent names Anthropic | Anthropic (as row 4) | As row 4 | With the record |
| 6 | Exports and record archives | Deliver the approved document; let a member export everything held about a record | Contract; data subject rights (Art. 15, 20) | Candidates, members | Exported documents with checksums; the archive zip | None | None | Exports with the record |
| 7 | Deletion | Delete a record or an organisation for good | Data subject rights (Art. 17); contract | Candidates, members | Deletion events by ids | None | None | Backups age out within 35 days |
| 8 | Credits, plans and billing | Reserve and settle credits per run, enforce plan limits, invoice | Contract; legal obligation (invoices) | Account holders | Plan, limits, balance, reservations, settlements, invoices | Payment processor (`[name]`, once billing opens) | `[Depends on the processor]` | Credits with the account; invoices 10 years |
| 9 | Usage metering | Report what a run used and cost by company, model and route | Contract | Account holders | Token counts, cache counts, estimated cost, model and route identities; no text | None | None | With the account |
| 10 | Audit trail and security logs | Prove who did what and when; detect abuse and failures | Legitimate interest (security, accountability) | Users | Content-free events: ids, actions, timestamps, access refusals, alert lines | Google Cloud (logging, EU) | None | Audit trail with the account; server logs `[N]` days |
| 11 | Support | Answer requests and complaints | Contract; legal obligation (rights requests) | Users | Correspondence, request details | None | None | `[N]` years after closure |
| 12 | Quality evaluation | Measure draft quality against reference applications | Not personal data: synthetic or the operator's own material only, outside the service (ADR 0011, D16) | None | None | Model providers, on synthetic data | None | Not applicable |

## Common security measures

- Encryption in transit (TLS) and at rest; per-tenant data keys planned.
- Least-privilege service accounts; no long-lived keys; CI signs in through
  workload identity federation.
- Tenant isolation enforced in the API on every record access.
- Sensitivity tiers enforced on the server: never-share sections are never
  sent to a provider or a reviewer; sensitive sections need consent per run.
- Model providers under zero-retention terms; the direct Anthropic API
  fallback is off unless the deployment enables it.
- Append-only audit trail with ids only; no secret or candidate material in
  logs; alerts carry ids and closed codes.
- Injection screening of uploaded material and job pages before a run.
- Backups age out within 35 days; deletion removes objects, rows, consent
  ledger and audit trail.
- Dependency and secret scanning in the public repository's CI.

## Processors

| Processor | Service | Location | Agreement |
| --------- | ------- | -------- | --------- |
| Google Cloud EMEA Limited | Hosting: Cloud Run, Cloud SQL, Cloud Storage, Secret Manager, logging; Vertex AI for Claude | `europe-west1`, EU multi-region for Vertex AI | Google Cloud Data Processing Addendum |
| `[Identity provider host]` | Keycloak sign-in | France | `[DPA reference]` |
| Anthropic | Author and critic models, through Vertex AI and, if enabled, the direct API | EU on Vertex AI; United States on the direct API | `[Zero-retention terms reference]` |
| OpenAI | Critic models | EU endpoint, EU data residency | `[Zero-retention and residency terms reference]` |
| `[Payment processor]` | Payments | `[Location]` | `[DPA reference]` |

## Change log

| Date | Change |
| ---- | ------ |
| 2026-10-31 | First draft from ADR 0011 D7 and the API as built |
