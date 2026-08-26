# ADR 0006: Explicit provider authentication modes

- Status: Accepted
- Date: 2026-08-20
- Decision owners: DraftLoop maintainers
- Amends: [ADR 0004](0004-desktop-credential-boundary.md)

## Context

DraftLoop's direct Anthropic and OpenAI adapters currently require separately
billed API keys. The local vendor runtimes can instead reuse a user's existing
Claude and ChatGPT/Codex login, while unattended CI cannot rely on an
interactive personal session. Authentication also changes billing, retention,
runtime capabilities, and the endpoint a candidate approves; it is therefore
not an interchangeable implementation detail.

The user-session runtimes are agent surfaces rather than the providers' direct
Messages and Responses APIs. They must not be used to extract, copy, or replay
OAuth tokens into those APIs. They can also differ from the direct APIs in
model availability and budget controls. In particular, the current Codex CLI
does not expose an enforceable pre-generation output-token ceiling.

## Decision

Support two explicit authentication modes, selected independently for each
hosted provider:

1. `api-key` uses the existing `@anthropic-ai/sdk` and `openai` adapters. It is
   the default, supports unattended execution when explicitly configured, and
   retains the existing credential store and environment fallback. DraftLoop's
   current CI/CD workflows do not receive provider credentials or run this gate.
2. `user-session` delegates the complete request to the locally installed
   vendor runtime using its provider-managed login. DraftLoop never reads,
   returns, persists, or copies the underlying OAuth credentials.

Mode selection is explicit and fails closed. DraftLoop never falls back from a
user session to an API key, or conversely, because doing so would change the
approved receiver, billing source, and retention contract.

`DRAFT_LOOP_PROVIDER_AUTH_MODE` supplies the common default. The explicit
`DRAFT_LOOP_ANTHROPIC_AUTH_MODE` and `DRAFT_LOOP_OPENAI_AUTH_MODE` settings may
override it for mixed runs. This allows, for example, an Anthropic API key with
an OpenAI user session when only one subscription allowance is unavailable,
without retrying against a differently billed transport automatically.

The first user-session slice is experimental and local-only. It uses an empty
temporary working directory, disables tools, extensions, repository rules,
MCP servers, web search, and session persistence where the runtime supports
those controls, applies a host timeout and cancellation, bounds process output,
scrubs provider API credential and endpoint override variables case-insensitively
before spawning local runtimes, and validates the final JSON locally. Any
observed tool event fails the call.
Raw process output and provider errors never enter history or renderer IPC.

The transmission preflight identifies each provider's actual endpoint. If any
receiver uses a local vendor session, the run-level retention summary uses the
conservative `provider-default` value; each request still receives the policy
for its own transport. A previous acknowledgement is stale after either
provider's mode changes. Subscription usage has no trustworthy per-request
dollar cost, so it is recorded as unknown rather than zero.

The Codex runtime's missing output-token control is a known limitation: the
adapter rejects a response whose reported output usage exceeds the requested
ceiling, but cannot prevent those tokens from being generated. Timeout and
round limits remain enforced. This mode is not release-supported until that
gap and the vendors' third-party product terms are resolved.

## Alternatives considered

- Extract OAuth tokens and call the direct APIs: rejected because the tokens
  belong to vendor runtimes and are not a supported substitute for API keys.
- Automatically prefer any available credential: rejected because it makes
  billing and consent nondeterministic.
- Replace direct providers with OpenRouter now: rejected for this slice because
  it would stop exercising the native provider SDKs and add another recipient.
- Keep API keys only: safe but blocks the requested local subscription-backed
  validation and duplicates prepaid balances during development.

## Consequences

- Local and CI validation exercise production adapters, selected through
  different explicit authentication modes rather than test-only clients.
- API-key execution remains available for explicitly configured unattended
  environments, while this repository's CI/CD remains credential-free.
- Local validation requires compatible vendor runtimes and completed logins.
- Model discovery remains API-key-specific until subscription runtimes expose a
  suitable stable catalogue contract; exact model identifiers are used locally.
- Packaging, terms, retention, and token-budget limitations must be resolved
  before user-session authentication is advertised as a released feature.
- OpenRouter remains a future paid product option for users who do not bring a
  provider account or subscription; it requires a separate ADR and consent
  update before implementation.
