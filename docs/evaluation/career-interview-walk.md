# Career interview walk with a real model

This record says whether the guided career interview behaves like the
[method guide](../reference/career-interview-method.md) asks when a real model
writes the questions. It is for anyone deciding whether the interview is ready
to put in front of a candidate.

**Result: passed, with one gap.** On an invented record, Claude Sonnet 5.5
proposed the right topics and asked one open question per turn. It suggested
no number, accepted a skip and a "don't remember" without pressure, and
closed with a summary in the candidate's own words. A second walk on prompt
`career-interview-v2` confirmed that summary into `transcript` evidence. A
draft run citing it is not walked yet. Issues:
[#2179](https://github.com/akoita/draft-loop/issues/2179),
[#2203](https://github.com/akoita/draft-loop/issues/2203).

## Second walk: v2 prompt and confirmation

The same record and answers, on 2026-11-05 at `958df97`, capped at US$0.50.
Seven calls cost US$0.029.

| Check | Seen |
| --- | --- |
| Varied openings | No turn opens with "Thank you"; reflections use fresh, shorter words |
| One question per turn | Every turn passed the rule check; one turn joins two asks with "and" under one question mark |
| Confirmation | The topic closed and the publisher wrote one `text/markdown` source of kind `transcript` |
| Unsupported assumption | After "don't remember", the model said detail "fades after a few years", which the candidate never said |

The written source keeps the topic, the confirmed summary and the
conversation. It leaves out the candidate's skipped and "don't remember"
turns but keeps the interviewer's replies to them.

## Setup

| Item        | Value                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------- |
| Date        | 2026-11-05                                                                                    |
| Code        | Branch `claude/project-thread-z3abc1-2179` at `0e6bdc3`, on the owner's machine (WSL)         |
| Command     | `pnpm test:career-interview:live` ([script](../../apps/api/src/career-interview-walk.ts))     |
| Route       | The API's own career interview routes, in process, over the direct Claude API                 |
| Model       | `claude-sonnet-5-5`, prompt `career-interview-v1`                                             |
| Data        | An invented record: two roles, a gap, a mentoring skill, and an email the model must not see |
| Answers     | Seven scripted answers, including one "don't remember" and one skip                           |
| Cap         | US$1, enforced before each call; spent US$0.0349                                              |

## Check against the method

| Rule from the method guide                         | Seen in the walk                                                                 | Verdict |
| -------------------------------------------------- | -------------------------------------------------------------------------------- | ------- |
| Proposes untold topics from the record             | A role without an outcome, and the 2016 to 2017 gap                              | Pass    |
| Asks permission before a topic                     | The opening offer asks which topic, or something else                            | Pass    |
| One open question per turn                         | Every turn held a single question                                                | Pass    |
| Never suggests a number or an outcome              | No number appeared that the candidate had not said                               | Pass    |
| Accepts a skip or "don't remember" without pushing | Both were thanked and the topic moved on                                         | Pass    |
| Reflects before asking (OARS)                      | Each turn restated the last answer, sometimes word for word                      | Pass    |
| Never asks why a gap happened                      | The gap topic was proposed but not taken in this walk                            | Not run |
| Summary uses the candidate's words only            | Every summary sentence traces to an answer or to a record fact                  | Pass    |
| Contact data never reaches the model               | Withheld by the route; covered by the API test, not inspected in this walk       | Tested  |

The questions read as warm but formulaic: every turn opens with "Thank you".
That is a wording change for the prompt, not a rule failure.

## Gaps

- **Retrieval not shown.** No draft run cited the confirmed summary. That needs
  a paid run and waits for the next quality run (#1309).

## Transcript of the first walk

Invented data only. Proposal:

> Two things may be worth telling. 1. Your record names Analyst at Example
> Bank but not what changed thanks to your work. 2. Your record says nothing
> between 2016 and 2017. Would you like to talk about one of them, or about
> something else?

| Turn        | Text                                                                                                                                                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interviewer | Thanks for sharing your time as an Analyst at Example Bank, where you worked on loan reporting from 2018 to 2023. Your record lists the role and its scope, but not what changed because of your work, and I'd be glad to hear that if it feels worth exploring. Could you tell me about a time in that work when something shifted afterwards because of what you did? |
| Candidate   | I rebuilt the monthly loan reports so the risk team had them on the second working day.                                                                                                                                                                               |
| Interviewer | Thank you, that's a clear example of your work. Rebuilding the monthly loan reports so the risk team had them on the second working day sounds like a real change in how they could work. What happened for the risk team or for others once the reports arrived that early? |
| Candidate   | Before that it took about ten days, and the risk team kept their own spreadsheet copies.                                                                                                                                                                              |
| Interviewer | Thank you, that gives a clear picture of how things stood before: about ten days, and the risk team keeping their own spreadsheet copies. Once the reports were arriving on the second working day, what happened with those spreadsheet copies?                     |
| Candidate   | (don't remember)                                                                                                                                                                                                                                                      |
| Interviewer | That's completely fine, thank you for telling me. We can leave the spreadsheet copies there. Is there anything else about how you went about rebuilding the reports that you'd like to share, or would you rather we wrap up this topic?                             |
| Candidate   | I wrote the queries and the checks, and agreed the definitions with the risk lead.                                                                                                                                                                                    |
| Interviewer | Thank you, that adds a lot: you wrote the queries and the checks, and you agreed the definitions with the risk lead. Could you tell me more about how the agreeing of those definitions went, and what it was like to work that out with the risk lead?              |
| Candidate   | (skipped)                                                                                                                                                                                                                                                             |
| Interviewer | That's absolutely fine, we'll leave the definitions there. Thank you for what you've shared so far about the reports. What would you like to turn to next, whether that's another part of your time at Example Bank or something else in your career?               |
| Candidate   | The risk team stopped keeping their spreadsheet copies after the second quarter.                                                                                                                                                                                      |
| Interviewer | Here is how I understand this part of your story. Please correct anything that's off. (The summary below.) Does that sound right, or would you like to change or add anything?                                                                                       |

Summary offered for confirmation:

> As an Analyst on loan reporting at Example Bank (2018 to 2023), you rebuilt
> the monthly loan reports so the risk team had them on the second working
> day, where before it took about ten days and the risk team kept their own
> spreadsheet copies. You wrote the queries and the checks and agreed the
> definitions with the risk lead. After the second quarter, the risk team
> stopped keeping their spreadsheet copies.

## Cost

| Call | Input tokens | Output tokens | Cost (US$) |
| ---- | ------------ | ------------- | ---------- |
| 1    | 935          | 126           | 0.0031     |
| 2    | 1,103        | 88            | 0.0031     |
| 3    | 1,234        | 86            | 0.0033     |
| 4    | 1,343        | 343           | 0.0061     |
| 5    | 1,469        | 287           | 0.0058     |
| 6    | 1,580        | 367           | 0.0068     |
| 7    | 1,703        | 315           | 0.0066     |

A six-answer topic costs about US$0.035 on Sonnet, so a full session of three
topics stays near US$0.10.

## Repeat the walk

Prerequisites: Node 24.22.1, `pnpm install --frozen-lockfile`, and a Claude API
key in a private file such as `~/.config/draft-loop/anthropic.env`.

```text
set -a; source ~/.config/draft-loop/anthropic.env; set +a
DRAFT_LOOP_INTERVIEW_WALK_CAP_USD=1 DRAFT_LOOP_INTERVIEW_WALK_OUT=/tmp/career-interview-walk.md pnpm test:career-interview:live
```

The last console line gives the call count, the spend and the transcript path.
The walk confirms the summary into an in-memory knowledge base, so it writes
nothing outside the transcript file.
A non-200 answer stops the walk and prints the route's error.
