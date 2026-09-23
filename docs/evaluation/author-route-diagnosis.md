# Author route diagnosis

**Status:** Failure not reproduced; 0 of 6 synthetic requests failed
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
