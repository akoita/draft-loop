# Structured-block author guidance

**Status:** Two observations indeterminate; no draft produced under the `cli-author-v2` prompt
**Milestone:** [Structured-block author guidance](https://github.com/akoita/draft-loop/milestone/15)
**Observation issue:** #489
**Revision:** `8ff31c2` (includes the `cli-author-v2` structured-field guidance from #488)

This record contains only sanitized, content-free evidence.

## Admission

The candidate authorized #489 in their own words:

- both sign-in probes;
- one synthetic author preflight;
- one bounded run on the unchanged case A material, with local capture of rejected proposals, the same models and bounds as #476, and a stop at their first review.

## What happened

| Step | Result |
| ---- | ------ |
| Anthropic sign-in probe | Available and authenticated |
| OpenAI sign-in probe | Available and authenticated |
| Synthetic author preflight, `claude-sonnet-4-5` | `api-error`, error code `transient` |

The preflight diagnostics were `claude_error_subtype_success`,
`claude_terminal_reason_api_error`, and `claude_stop_reason_stop_sequence`.
No `claude_api_error_*` cause code was present, so the result text contained
none of the allowlisted Anthropic error types.

The gate stopped the observation before run preparation. No candidate material
was sent to any provider, no author or critic call was made, and no draft or
capture exists. The one authorized preflight is used, and no retry was made.

## Result

The observation is **indeterminate** under the rules fixed in #489, because
the preflight failed. The guidance effect cannot be measured without drafts.

## Stage decision

The rule for an indeterminate result without a cause code applies: the author
route question returns to the user. The status-less author `api_error` has now
occurred:

- in broader-pilot case A's first attempt (#430);
- in all three #446 attempts;
- in the first #456 attempt;
- in this preflight.

The synthetic preflight also passed three times: #449, #456, and #476. The
failure is therefore intermittent on the route, not specific to candidate
material.

Options for the user decision, none of which is authorized here:

- **Retry.** Re-run this observation under a new authorization naming its
  issue, accepting that the route fails intermittently.
- **Change the author model.** Re-declare the author model, for example a
  current Claude model, in a new gated issue. Comparability with #476 would
  weaken.
- **Diagnose first.** Investigate the intermittent route failure with further
  synthetic requests before spending another observation.

## Limitations

- A single failed preflight. The cause of the status-less `api_error` remains
  unknown, because the CLI result carried no allowlisted error type.

## Retry observation

**Issue:** #493 · **Revision:** `04ee377`

The candidate authorized #493 in their own words, with the #489 setup
unchanged. Both sign-in probes passed, and the synthetic author preflight
returned `available`. The prepared run recorded author prompt `cli-author-v2`,
critic prompt `cli-critic-v1`, and the declared models.

| Attempt | Result | Active provider time | Sanitized diagnostics |
| ------- | ------ | -------------------- | --------------------- |
| 1 | Non-retryable provider error (`unknown`) | 348,544 ms | `claude_error_subtype_error_max_structured_output_retries`, `claude_terminal_reason_unrecognized`, `claude_stop_reason_max_tokens` |

Because the error was not retryable, the run ended after one attempt. No
draft, capture, critic call, or first review exists.

### Retry result

The observation is **indeterminate** under the rules fixed in #493: a provider
error left no validator verdict. No `claude_api_error_*` cause code was
present, so under those rules the route decision returns to the user.

### Finding

The diagnostics differ from the earlier status-less `api_error`. The author
reached its output-token limit (`max_tokens`) and then exhausted structured
output retries. Under the `cli-author-v1` prompt, none of the three #476
attempts hit this limit on the same inputs.

The `cli-author-v2` guidance asks for one claim per structured field, which
lengthens the proposal. The probable cause is that the guidance pushes the
output past the existing 8,192-token author budget. That is an inference from
one attempt, not a measured result.

Options for the user decision, none of which is authorized here:

- **Raise the budget.** Raise the author output budget, which the provider
  allows up to 32,768 tokens, and repeat the observation.
- **Make claims compact.** Make the structured-field guidance favour compact
  claims, for example one claim per heading line rather than per field, and
  repeat.
- **Stop.** Stop the guidance line here.
