# Structured-block author guidance

**Status:** Observation indeterminate; the author preflight failed before any candidate material was sent
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
