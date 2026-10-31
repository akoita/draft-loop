# Privacy policy (draft)

**Status:** Draft for lawyer review, not published<br>
**Applies to:** The hosted DraftLoop service at `[Service URL]`<br>
**Controller:** `[Operator]`, `[Operator address]`, `[Contact email]`

DraftLoop helps you write a job-specific CV from your own career material. To
do that it stores material you choose to upload, sends bounded parts of it to
AI model providers you have approved, and keeps a record of each draft so you
can see where every statement came from. This policy says what is processed,
why, for how long, who sees it and what you can do about it.

## 1. Who is responsible

For an Individual or Pro plan, `[Operator]` is the controller of your data.

For a Team or Business plan, the organisation that holds the plan (a coach, a
school, an outplacement firm) is the controller of its candidates' data, and
`[Operator]` processes that data on its behalf under a data processing
agreement. If you are a candidate on such a plan, the organisation decides why
your data is processed and is your first contact for your rights; we help it
answer you.

## 2. What we process, and why

| Data | Examples | Purpose | Legal basis |
| ---- | -------- | ------- | ----------- |
| Account data | Email address, display name, organisation, plan, sign-in events | Create and secure your account, apply your plan | Contract (Art. 6(1)(b)) |
| Candidate material | CVs, career notes, profiles, project descriptions and other files or text you upload; the job posts and briefs you add | Produce drafts for your applications | Consent to store it, recorded when you upload (Art. 6(1)(a)); for organisations, the organisation's lawful basis, which it attests |
| Provider transmission | The bounded excerpts of your material and the job brief sent to a model provider for one run | Write and review the draft | Your consent, recorded per provider and withdrawable at any time (Art. 6(1)(a)) |
| Drafts and run history | Drafts, the critic's findings, your decisions and edits, the models and versions used, token counts and estimated cost | Show you the draft, its sources and its cost; let you resume a run | Contract (Art. 6(1)(b)) |
| Usage and billing | Runs, credits reserved and spent, plan limits, invoices | Charge for the service and enforce plan limits | Contract (Art. 6(1)(b)); legal obligation for invoices (Art. 6(1)(c)) |
| Security and audit records | Access refusals, screening results with ids only, who did what and when, server logs | Keep the service safe, detect abuse, prove what happened | Legitimate interest in security (Art. 6(1)(f)) |

**Special categories of data.** A CV or a career note can mention health,
religion, trade-union membership, political opinions or sexual orientation.
The service does not ask for such data and advises you not to include it. If
you do, it is processed only on your explicit consent (Art. 9(2)(a)), and you
can mark any section as *never share* so it is stored for your own reference
and never sent to a provider or a reviewer.

**No automated decisions about you.** The AI drafts and reviews text. It does
not decide anything with legal or similar effect on you; you review, edit and
approve every document, and nothing is sent to an employer by the service.

## 3. What the AI providers receive

Each run sends a bounded set of excerpts from your material and the job brief
to the model providers your workspace uses, by default an Anthropic Claude
model as the author and an OpenAI model as the critic. The run records which
provider, model and version received what.

- Material you mark *never share* is never sent.
- Material you mark *sensitive* is sent only when you consent for that run.
- Providers process requests under terms that forbid training on your data
  and retaining it beyond the request (zero data retention).
- Claude runs on Google Cloud Vertex AI in the European Union. A deployment
  may enable a direct Anthropic API fallback, which `[is / is not]` enabled
  for this service; if it is, requests may be processed in the United States
  under `[safeguard: standard contractual clauses / Data Privacy Framework]`.
- OpenAI requests go to OpenAI's EU endpoint with EU data residency.

The provider list and regions in force are shown in the service at
`[Settings / Providers]` and in this policy's change log.

## 4. Where your data is stored

Your data is stored in Google Cloud, region `europe-west1` (Belgium), with
encryption in transit and at rest. Sign-in is handled by an identity service
hosted in France. We do not store your data outside the European Union.

## 5. How long we keep it

| Situation | What is kept |
| --------- | ------------ |
| Active plan | Everything, until you delete it |
| After cancellation or a pass ends | 30 days read-only for export, then deletion; database backups age out within 35 days |
| Inactive free account | A reminder at 11 months, deletion at 12 |
| Audit trail | Content-free records (ids, dates, actions), kept with the account and deleted with it |
| Invoices | 10 years (Commercial Code, L. 123-22) |
| Server logs | `[N]` days |
| Model providers | Nothing beyond the request, under zero-retention terms |

You can delete a candidate record, or your whole organisation, at any time
from the service; the stored files, the database rows, the consent ledger and
the audit trail go with it. Identity accounts at the sign-in service are
deleted on request.

## 6. Who else sees your data

- **Processors:** Google Cloud EMEA (hosting, EU), `[Identity provider host]`
  (sign-in, France), Anthropic and OpenAI (model requests, zero retention),
  `[Payment processor]` (payments, once billing opens). Each is bound by a
  data processing agreement.
- **Reviewers you invite:** on plans with a reviewer role, a person you name
  sees the draft and the findings; each sharing is recorded.
- **Authorities:** only when the law requires it.

We do not sell your data and do not use it to train models.

## 7. Your rights

You can access, correct, export and delete your data, restrict or object to
its processing, and withdraw a consent at any time without affecting what was
done before. Export and deletion are available in the service itself: a
record archive downloads everything held about a candidate record, and
deletion removes it for good.

For anything else, write to `[Contact email]`. We answer within one month.
You can also complain to the CNIL (Commission nationale de l'informatique et
des libertés, 3 place de Fontenoy, 75007 Paris, <https://www.cnil.fr>).

## 8. Security

Encryption in transit and at rest; least-privilege service accounts with no
long-lived keys; per-tenant isolation enforced in the API; injection
screening of uploaded material and job pages before a run; an append-only
audit trail; no secret or candidate material in logs. Security issues go to
`[Security contact]`; see also `SECURITY.md` in the public repository.

## 9. Cookies

The service uses only the cookies and local storage needed to keep you signed
in and to remember your interface settings. It uses no advertising or
third-party analytics cookies.

## 10. Children

The service is for people of working age. We do not knowingly accept users
under 16.

## 11. Changes

We update this policy when the service changes what it processes. Each
version is dated and the change log below says what changed. A change that
reduces your rights is announced in the service before it applies.

| Date | Change |
| ---- | ------ |
| `[Publication date]` | First version |
