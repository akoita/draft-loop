# Author route diagnosis

**Status:** `api_error` not reproduced in 12 synthetic requests; `claude-sonnet-5` exhausts its output budget on thinking
**Milestone:** [Author model revalidation](https://github.com/akoita/draft-loop/milestone/16)
**Issue:** #501
**Revision:** `14fc75f`

No candidate material was used. Every request carried invented evidence and a
synthetic output schema.

## Why

The status-less author `claude_terminal_reason_api_error` has cost attempts in
issues #430, #446, #456, #489 (a preflight), and #499. It occurred after about
8 seconds, 8 minutes, or 11 minutes, with both `claude-sonnet-4-5` and
`claude-sonnet-5`, and with prompts v1, v2, and v3. The adapter keeps no result
text for real requests, so its cause was invisible.

## Design

The user authorized six synthetic requests through the production
`AnthropicClaudeUserSessionAdapter` path:

- the same CLI flags, a JSON output schema, and the v3 output budget of
  16,384 tokens;
- about 34,000 characters of invented evidence in 20 chunks, matching the
  size of a real author request;
- two models × three target output sizes, one request each, no retries;
- limits of 20 minutes per request and 60 minutes in total.

For any failure, the raw CLI result text would have been recorded, which is
safe because the content is synthetic.

## Results

| Model | Target output | Status | Duration | Items returned | Reported output tokens |
| ----- | ------------- | ------ | -------- | -------------- | ---------------------- |
| `claude-sonnet-4-5` | about 2,000 | ok | 42 s | 25 of 25 | 2,334 |
| `claude-sonnet-4-5` | about 6,000 | ok | 88 s | 75 of 75 | 6,563 |
| `claude-sonnet-4-5` | about 12,000 | ok | 133 s | 150 of 150 | 12,114 |
| `claude-sonnet-5` | about 2,000 | ok | 32 s | 25 of 25 | 3,292 |
| `claude-sonnet-5` | about 6,000 | ok | 77 s | 75 of 75 | 9,631 |
| `claude-sonnet-5` | about 12,000 | ok | 339 s | 150 of 150 | 47,334 |

Total active time was 711,984 milliseconds. No request failed, so no error
text exists.

## Diagnosis

Request size, output size, and duration alone do not reproduce the failure.
Synthetic requests of real input size ran successfully, and so did requests
with outputs at or above a real author proposal and durations over five
minutes.

The real author request differs from these requests in two ways:

- **The real author output schema.** The production proposal schema is large
  and deeply nested, while these requests used a three-field schema.
  Structured output against a complex schema is the leading hypothesis.
- **Real evidence text.** Content-dependent behaviour cannot be excluded.

The reported output tokens for `claude-sonnet-5` at the largest size, 47,334,
exceed the 16,384 budget. The CLI's usage figure probably includes thinking or
internal turns. This is recorded as an observation, not explained.

## Next step

Under the #501 rule, no pattern was found, so the route decision returns to
the user. Because the author output schema contains no candidate data, the
most discriminating next test is the same synthetic run with the production
author proposal schema and invented evidence:

- If it fails, the schema is implicated, and the raw error text becomes
  visible.
- If it succeeds, content-dependent behaviour becomes the remaining
  hypothesis.

## Limitations

- One request per cell. A zero failure rate over six requests does not rule
  out an intermittent failure at the rate seen in real runs.

## Schema replica

**Issue:** #503 · **Revision:** `dc49d90`

Each request replicated a real author request with invented data:

- the production `cli-author-v3` system prompt, from
  `createAuthorAdjudicationPrompt`;
- the production proposal schema, `authorArtifactProposalJsonSchemaForEvidence`
  with an evidence-ID enum, at 1,413 characters;
- the production payload shape, about 32,000 characters of input;
- the 16,384-token budget and the production adapter.

The runs were three per model, with no retries. No candidate material was
used.

| Model | Run | Status | Duration | Result |
| ----- | --- | ------ | -------- | ------ |
| `claude-sonnet-4-5` | 1 | ok | 44 s | 5 sections, 3,267 output tokens |
| `claude-sonnet-4-5` | 2 | ok | 42 s | 6 sections, 3,020 output tokens |
| `claude-sonnet-4-5` | 3 | ok | 52 s | 6 sections, 3,357 output tokens |
| `claude-sonnet-5` | 1 | error | 96 s | `error_max_structured_output_retries`, terminal reason `structured_output_retry_exhausted` |
| `claude-sonnet-5` | 2 | error | 64 s | same |
| `claude-sonnet-5` | 3 | error | 261 s | same, `stop_reason: max_tokens`; 16,384 output tokens, of which 15,200 were thinking |

Total active time was 559,623 milliseconds. The raw CLI `result` and stderr
were empty for all three failures. No `api_error_status` was reported.

### Replica diagnosis

- **The status-less `api_error` did not reproduce.** It stayed absent across 12
  synthetic requests (#501 and #503). `claude-sonnet-4-5` handles the
  production schema, prompt, and payload shape reliably, so neither the schema
  nor the prompt causes the error. It remains unexplained, and is either
  content-dependent or transient.
- **`claude-sonnet-5` spends the output budget on thinking.** The adapter sets
  `MAX_THINKING_TOKENS` to half of `maxOutputTokens`, which is 8,192 for v3.
  `claude-sonnet-5` nevertheless used 15,200 thinking tokens of 16,384,
  leaving no room for the structured proposal. This explains its slowness in
  #499 and the 47,334 output tokens reported in #501. The thinking limit the
  adapter sets is evidently not honoured for this model.
- **The adapter misclassifies this failure.** `structured_output_retry_exhausted`
  is not in its terminal-reason allowlist, so it is recorded as
  `claude_terminal_reason_unrecognized` with error code `unknown`.

### Replica next step

Under the #503 rule, failures of another kind return the next step to the
user. The run exposed two bounded, provider-free fixes:

- **Diagnostics.** Recognize the `structured_output_retry_exhausted` terminal
  reason.
- **Thinking control.** Find and apply a thinking control that
  `claude-sonnet-5` honours through the Claude CLI, or disable thinking for
  the structured author call. Then verify it with the same synthetic replica
  before any candidate observation.

## Thinking control calibration

**Issue:** #507 · **Revision:** `c291600`

The #503 replica was run unchanged, with the CLI `--effort` control from
[#506](https://github.com/akoita/draft-loop/issues/506). The frontier author candidates were `claude-fable-5-1` (premium) and
`claude-opus-5-5` (standard frontier); `claude-sonnet-5` was an economy
variant. Each model was preflighted first, through the synthetic author
preflight on the authenticated Claude user session. No candidate material was
used.

| Model | Preflight | Calibration requests |
| ----- | --------- | -------------------- |
| `claude-fable-5-1` | `api-error`, classified `rate-limit` | Four skipped (high and medium × 2); no substitution |
| `claude-opus-5-5` | `api-error`, classified `unknown` | Four skipped (high and medium × 2) |
| `claude-sonnet-5` | `available` | `--effort medium`: 2 of 2 failed with `error_max_structured_output_retries` and `structured_output_retry_exhausted`, with no stop reason and 0 reported thinking tokens (21 s and 125 s) |

Total active time was 145,830 milliseconds. The preflight keeps no raw error
text by design, so the exact causes of the two frontier preflight failures are
not visible.

### Calibration result

Under the #507 rule, **no frontier candidate is usable**, so the next step
returns to the user.

- **The Claude user-session route is not a working path to the frontier
  author models today.** Fable was rate-limited and Opus returned an
  unclassified error on a minimal synthetic request.
- **`claude-sonnet-5` does not fail only on thinking.** At `--effort medium`
  it used no thinking tokens and still could not produce a schema-valid
  proposal. Effort control alone does not make it usable as author.

A direct Anthropic API-key route would reach frontier models through the
Messages API, where the thinking budget is an explicit request parameter.
It would need a separate architecture, credential, and cost decision under
the frontier model strategy.

## Frontier route and CLI versions

**Issues:** #516 (author) and #510 (critic) · **Revision:** `12e9e6d`

Both checks used the authenticated user sessions and synthetic content only.
No candidate material was used, and no API key was billed.

### Cause: outdated CLIs on the Node path

Every frontier failure so far came from outdated CLIs in the Node 24.5.0
global packages. DraftLoop puts that directory first on `PATH`, so the
adapters used these copies instead of the current ones.

| CLI | Version found | Raw failure |
| --- | ------------- | ----------- |
| `claude` | 2.1.265 | HTTP 400: "Claude Code 2.1.265 does not support this model; version 2.1.280 or newer is required". The preflight reported only `api-error` / `unknown`. |
| `codex` (npm) | 0.153.4, shadowing the standalone 0.155.1 | "Model metadata for `gpt-6-luna` not found", then HTTP 400: "The 'gpt-6-luna' model is not supported when using Codex with a ChatGPT account". The same error occurred for `gpt-6-sol`. |

The same ChatGPT account used both GPT-6 models without error from the Codex
desktop app. Four minimal `codex exec` requests isolated the cause: the
adapter's flags were not responsible, and only the binary differed.

**Fix:** the user's global packages were updated to `@anthropic-ai/claude-code`
2.1.280 and `@openai/codex` 0.155.1.

### Results after the update

**Author, `claude-opus-5-5`.** This was the #503 replica: the production
`cli-author-v3` prompt, the proposal schema, and invented evidence. It ran at
the default effort, with no retries.

| Request | Status | Duration | Result |
| ------- | ------ | -------- | ------ |
| Preflight | available | 2 s | `{"ready": true}` |
| Replica 1 | ok | 61 s | 6 sections, 9,413 output tokens, 1,405 thinking |
| Replica 2 | ok | 43 s | 6 sections, 6,518 output tokens, 1,269 thinking |

**Critic, production `cli-critic-v1` request.** The invented draft contained
one planted unsupported claim.

| Model | Status | Duration | Findings |
| ----- | ------ | -------- | -------- |
| `gpt-6-luna` | ok | 6 s | 1 error: the planted claim |
| `gpt-6-sol` | ok | 11 s | 3 errors and 1 warning: the planted claim, plus an unsupported name, an unsupported duration, and a CI/CD coverage gap |

Both critiques passed the production critique validation rules.

### Result

- **`claude-opus-5-5` is a usable author on the user-session route.** It
  succeeded 2 of 2, used thinking moderately, and ran well inside the budget.
- **`gpt-6-luna` and `gpt-6-sol` are usable critics.** Their exact IDs come
  from the Codex CLI model list.
- **The #507 conclusion is superseded for Opus.** The route was not the cause;
  the CLI version was. The Fable rate-limit result was not rechecked, because
  the premium tier is deferred.

### Route limitations

- The results are synthetic: two author requests and one critic request per
  model. They do not measure quality on real material.
- The preflight still reports a CLI version refusal only as `unknown`.
  Surfacing the CLI version and the refusal text is a separate diagnostics
  issue.
