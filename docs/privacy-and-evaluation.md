# Privacy and evaluation policy

DraftLoop treats candidate material and confidential employer information as
sensitive by default. The policy is intentionally conservative for the local
MVP: source material, evidence, drafts, and run history stay on the user's
machine unless the user explicitly approves a provider transmission.

## Data policy

| Data class                            | Default location                                                                     | Provider transmission                                                                        | Retention default                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Public                                | Local workspace                                                                      | Allowed only through an explicit request policy                                              | Until the user deletes it                                                  |
| Personal                              | Local workspace                                                                      | Explicit approval and provider allowlist required                                            | Until the user deletes it                                                  |
| Confidential employer                 | Local workspace                                                                      | Explicit approval, acknowledgement, and allowlist required; user redaction rules recommended | Until the user deletes it                                                  |
| Secret embedded in candidate material | Never place in source/evaluation fixtures                                            | Not allowed as application content                                                           | Do not retain                                                              |
| Provider credential                   | Electron user-data credential store or provider SDK environment; never the workspace | Used only to authenticate an explicitly approved provider request                            | Until the user removes it, the environment changes, or app data is deleted |

The provider contract requires `allowTransmission`, an allowlisted provider
company, and an acknowledgement when a request is sensitive. Provider identity,
model identity, and requested retention are part of the visible run context. A
requested ephemeral policy is a user preference, not independent proof of a
provider's retention behavior.

The default retention object exported by `@draft-loop/security` is:

```text
local source: until deleted
run history: until deleted
provider retention: not allowed unless explicitly configured
```

The application must show the data class, provider, model, and retention choice
before the first request containing source or draft material. A denied policy
must fail before the SDK call.

The desktop host computes a canonical provider-transmission preflight from the
current workspace configuration. It shows the Anthropic and OpenAI company,
model, and API endpoint identities; the requested ephemeral retention policy;
round, cost, and duration limits; and the exact allowed categories: job
description and requirements, an evidence manifest, selected retrieved evidence
chunks, and the current draft and structured findings. The complete candidate
corpus is explicitly excluded. A SHA-256 fingerprint binds acknowledgement to
that projection, so a provider, model, endpoint, retention, scope, or budget
change requires acknowledgement again.

For live workspaces, the main process stores only the fingerprint, timestamp,
and policy projection in
`.draft-loop/provider-transmission-acknowledgement.json`. It reloads the
workspace descriptor and this metadata before every provider-transmitting
start, resume, or revision and fails closed when either is invalid or stale.
The metadata contains no candidate content or credentials, and the
acknowledgement is visible in review event history. Demo workspaces remain
local-only and require no acknowledgement.

In the packaged desktop, a key entered in the renderer crosses the allowlisted
native bridge once and is persisted by the main process. The host prefers
Electron `safeStorage`; when unavailable it uses local AES-256-GCM ciphertext
and a separate local key protected by user file permissions. That fallback is
not equivalent to an operating-system secret store. Credentials must not enter
workspace history, backups, diagnostic exports, or provider request content.
See [ADR 0004](adr/0004-desktop-credential-boundary.md).

Workspace backup, restore, retention purge, and diagnostic export are explicit
local operations. Purging the primary history does not prove deletion of copies
the user made through backups or exports; the product must disclose that scope
and keep diagnostic output content-free.

## Redaction and logging

Credential-shaped values are redacted by the deterministic rules in
`packages/security/src/index.ts`. The rules cover common private keys, bearer
tokens, provider key prefixes, and credential assignments. Confidential
employer names and project terms are not reliably detectable; a user or
deployment must supply explicit rules for those terms.

Operational events are an allowlist, not a general-purpose message logger.
Events may contain bounded identifiers, provider/model identity, status,
durations, usage, cost, and error codes. They always include
`contentRedacted: true`. Unknown fields such as `prompt`, `response`, `source`,
`document`, and arbitrary messages are dropped. Raw source, prompts, model
responses, credentials, and hidden chain-of-thought must not be written to
logs, audit records, test fixtures, or error messages.

Provider failures persist only a generic explanation plus safe code, provider,
model, workflow step, bounded attempt count, retry classification, and a provider
request identifier when supplied separately by the SDK. Provider response bodies
and exception messages are never copied into run history or the desktop view.

Packaged credential acceptance uses random, process-only synthetic canaries.
Sanitized evidence records platform metadata, the non-secret protection label,
boolean lifecycle results, and named leak checks; it does not contain canaries,
credentials, provider traffic, workspace data, or raw process output.

Structured evidence excerpts and user-visible rationale are product data, not
operational logs. They remain subject to local retention and the explicit
provider policy.

## Evaluation harness

The evaluation harness in `packages/evaluations` runs the same deterministic
readiness rubric over three variants:

1. `first-draft`, the initial generated artifact;
2. `revised-draft`, the artifact after the author–critic loop;
3. `manual-baseline`, the human-produced reference artifact.

The harness reports every readiness dimension, readiness status, structured
user-effort deltas, and revised-versus-baseline comparisons. The CI gate is
first-to-revised: a revised draft must not regress a dimension or readiness
under the configured tolerance. The manual baseline is a comparison reference,
not an automatically declared ground truth.

Fixtures must be synthetic and must not contain real candidate documents,
provider responses, credentials, employer secrets, or hidden reasoning. A
quality regression raises `EvaluationRegressionError`; security and quality
regressions are therefore deterministic test failures rather than review-only
warnings.

Evaluation scores are signals, not truth proofs. Evidence references,
deterministic validation, explicit disagreements, and human approval remain
required even when the revised artifact passes the rubric.

## Approval boundary

DraftLoop can prepare a local artifact, but it must not submit an application,
send a message, publish a document, or perform uncontrolled web research without
an explicit user action and a visible approval boundary.
