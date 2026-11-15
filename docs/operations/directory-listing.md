# Directory listing

This page is for the operator who lists DraftLoop in an assistant directory:
the Claude directory first, then the ChatGPT and Codex plugin directory. It
holds the listing texts, the test cases a reviewer runs and the checklist to
finish before submitting.

**Status:** nothing is submitted. A submission is an outward action: each one
needs the owner's explicit go ([#2650](https://github.com/akoita/draft-loop/issues/2650)).

## What is ready

| Item                                   | State     | Where                                                        |
| -------------------------------------- | --------- | ------------------------------------------------------------ |
| Tools with a title and annotations     | Ready     | `apps/mcp/src`                                               |
| Remote MCP server with OAuth sign-in   | Built     | [Agent channel](../reference/agent-channel.md#with-oauth-sign-in) |
| Spend limit per connected assistant    | Built     | [Agent channel](../reference/agent-channel.md#the-connections-spend-cap) |
| Public documentation page              | Ready     | [Connect DraftLoop to your assistant](../reference/connect-an-assistant.md) |
| Listing texts and test cases           | Ready     | This page                                                    |
| Privacy policy and terms at a URL      | Missing   | Drafts in [`docs/legal`](../legal/README.md); pages in #2462 |
| Sign-in service hosted, one client per assistant | Missing | Infrastructure repository                            |
| Remote MCP server deployed on `https`  | Missing   | Infrastructure repository                                    |
| Reviewer account with sample data      | Missing   | #2663                                                        |
| Icon and screenshots                   | Missing   | #2664                                                        |
| Support address                        | Missing   | The owner chooses it                                         |

## Listing texts

Rules for every text: no price, no trial, no upgrade and no claim about CV
quality. Say what the tools do.

| Field        | Text                                                                                   |
| ------------ | -------------------------------------------------------------------------------------- |
| Name         | DraftLoop                                                                              |
| Summary      | Track your job applications and tailor your CV from evidence you approved.             |
| Categories   | Productivity, Career                                                                   |
| Developer    | The legal name in the [legal notice](../legal/legal-notice.md)                         |

**Description:**

> DraftLoop keeps your job applications, your career evidence and the CVs you
> tailor for each job. With this connector, your assistant can list your
> applications, add a job from a description you paste, follow a CV run and
> record notable work for you to review. If you allow it, it can also read
> the CVs and cover letters you saved, and start a CV run or a draft within a
> monthly limit you set. Approving a draft, exporting a document and every
> setting stay with you in DraftLoop. You need a DraftLoop account.

**Example prompts:**

1. "List my job applications in DraftLoop and tell me which ones wait for me."
2. "Add this job to DraftLoop:" followed by the pasted job description.
3. "Record in my DraftLoop work journal what we shipped today."

## Test cases for the reviewer

Run them signed in as the reviewer account, with the default permissions
unless a case names another.

### Should work

| # | Prompt                                                        | Expected                                                       |
| - | ------------------------------------------------------------- | -------------------------------------------------------------- |
| 1 | "List my DraftLoop applications."                             | `list_applications` returns the sample applications            |
| 2 | "Where does my application for the first one stand?"          | `get_application` and `get_run_status` describe it             |
| 3 | "Add this job to DraftLoop:" with a pasted description        | `add_job` creates an application and returns its id            |
| 4 | "Record this work in my DraftLoop journal:" with a summary    | `record_work` files a note that waits for review               |
| 5 | With "Read CVs and drafts": "Show the CV for that application." | `get_cv` returns the exported Markdown CV                    |

### Should be refused

| # | Prompt                                              | Expected                                                              |
| - | --------------------------------------------------- | --------------------------------------------------------------------- |
| 1 | "Approve the draft of my CV in DraftLoop."          | No tool exists; the assistant says approval stays in DraftLoop        |
| 2 | "Add the job at this address:" with a URL only      | `add_job` refuses an address and asks for the pasted text             |
| 3 | Without a spend limit: "Start a CV run for it."     | `start_cv_run` is refused and names where to set the monthly limit    |

## Checklist: Claude directory

Submit at `claude.ai/directory/manage` from a paid Claude account.

- [ ] The remote MCP server answers on its public `https` address.
- [ ] The sign-in service has a confidential client for Claude with the redirect address `https://claude.ai/api/mcp/auth_callback`, PKCE with S256 and refresh tokens.
- [ ] Sign-in and token endpoints answer within 10 seconds from Claude's published address range.
- [ ] Adding the server as a custom connector in Claude works end to end with the reviewer account.
- [ ] Every "Should work" and "Should be refused" case above gives the expected result.
- [ ] Privacy policy, documentation page and support address each have a public URL.
- [ ] Reviewer account credentials and its sample data are ready, and the reset was run.
- [ ] Icon, listing texts and the three example prompts are entered.
- [ ] The owner said go for this submission.

## Checklist: ChatGPT and Codex plugin directory

Submit from a verified individual or organisation on the OpenAI platform.

- [ ] Every item of the Claude checklist that is not specific to Claude.
- [ ] The sign-in service has a client for ChatGPT with its redirect address.
- [ ] The server's domain is verified on the OpenAI platform.
- [ ] The plugin ZIP holds `plugin.json` and `mcp.json` pointing at the production address.
- [ ] The reviewer login needs no sign-up and no second factor.
- [ ] A video walkthrough of the test cases is recorded.
- [ ] No text in the plugin or the listing sells a plan, shows a price or promotes an upgrade.
- [ ] Availability for users in the European Economic Area is checked on OpenAI's own pages.
- [ ] The owner said go for this submission.

## When a review fails

| Reviewer says                              | Do this                                                         |
| ------------------------------------------ | --------------------------------------------------------------- |
| A tool lacks a title or an annotation      | Fix it in `apps/mcp/src` and release the server                 |
| Sign-in fails or times out                 | Check the client's redirect address and the 10-second limit     |
| The privacy policy does not cover the tools | Update the policy with "What your assistant's provider sees"   |
| A test case gives another result           | Reset the reviewer account, rerun the case, then fix the cause  |

## Related

- [Connect DraftLoop to your assistant](../reference/connect-an-assistant.md)
- [Agent channel](../reference/agent-channel.md)
- [Server deploy](server-deploy.md)
