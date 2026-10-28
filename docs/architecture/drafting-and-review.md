# Drafting and review architecture

This page is the canonical current-state reference for evidence-grounded drafting, independent review, deterministic quality checks, and controlled rendering. It describes the provider-independent contracts and boundaries that shape author output, critic findings, revisions, readiness, and export QA.

Use [Architecture overview](overview.md) for the system map. See [Candidate evidence](candidate-evidence.md) for the source, policy, opportunity, and profile contracts, and [Runtime and trust](runtime-and-trust.md) for workflow state, provider, and export boundaries. [ADR 0003](../adr/0003-evidence-grounded-evaluator-optimizer.md) records the evaluator–optimizer adaptation.

## Evidence-grounded evaluator–optimizer

DraftLoop applies the evaluator–optimizer pattern to a factual, evidence-backed
workflow. The author is the optimizer's generator, the independent critic is
the evaluator, and each revision is a bounded optimization step against a
visible rubric. The product uses author–critic language in the UI because it is
clearer to candidates.

![Evaluator–optimizer loop: canonical inputs feed the author draft, a structured artifact with evidence links is evaluated by an independent critic and deterministic checks against a visible rubric, accepted findings drive a bounded revision, and the loop stops when stable, on budget exhaustion, or on early user review before human approval and local export.](../assets/evaluator-optimizer-loop.svg)

The rubric covers factuality, evidence support, requirement coverage, and
quality. Deterministic validators handle checks that do not need a model,
including duplicated blocks and claims and a phrase of three or more words
repeated back to back inside one block, which usually means overlapping
evidence quotes were stitched together.
Findings are structured, actionable, severity-rated, and linked to claims,
sections, or source locators where possible. A critic can identify a problem
but cannot establish truth by itself; user evidence and human decisions remain
authoritative.

Validation and readiness share the block-local lexical coverage matcher in
`packages/validation`. At least half of the distinct meaningful requirement
tokens, with at least one match, must occur within one artifact block. Matches
are never pooled across blocks or sections; section titles and claim-only text do
not count. Explicit gaps still override lexical matches, and priority weights
and rubric thresholds are unchanged. Three closed lexical rules refine that
match: the degree rule, permitted alternatives, and organisation-maturity
qualifiers, each described below. None of them infers negation, credential
equivalence, or semantic entailment. Tokens are also compared literally, so
inflected forms are distinct: `implement` does not match `implemented`, and
`contract` does not match `contracts`. A block can therefore restate a
requirement in another grammatical form and still fall below the half-token
rule. Existing stored contexts and scores are not rewritten; a new evaluation
can yield a different result.

The default author and critic use different companies, with provider and model
versions recorded in run history. The orchestrator stops at configured round,
cost, or time limits, when quality is stable, or when the user reviews early.
With the off-by-default workspace autopilot, it keeps revising through blocking
findings and stable scores until the round limit, and pauses earlier only when
the draft is ready, a blocking finding persists, or on a conflict: a disputed
claim or a blocking factuality finding. It never loops indefinitely to optimize
a subjective score. See [stop and pause on findings](#stop-and-pause-on-findings-1113)
and [ADR 0003](../adr/0003-evidence-grounded-evaluator-optimizer.md).

### Degree coverage

Standalone requirements of the form `[a] <subject> [or <subject>] degree
[preferred|required]` use a closed degree rule instead of lexical overlap.
Subjects are `computer science` (also hyphenated) and `quantitative`. A trailing
period is allowed. Both alternatives are permitted; they need not both appear
in the CV. Other requirement phrasing retains the ordinary lexical heuristic.

The grammar is evaluated per clause, not per block. A block is split on `;` and
on a sentence-final `.`, never on commas, because the credential grammar uses
commas for specialization and year ranges and because a qualifier such as `, not
completed` belongs to the credential it disqualifies. A block covers the
requirement when one clause states a permitted attained degree on its own, so
`MSc in Computer Science; training in software architecture.` qualifies. An
uncertain clause is never rescued by a neighbouring one: `Pursuing an MSc in
Computer Science; interested in secure development` does not qualify.

Punctuation alone cannot detach a disqualifier from what it disqualifies. A
following clause that carries a status term but states no topic of its own —
`; not completed`, `; expected 2027` — is read as part of the credential clause
beside it, so it behaves exactly like the comma form `, not completed`. A later
clause that does state its own topic, such as `; training in software
architecture`, is independent and neither rescues nor disqualifies.

A qualifying clause must start with a supported credential followed by `in`
and a permitted subject: BS/BSc, MS/MSc, PhD, Bachelor/Master of Science,
Doctor of Philosophy, bachelor's/master's/doctoral degree, or degree. The
optional prefixes are `earned`, `completed`, or `holds`, with an optional
article. A comma-separated alphabetic specialization and comma-separated year
or year range may follow. Case, whitespace, typographic apostrophes, and the
computer-science hyphen are normalized. Quantitative field/discipline labels
are accepted literally; mathematics or other subjects are not automatically
classified as quantitative.

Negated, coursework-only, or status-qualified entries (such as expected,
incomplete, candidate, honorary, or revoked) do not establish an attained
degree. A recognized requirement that fails this rule cannot fall back to
lexical overlap. Dotted abbreviations, free-form credential prose, degree-level
requirements, and general subject equivalence are outside this rule. Explicit
gaps still override a match. This is text matching, not credential verification.

### Permitted alternatives

A requirement that lists permitted alternatives is matched once per alternative
instead of as one long token list, so naming more alternatives can no longer
make a requirement harder to satisfy. `Experience with Prometheus or
OpenTelemetry.` and `Experience with Prometheus, OpenTelemetry, or Datadog.`
are each satisfied by a block that names one of them. Every condition stated
outside the enumeration is kept in each branch, so `Production experience with
Prometheus or OpenTelemetry.` still requires production wording in the same
block. Branch matches are never combined: one block must satisfy the half-token
rule for one branch on its own.

The grammar is deliberately closed. It reads `A or B` and comma lists ending in
`or`, with up to five single-word alternatives and exactly one `or` in the
requirement. Compound `and` conditions, `and/or`, several enumerations in one
requirement, and multi-word alternatives such as `Google Cloud or AWS` are not
recognized and fall back to ordinary matching unchanged. A capitalized word
directly beside the enumeration is read as a possible multi-word alternative
and stops the rule rather than splitting the phrase.

### Organisation-maturity qualifiers

When a requirement literally states an organisation-maturity qualifier, the
block that matches it must state that qualifier too. The vocabulary is a closed
list: early stage, seed stage, pre-seed, series A/B/C, growth stage, late
stage, scale-up, and startup stage, with hyphen, spacing, and case variants
normalized. `Early-stage startup experience.` is therefore not covered by
`Built internal tools at a 40-person startup, gaining broad experience.`

Maturity is never inferred. The rule builds no taxonomy of company stages and
derives nothing from headcount, funding amounts, or organisation type; on its
own, `startup` is an organisation type rather than a qualifier. The qualifier
must appear in the same block that matches, not in a neighbouring block.
Requirements without such a qualifier keep the ordinary lexical rule.

The guard applies per alternative branch, so `Early-stage or growth-stage
experience.` is covered by a block stating either stage rather than requiring
both. Where the alternatives rule cannot split a requirement, every stated
qualifier is required together: `Series A or Series B experience.` is a
multi-word enumeration, so it stays uncovered by a block naming only one
series. That is a known conservative false negative, not an accepted match.

### Independent-readiness report boundary

`packages/schemas` owns the strict, versioned
`independentReadinessReport` contract. It records the context and artifact
identity, independent-review record, input completeness, all seven rubric
dimensions, and provenance-preserving deterministic and critic findings. The
pure assembler in `packages/evaluations` orders enriched findings, assigns
their origin, validates the complete report, and returns a deeply immutable
projection without provider payloads or hidden reasoning.

This first v0.8 component is a contract slice only. It does not call providers,
persist reports, wire the CLI or desktop, establish approval semantics, or
derive application-ready status or stopping decisions. Runtime integration is
gated on the complete drafting and writing-policy work in #69 and #70.

### Complete CV composition boundary

The live author contract represents header, summary, experience, projects,
skills, education, certifications, and languages as semantic sections. The
author includes each section supported by retrieved candidate evidence and
preserves authored section and entry order through the canonical artifact and
Markdown, DOCX, and PDF exporters. Before provider output becomes an artifact,
the application rejects substantive claims without evidence, unrelated
citations, and changed exact invariants such as dates, metrics, credentials,
links, employers, and multi-word titles. Missing configured sections remain
visible to the existing deterministic completeness check.

New runs record author template `cli-author-v15`, which states and sends a
32,768-token output ceiling for the structured proposal, including repeated claim
text and JSON overhead. This is a ceiling, not a target, and permits more output
and potentially higher request cost. It does not raise reasoning effort or alter
model selection, critique, grounding or approval. Stored author versions remain
fixed on resume and retries: v1/v2 retain 8,192 tokens, v3 retains 16,384, and
v4 to v15 retain 32,768.

Author v6 asks for concise professional body prose: a coherent summary and
accomplishment bullets that group related supported facts instead of repeating
source notes, status reports, or reviewer commentary. It preserves documented
agency and limits such as production versus staging and credential status. It
instructs the author to rewrite supported descriptive sentences into
candidate-focused prose and action-led bullets while retaining factual meaning
and protected values. The guidance does not add job-specific rules or relax
factual grounding and exact structured-field requirements.

Author v7 keeps v6 and tailors the CV to the job. The job description, its
requirements and its responsibilities stay employer context, never candidate
facts. The author:

- opens the summary with a one-line headline of the candidate's own supported
  titles and the strongest skill areas the job asks for, never the target title
  as a held role;
- adds a "Core areas" section (kind `alignment`) after the summary, with three
  to five grounded bullets that answer the job's main requirements and
  responsibilities, labelled only with words the cited evidence contains;
- leads each role with its most relevant bullets and shortens unrelated detail,
  while keeping every role, its title, employer and dates, and the chronology;
- lists the skills and certifications the job asks for first.

A writing policy's section order or emphasis overrides this guidance. Resumed
v6 runs keep the v6 prompt.

Author v8 keeps v7 and, on a revision, receives the critic's judged coverage of
the draft being revised as `requirementCoverage`: each judged requirement's
verdict, rationale and, when covered, the cited block ids. The author adds
content for an uncovered requirement only when the evidence supports it, and
keeps the cited covering blocks unless an accepted finding requires a change.
Resumed v7 and earlier runs receive neither the instruction nor the input.

Author v9 keeps v8 and adds the candidate's directions for the next round, given
with **Request revision** (at most 1,000 characters). They arrive in a separate
`candidateDirection.instructions` input, and the prompt tells the author to
follow them for selection, emphasis, ordering, omission and framing within the
retrieved evidence. They are instructions, not evidence: a direction cannot add
a fact, and the claim grounding checks still reject one that does. The next
round's critic receives the same text with a rule not to flag a requested change
as a defect, and still reports unsupported claims. The direction is stored on
the run for that round only, recorded as a revision decision (round, text and
time) and with the round's `run.author-input` event, and shown in Run details.
Runs that started on v8 or earlier cannot take directions; requesting a revision
with one is refused rather than silently ignored.

After any revision, the orchestrator compares the revised draft with that
judged coverage. When none of a covered requirement's cited blocks survives,
by id or by identical text, it adds a content-free `coverage-block-dropped`
warning naming the requirement id. Block ids change on every revision, so
rewording a covering block also raises it; a later critic judgement that the
requirement is covered clears the warning, as it clears the token-match miss.

That check sees only blocks that disappear. A targeted patch keeps a replaced
block's id, and word-match coverage cites no blocks, so a revision could still
lose a covered requirement unannounced: the 0.6.2 walk went from 3 to 2 covered
requirements with no finding (#1861). After each later critique the
orchestrator therefore also compares the two rounds' verdicts. A requirement
covered in the previous round, on any basis, that this round finds uncovered or
only possibly covered gets a content-free `coverage-lost` warning naming its
id, unless the revision already reported it as dropped.

Critic template `cli-critic-v3` retains evidence-linked
claim review for attribution, work maturity, and credential scope, and also
asks the critic to compare explicit dated employment gaps in retrieved sources
with the complete CV. An omitted interval is a coverage warning with its
source ID; the critic must not infer gaps from spacing between roles or turn a
record of no listed software work into a claim of unemployment. The prompt
does not use a fixed technology vocabulary or external verification. Findings
use the existing structured contract; resumed v1/v2 runs retain their recorded
prompt bytes.

Critic template `cli-critic-v4` is v3 plus an editorial review
of whether the CV is ready to send. It reports quality warnings that quote the
offending text and name its section:

- `editorial-source-note`: a copied source note, meta-commentary about sources
  or the job search, or third-person narration about the candidate. Draft
  validation also raises this code on its own for a block that calls the
  candidate "he", "she" or "the candidate", or says "labelled as such", so
  the warning does not depend on the critic noticing;
- `editorial-fragment`: a fragment or semicolon-stitched evidence quotes;
- `editorial-negative-aside`: an aside that undercuts an accomplishment
  instead of stating a real limit once;
- `editorial-missing-evidence`: a requirement or responsibility that a
  retrieved chunk clearly supports but the CV does not show, with the chunk ID.

It never asks for content the evidence does not support. Resumed v3 runs keep
the v3 prompt.

New runs record critic template `cli-critic-v5`: v4 plus a job emphasis review.
The critic compares the job's central themes, from its requirements and
responsibilities weighted by priority and repetition, with what the draft leads
with, expands and compresses. Each finding is a `coverage` finding that names
one concrete move and the theme or requirement id it serves:

- `emphasis-theme-buried`: expand a supported central theme, or move it up into
  the summary or core areas;
- `emphasis-padding`: compress or drop content the job does not ask for;
- `emphasis-order`: move supported, relevant content earlier;
- `emphasis-theme-gap`: a central theme the approved evidence does not support,
  reported as a gap and never as a move.

Findings are warnings by default. Only `emphasis-theme-buried` can be an error,
and only when the job's top-priority theme is missing from the summary and core
areas and retrieved evidence supports it, so the author can fix it; the critic
contract downgrades an error on any other emphasis code to a warning. They reach
the author like any critic finding, through the adjudicated revision, so an
accepted move is still bounded by the grounding rules. The theme source is one
replaceable sentence in `critic-emphasis.ts`, where the application plan will
feed the critic. Resumed v4 runs keep the v4 prompt.

Date ranges in substantive claims and whole block text, including ranges split
across separately covered claims, must appear as a complete range in one cited
evidence chunk; separate endpoints or ranges do not combine into support. This
checks range support across ordinary claims and blocks.

Employer-first, pipe-delimited experience paragraph headers additionally require the
employer identity and each stated range together on one cited source line.
Separate employer and career-wide date statements, even within one chunk, do
not establish that association. This narrow check retains date-format and
year-only equivalence; it does not infer aliases, validate arbitrary prose
relationships, or independently verify employment. It is not a general semantic
employer/date proof, including when one source line describes several employers.

Author grounding treats a narrow English action phrase such as `Built TypeScript
tools` as an action plus the protected technology name. The exception requires a
known opening past-tense verb, one acronym or mixed-case name, and a recognized
software-object noun. For other capitalized multiword values, uncertain word
order or grouping can pass lexical grounding only when every whole-word
component appears in the same cited evidence chunk and two of the components
appear there as adjacent words; components never combine across chunks or match
as substrings. This is not proof that the combined term
has the claimed meaning, so the independent critic still evaluates it. Numeric,
date, URL, and email checks remain exact, and structured employer/date headers
still require same-line employer association. Headings, contact fields, and
skills or tool lists retain their exact-copy author instructions. Standalone
mixed-case names require whole-token support; `SuperTypeScript` cannot support
a claim of `TypeScript`.

Technical descriptions such as an API delivered as an MVP, an MVP API in a
product definition, a coordinated Solidity/Foundry EVM protocol description,
generated language/protocol proxies, and replacement of a language-based DSL
receive component checks only in explicit software grammar. Each technology or
acronym must still be supported by the cited evidence. Employer, title and ambiguous
name contexts retain full-name protection; this does not add fuzzy matching or
verify arbitrary accomplishments.

The same closed grammar recognizes `Built <name>, a Java Model-Driven
Engineering tool` and `replacing an unmaintainable Haskell-based DSL tool;` as
separate product, language, or descriptor values. A sentence-opening
`At <Employer>, <listed lowercase action> ...` with a single capitalized
employer token protects that name only when the exact structure is present.
Each resulting identity still needs its own evidence. Generic same-chunk
composition may pass a reordered title-case phrase lexically, but does not
establish its identity, employer relationship, or the candidate's role; those
distinctions remain for independent critique.

### Local job-document requirement units

When a run does not select a reviewed opportunity brief, the application
extracts complete list items and paragraphs from the local job document. It
joins wrapped lines, removes Markdown heading structure, preserves later units,
and assigns neutral `medium` priority. The extraction makes no semantic claim
that every retained paragraph is a hiring criterion. Selecting substantive
requirements and assigning priorities belongs to the reviewed opportunity brief.

The fallback rejects documents over 64 KiB, more than one hundred units, units
over two thousand characters, empty/heading-only input, code fences, and tables
with an explicit message directing the candidate to a reviewed brief. It does
not silently truncate source text. Reviewed-brief requirements and priorities
remain authoritative, and existing pinned contexts are never re-extracted on
resume. A corrected interpretation requires a new reviewed context.

### Chronology in evidence retrieval

For local-source contexts without a CKB selection, author and critic retrieval
reserves space for dated Markdown headings from the exact pinned source IDs
and checksums. Headings retain their original text, chunk identity, and source
references. Ranked evidence fills the remaining slots after duplicate and
unapproved-source filtering. This keeps explicit career ranges available even
when their headings contain no job-query terms.

In the `retrieval` evidence mode, the provider selection allows at most
twenty chunks and 128 KiB of serialized evidence. The default `full-source` mode
of a CKB workspace replaces those limits with its own size budget; see
[Evidence mode](../reference/cli-and-desktop.md#evidence-mode). The heading scan allows at most one hundred pinned sources and one
hundred heading chunks per source. Missing or mismatched sources, scan overflow,
or headings that cannot fit the requested count or byte limit fail retrieval
before provider execution. The bounded matcher recognizes Markdown headings
with a year range or an ongoing end marker; it does not infer dates or repair
artifact chronology.

For CKB workspaces requiring Experience, the selected-version route also reserves
matched dated Markdown headings. Fixed local lexical supplements cover English
month and ongoing-end terms and years 1900–2099 in batches below the query-term
cap. Each query returns at most one hundred hits; fallback results are ignored.
Discovered headings are deduplicated and retained before ranked job evidence,
then merged with candidate-priority evidence and the existing required-section
supplements. The original indexed chunks remain unchanged.

The selected CKB source versions are read locally through the managed store and
normalized with the same verified chunk derivation used by the lexical index.
For each discovered heading, retrieval assembles a bounded role record within
that source version. An explicit contribution region, such as `His work:` or
`CV-usable facts`, is preferred over introductory platform or team context.
Complete paragraphs and top-level list items, including nested continuations,
are selected by deterministic lexical overlap with the job query and rendered in
source order. Selection may omit blocks to fit the 4,000-character limit; it never
truncates a block or separates a nested caveat from its list item. A contribution
region stops before a sibling or ancestor heading, or another dated role.

Explicitly independent roles also support project-labelled source groups.
Exact source titles or declared aliases mentioned in candidate instructions
reserve evidence in instruction order before unrequested job-overlap groups.
Requested groups retain a complete contribution block where available, along
with their descriptor, applicable production limitations and nested caveats.
Unrequested groups require substantive job-term overlap; project names alone
do not establish relevance.

Groups share the existing 4,000-character role-record limit and consume no
extra retrieval slots. Selection never invents an alias or truncates a block
or limitation to fit. Local omission reasons remain visible. Supplying a
requested project's evidence lets the author assess job fit; it does not
require inclusion in the CV. Lexical overlap and candidate priority are
input-selection signals, not proof of relevance or candidate achievement.

Requested projects that cannot fit the role record may contribute separate,
source-backed overflow records. Each retains its complete descriptor,
contribution and applicable limitations within the same per-record limit.
Whole overflow bundles from the same role and pinned source may share a record
when their complete text fits. Overflow records use the existing priority slots ahead of generic matches;
they do not duplicate projects already selected in the role record. Their
identities and locators preserve the pinned source version and source ranges.
If these records cannot fit alongside contact, chronology and required-section
evidence within the existing record and byte limits, retrieval fails visibly
before provider transmission.

Without an explicit contribution region or recognized independent project groups,
retrieval retains the existing prefix behavior: heading and following whole chunks, stopping at the next same-level or
higher heading, another dated role, or before the record limit. Non-dated nested
headings may remain in that prefix; an overflowing chunk is not skipped to reach
later material. A heading remains unchanged when no eligible body fits.

A combined record receives a deterministic identity derived from its original
constituents and keeps the pinned source/version and full line-range provenance.
Provider evidence, inspection and diagnostics use the same records. This retains
available role contributions without increasing the twenty-item/128-KiB handoff
limits or claiming that all profile content was transmitted. Source identity,
lifecycle, checksums and exact heading matches are verified before assembly;
other versions and local origin paths are not substitutes. No role-record read
is added when Experience or discovered dated headings are absent.

This is bounded lexical discovery, not an exhaustive chronology inventory.
A saturated matched supplement, discovered headings that cannot fit or are lost
in the merge, or evidence over the twenty-chunk/128-KiB provider bounds fails
closed. The queries are local and introduce no provider calls or inferred dates.
The ordinary CKB lifecycle and freshness checks still apply.

When candidate drafting instructions are nonblank, CKB retrieval also queries
the first explicit sentence-level `Prioritize` clause locally, using at most
2,000 characters and twenty hits. When no such clause exists, it uses the trimmed
instructions. The full instructions still reach the author unchanged.
It reserves up to three distinct matched chunks that are not single-line
Markdown headings, in query order, after chronology and before the general job
query results. Blank instructions add no query; fallback results are not reserved.

The merge chooses the largest prefix of up to three priority chunks that fits
alongside chronology and required-section evidence, retaining source/version
identities and traces. Only Experience may reuse evidence already supplied by
guaranteed chronology chunks under the existing section matcher. Other required
sections keep their dedicated supplements: policy text mentioning education,
credentials, or languages must not displace their source records. Priority and
unselected general-query hits cannot justify skipping a reservation. A required
record found by the general query remains reserved even when it falls beyond
the selected primary prefix; duplicate IDs consume one slot.

Retrieval fails if matched priority evidence is available but not even one chunk
can fit. This preserves contribution evidence within the existing provider limits;
lexical matches do not prove job fit or resolve uncertain source claims.

When a Skills section is configured, CKB retrieval also runs one cached local
`production experience` query with a twenty-hit limit. A substantive explicit
`Production experience:` record takes precedence within the Skills supplement.
Plain and Markdown labels are supported; unavailable, negative, heading-only,
and fallback results are not promoted. Without a matched record, the existing
supplement behavior remains. The record keeps its source/version identity and
content-free trace; this adds no provider call or evidence-budget allowance.

CKB retrieval also reserves one matched candidate contact record for the CV
header, even when Header is not a configured required section. A bounded local
query looks for contact fields; selection requires an actual field in explicit
candidate contact context. Policy mentions and unavailable values do not qualify.
The selected source chunk retains its exact text, identity and provenance. Contact,
chronology and required-section reservations share the existing evidence limits;
retrieval fails when protected evidence cannot fit. This performs no contact
lookup and makes no provider call.

### Explicit experience statements

Author grounding recognizes whole statements such as `No GraphQL experience`
and `GraphQL experience` for a single acronym or mixed-case technology name.
Their protected values preserve both the technology and whether experience is
present or absent. A cited source must explicitly support that same statement,
either directly or in an `Experience:` / `No experience:` list. The source guide
includes these protected statements so the author can use supported word order.

Missing evidence is not evidence of no experience. Conflicting positive and
negative statements, qualified clauses, and partial technology-name matches do
not satisfy this bounded rule. Ambiguous names and longer prose retain the
existing grounding behavior; this is not general semantic factual verification.

### Contact fields and internal references

A standalone international phone claim needs its complete literal in one cited
chunk. Separate digit groups, partial numbers and a number assembled across
chunks do not establish support. Existing protected-value checks still apply.
Opening action verbs can precede a technical name and a bounded software
appositive without becoming part of the name; the technical name itself must
remain source-backed. Titles, employer names and linking statements keep their
existing protection.

A terminal `; see <section>.` suffix is navigation only when the exact target is
both configured and present in the proposal. Grounding still checks all preceding
text and claims. Unknown targets, additional assertions, dates and unsupported
names receive the normal checks. This recognizes a document reference, not an
exception for unsourced achievements.

### Software-description phrases

A bounded language modifier followed by a platform name in a software-object
phrase produces two protected names. A claim-start project label ending in
`MVP:` similarly preserves both its project name and stage token for source
checks. Neither rule exempts a component from support in cited evidence.
Company subjects, role titles and linking statements still require source-backed
components; a newly composed full name remains semantically uncertain.

The software-object vocabulary includes singular `proxy` and plural `proxies`.
In the narrow generation phrase `generating Java and Python FLUXRPC proxies`,
the closed language modifiers and technology name remain separately protected.
The same coordination rule applies to `producing`; employer and title phrases
retain whole-name checks, and each separated component still needs evidence.

Software appositives can include one recognised programming-language modifier
before their bounded qualifiers. This separates an opening action from its tool
name while retaining source checks for the language and tool. These syntax rules
do not establish semantic relationships or replace independent critique.

### Local rejected-author replay

The local driver accepts an optional `authorProposalCaptureDirectory` for
explicit diagnostic sessions. The selected parent directory must already exist.
When application validation rejects a parsed author proposal, a new private
subdirectory contains `replay.json`: the proposal, exact `buildAuthorArtifact`
validation inputs, provider/model identity, and sanitized failure diagnostics.
On POSIX, directories use mode `0700` and files use `0600`. Existing captures
are never overwritten. Capture is disabled by default and has no CLI flag or
renderer control.

These files contain sensitive candidate material and source paths. The caller
owns their retention and deletion; keep the directory outside shared repositories.
Replay locally by passing the saved `validationInputs` to `buildAuthorArtifact`,
or summarize a capture directory with the content-free `capture-report` command
described in the [pilot protocol](../evaluation/pilot-protocol.md).
Only a capture success/failure code joins normal error diagnostics; captured
content stays out of run history and retry feedback. Capture errors preserve the
original rejection and retry policy. Transport errors and provider token-budget
rejections occur before this boundary and are not captured. No provider call,
retry reset, candidate approval, or export is triggered by capture or replay.

### Author revision report

After a validation rejection, the next author attempt for the same run and
round in the same process revises its rejected proposal instead of starting
over. It receives a `revision` input holding:

- the rejected proposal;
- a bounded report of at most 16 items, each with the issue path and code, the
  offending text, and specific problems, such as unsupported values, words,
  and names, or a date range next to the ranges the cited evidence states.

The report quotes candidate content, so it goes only to the author provider
and is held only in bounded process memory. Run history, diagnostics, retry
feedback, and captures stay content-free. After a restart, the memory is empty
and retries use content-free retry feedback alone.

### Local unknown Claude category capture

The local application driver accepts an optional
`localClaudeCategoryCaptureParent` for explicit diagnostic sessions and passes
it only to Anthropic user-session adapters constructed for run execution.
Capture is disabled by default, has no CLI or renderer control, and requires a
caller-selected parent directory that already exists. When a structured Claude
error contains an unrecognized category-shaped `subtype` or `terminal_reason`,
the adapter writes only those exact strings to a new `categories.json` file in
an unpredictable private subdirectory. Each value is limited to 128 UTF-8
bytes; an oversized value prevents any partial capture. On POSIX, the directory
uses mode `0700` and the file uses `0600`.

The capture excludes stop reasons, provider prose, prompts and outputs, errors,
session and usage data, model content, paths, URLs, credentials, and environment
values. Neither the capture path nor captured strings enter the provider error
or run history. A fixed capture success/failure diagnostic is appended without
changing the original error code, message, status, retryability, or failure
stage. Capture never triggers a provider call or changes retry behavior; the
caller owns retention and deletion of the local file.

The allowlist recognizes Claude's `api_error` terminal reason and the `success`
result subtype, including the documented case where a result is still marked
`is_error: true`. A structured `api_error` without a finite numeric API status
is classified as a retryable transient provider failure with fixed diagnostics
and a generic message. When a numeric status is present, status mapping takes
precedence, so authentication, quota, rate-limit, server-error, and other
status-bearing behavior remains unchanged. Dynamic provider prose is never
used for this statusless classification or retained in diagnostics.

### Author adjudication and revision trace boundary

`packages/schemas` also owns the strict, versioned author-adjudication plan and
adjudicated-revision trace contracts. A plan binds one explicit `accept`,
`reject`, or `nuance` decision and concise rationale to every finding in one
readiness report, snapshots only the finding metadata needed for audit, and
derives whether a revision is required or a disagreement must remain visible.
The pure `buildAuthorAdjudicationPlan` helper in `packages/orchestrator`
validates the report/source-artifact identity, target references, complete
decision coverage, and deterministic report order.

`packages/artifacts` owns the pure `diffArtifacts` and
`traceAdjudicatedRevision` helpers. A trace requires a distinct next artifact
version linked to its source parent, records strict claim/section/artifact
diff IDs, and marks accepted effects verified only when the current diff proves
them. Evidence, requirement, and rubric effects remain missing unless an
explicit, bounded effect override records a concise rationale; rejected and nuanced
findings remain `disagreement-preserved`.

Approved overrides are conditional: a direct effect takes precedence and remains `verified`, even when an override
was supplied. The persisted approved override is retained; duplicate, unknown,
malformed, and non-accepted overrides still fail validation. A trace is valid
only when no accepted effect is missing. Verification records structural
changes, not semantic resolution of findings; it never exposes a `resolved` flag.
Resolution is judged only by the next critic pass; see below.

The orchestrator exposes a `requestAdjudicatedRevision` runtime carrier. It
persists the exact report, canonical plan, accepted-effect overrides, and
nullable derived trace in the existing run snapshot, and passes that carrier
only to the matching revision author execution. The application author
adapter now transmits that exact content-safe carrier only on that matching
revision and adds explicit instructions to apply accepted findings, preserve
rejected or nuanced disagreements, and retain the evidence and factuality
safeguards above. Legacy revision requests remain separate, and invalid
provider lineage fails closed without a trace. This #72 runtime slice does not
generate reports, add persistence tables or migrations, or change approval and
stopping semantics. The #277 application/local boundary now stages that exact
report and complete adjudication through the shared application driver, using
the existing provider-independent runtime validation and durable run history
without opening a provider. CLI and desktop controls and report generation
remain deferred. It stores no raw prompts, raw responses, or hidden reasoning;
duration accounting issue #278 remains ordered after this staging prerequisite.

### Finding attribution and classification (#1108)

A version 2 revision trace carries `attribution`: every changed block (by
positional `blockKey`) with the ids of the accepted findings that targeted it,
the accepted findings no changed block could be tied to, and a
`findingIdentity` for every adjudicated finding. The author's structured output
is a plain artifact proposal and cannot name finding ids, so attribution is
derived from the block diff plus each finding's target: a claim finding maps to
that claim's block, a section finding to every changed block of the section.
Version 1 traces have no `attribution` and still load and replay unchanged.
When the revision was a targeted patch (#1112, below) the attribution comes from
the edits instead and carries `source: "edits"`.

After the critic pass that reviews the revised artifact, the orchestrator stores
a content-free `findingClassification` on that critic execution. An accepted
finding is `persisting` when the pass raises a finding with the same identity
and `resolved` otherwise. A finding of the pass that matches no adjudicated
finding is `new`; a recurring rejected or nuanced finding is a preserved
disagreement and is not classified. Entries carry ids, identity, severity and
counts only, so #1112 and #1113 can consume them directly.

Artifact, section, block and claim ids are minted per execution and change on
every revision, so findings are matched by `findingIdentity`, not by id:
`normalizedCode|targetKind|locator`. The code is lower-cased with punctuation
runs collapsed to `-`. A claim target locates its block as
`<sectionKind>#<n>/b<i>` (the n-th section of that kind, the i-th block), a
section target as `<sectionKind>#<n>`, requirement, evidence and rubric targets
keep their stable ids, and an artifact target is `artifact`. Messages and
severity are ignored, so near-duplicates in one block collapse into one
finding. The key is positional and code-based: a critic that rewords a code, or
a revision that inserts or reorders blocks, makes a real match fail and reads as
one `resolved` plus one `new`.

### Targeted revisions (#1112)

A revision on author template `cli-author-v10` answers with block-level edits
instead of a whole new proposal. A full rewrite costs output tokens, can change
blocks nobody flagged and can drop a line that covered a requirement. First
drafts, retries after a rejection and runs recorded on v9 or earlier keep the
full-proposal revision and their exact prompts.

**Patch.** `{edits: [...]}`, each edit a `replace`, `insert` or `delete` of one
block, with the complete new block (type, text and cited claims) for a replace or
insert, and the `findingIds` of the accepted findings it addresses. The author
keys edits to the section and block ids of the `currentArtifact` it receives.
Those ids are minted per execution, but a patch is applied only to the exact
artifact it was written against, so they are unambiguous. The application maps
them to the positional keys (`<sectionKind>#<n>/b<i>`) of #1108 for attribution.

**Applying.** The patch is expanded locally into a complete proposal: blocks no
edit names are copied from the current artifact with their claims and evidence,
so they stay identical. The proposal then goes through the same citation
completion, grounding and validation as any author proposal, so an unsupported
claim in an edited block is rejected. A delete that removes the block covering a
requirement still raises the dropped-coverage warning (#1212), because that
check compares the revised artifact with the previous one.

**Rejection and fallback.** The patch is rejected for malformed JSON, an unknown
block, section or finding id, two edits to one block, a section left without
blocks, an unmappable evidence reference, or a result that grounding would
shorten or leave blocks out of. The agent then requests the full-proposal
revision in the same attempt and sums the tokens and cost of both calls. The
mode is stored on the revision execution as `revisionMode`: `patch`, `full`, or
`patch-fallback`.

**Attribution.** The execution carries the applied edits, and the trace
attribution uses each edit's `findingIds` directly (`source: "edits"`), listing a
finding as unattributed only when no edit names it. A full rewrite keeps the
derived diff attribution. A replayed execution keeps its stored edit-sourced
attribution, because the edits are not stored.

### Application plan before drafting (#1304)

A run on author template `cli-author-v11` decides what the CV should lead with
before the first draft. The plan step is bounded at three provider calls, in
this order:

1. The author model plans: the job's 3 to 5 ranked central themes, each linked
   to requirement ids and to the approved evidence ids that best prove it; what
   leads (the summary angle and 3 to 5 core-area items); and what to drop or
   compress. A theme no approved evidence supports is a **gap** with no
   evidence ids, never something to claim.
2. The critic model reviews the plan for fit to the job and answers accept, or
   revise with specific points.
3. On revise, the author revises the plan once. There is no second review.

The plan holds short user-visible text and ids, no reasoning, and no facts of
its own. Validation (`validateApplicationPlan` in
`packages/schemas/src/application-plan.ts`) rejects an evidence id the request's
approved evidence lacks, an unknown requirement id, and a core area that serves
a gap; a rejected plan fails the step as an invalid response, which can be
retried. Evidence is sent under the same short aliases as drafting.

`packages/orchestrator/src/application-plan.ts` runs the step through the
`ApplicationPlanner` port; `packages/application/src/application-plan-agent.ts`
implements it with the run's author and critic models. Each call is persisted
on the run snapshot (`applicationPlan`) when it completes, so a resumed run
continues mid-plan without repeating a call, and its cost is added to the run
cost, which the cost budget is checked against before each call and before
the draft. Runs on earlier templates do not plan and resume unchanged, and
`applicationPlan: false` in the run options turns the step off for tests.

The reviewed plan goes to the author as guidance on every round: `cli-author-v11`
states that it is not evidence, that grounding applies to the draft as before, and
that a candidate direction outranks it. Earlier versions never receive it. The
`cli-critic-v5` emphasis review takes its central themes from the plan instead of
deriving them from the job (`emphasisPlanThemeSourceInstructions` replaces
`emphasisThemeSourceInstructions`), and reports a plan gap as
`emphasis-theme-gap`. The plan is recorded in run history as a
`run.application-plan` event and shown in **Run details** as "Application plan".

### Fuller bullets and labelled Core areas (#1338)

Author `cli-author-v12` keeps v11 and asks for 3 to 5 substantive bullets per
role, each combining what was done, how, and the scope or result (about 30 to 60
words), labelled Core areas lines whose label words appear in cited evidence,
a few compact certification lines, and complete statements only. The guidance
never overrides grounding, required sections or the writing policy. Resumed v11
and earlier runs keep their exact prompt. Deterministic validation reports a
bullet that opens with a lowercase letter (other than a known name such as `iOS`
or `npm`) or ends on a dangling connector as an `editorial-fragment` warning, so
the critic and readiness steps see it. New runs use v14 (below), whose v13 base
supersedes v12's bullet guidance; the fragment check still applies.

### Context paragraphs and labelled lines (#1341)

Author `cli-author-v13` supersedes v12's bullet guidance: it is v11 plus a block
that replaces it. Bullet markers should sit several lines apart, so short bullets
are never stacked. The author writes:

- **Per role or project:** a role line paragraph, a 1 to 3 line context paragraph
  (what it was, scope, team, stack), then 2 to 4 bullets of about 3 to 4 lines
  (roughly 45 to 70 words). Older roles get 0 to 2 bullets.
- **Whole CV:** about 12 to 20 bullets, never more than 4 in a row.
- **Core areas, Skills, Education and Certifications:** `Label: items` paragraphs
  grouped by theme, never bullets. Label words must appear in cited evidence.

The guidance never overrides grounding, required sections or the writing policy.
Resumed v12 and earlier runs keep their exact prompt. Deterministic validation
adds a `dense-bullet-series` quality warning, one per run of consecutive bullets,
anchored to its first block. It fires for more than 4 bullets in a row, a section
of 4 or more one-line bullets, and adjacent bullets where either has under about
30 words.

### Writing to the page target (#1364)

Author `cli-author-v14` is v13 plus length guidance keyed on the writing policy's
`Page target`. A two-page target, or none, keeps v13's counts. A one-page CV is a
shorter text, not the same text printed smaller:

- **Summary:** 2 to 3 lines.
- **Bullets:** only for the 2 or 3 roles or projects most relevant to the job,
  at most 3 each and about 6 to 9 in total, each about 2 to 3 lines.
- **Other roles:** the role line and a one-line context paragraph. Every role
  keeps its title, employer and dates.
- **Labelled paragraphs:** 2 or 3 in Core areas, one or two lines each for
  Skills, Education and Certifications.

Resumed v13 and earlier runs keep their exact prompt. When an export names no
template, a one-page run is drawn with Compact and any other with Modern, so the
layout matches the length the author wrote to.

### Each fact stated once (#1859, #1860)

Deterministic validation adds one `repeated-fact` quality warning per fact the
draft states in more than one section, naming each section ("the same fact is
stated in Summary, Core areas and Experience"). Two substantive claims in
different sections state the same fact when the shorter one has at least four
content words and the longer one holds at least 80% of them, after dropping
function words and plural or verb endings. Exact copies stay with the existing
duplicate claim check. The warning never blocks approval.

Author `cli-author-v15` (#1860) is v14 plus guidance that gives each part of
the CV its own job:

- **Experience and Projects** carry the detail of each fact.
- **Summary** condenses the candidate in new words and never restates a bullet.
- **Core areas** group evidence from across roles under one theme the job asks
  for; a theme with a single example is left to Experience.

A revising author already receives the draft's findings. v15 tells it to keep a
`repeated-fact` finding's fact in one section and remove or rewrite the other
occurrences, unless the person rejected that finding in the adjudication plan.
Resumed v14 and earlier runs keep their exact prompt.

### Stop and pause on findings (#1113)

The `stable-convergence` score-delta rule is unchanged and still stops a run
whose scores stop moving. Two rules read the blocking findings instead, using
the exact `findingIdentity` from the previous section. They live in
`packages/orchestrator/src/consensus-stop.ts` and run after each critic pass.

- **`consensus-ready`**: the draft is ready (no blocking finding, rubric met)
  and the blocking findings of the previous round are resolved. A ready draft
  with nothing resolved keeps the plain `ready` reason.
- **`persisting-findings`**: a blocking finding with the same identity blocked
  two consecutive rounds. The run pauses for the candidate, autopilot included,
  and the pause event records the identities in `persistingFindings`.

After an adjudicated revision only accepted blocking findings count, so a
recurrence the candidate rejected is a preserved disagreement and never pauses.
Without adjudication, as in autopilot rounds, the previous round's blocking
identities (kept on `latestEvaluation.blockingFindingIdentities`) are compared
with this round's. The candidate's decision sticks: an identity the candidate
rejected, overrode or deferred in the review never pauses again, in that round
or later. Only accepted or undecided findings do. The run store lists the
recorded finding decisions (`RunStore.listFindingDecisions`), and
`latestEvaluation.blockingFindingRefs` maps each identity to the review's
finding id so a decision can be matched to it. Identities use positional block keys, so inserting a block
can turn one finding into a resolved-plus-new pair. That near-miss does not
match and never pauses. Round, cost and time limits apply as before. The final
reason is stored on `latestEvaluation.stopReason`, and the desktop words it in
plain language.

### Application-readiness stopping decision boundary

`packages/schemas` owns the strict, versioned application-readiness stopping
decision contract. It binds one #71 readiness report, an optional latest #72
revision trace, the exact artifact and context identities, artifact creation
and parent-version chronology, canonical per-dimension agreements,
content-free deterministic checks, blockers, limitations, embedded loop
context, and derived stop fields. Human approval remains a required literal in
the contract; application readiness never means that approval was given.

The pure `evaluateApplicationReadinessStoppingDecision` helper in
`packages/evaluations` validates the artifact, report, and trace, reruns local
deterministic validation, and applies conservative readiness blockers and
bounded stop-reason precedence. It stores no diagnostic messages, source
excerpts, provider payloads, or hidden reasoning in its deterministic
projection.

The #73 runtime boundary assembles a fresh current-artifact report at human
approval, persists the readiness decision and an exact artifact checksum
binding, clears that binding on revision or artifact replacement, and requires
the same application-ready binding before export. Older snapshots may omit
these optional fields and fail closed at export until a new approval records
them. Provider, CLI, and desktop presentation remain owned by their respective
boundaries; export invokes the rendering-QA contract after this binding passes.

### Rendering and rendering-QA boundary (#74)

`packages/rendering` owns two controlled A4 layout profiles:
`compact-one-page` and `standard-two-page` (the default). The selected profile
is recorded with the source-content and rendered-byte checksums, and is applied
consistently to the minimal HTML, PDF, and DOCX implementations. Content is
never truncated, reordered, summarized, or rewritten to satisfy a page target;
an overflowing PDF is a deterministic QA failure signal.

`standard-two-page` matches a hand-made CV's density: 9 pt body at 11 pt
leading, 10.5 pt bold headings with a rule, a 16 pt title, 12 mm side margins and 10 mm top and bottom margins,
wrapped to the real line width. About 2,000 words of a typical CV fit on two
pages. The PDF embeds Carlito, the Calibri-metric-compatible font, in full as a
Unicode font, so any character Carlito has a glyph for is drawn and reads back
as written; the DOCX names Calibri with the same exact leading. Exports record the layout as
`cv-controlled-v4`, which adds role context lines, bold labels and compact
lists. Records written as `cv-controlled-v3` (role headers), `cv-controlled-v2`
(before role headers) or `cv-controlled-v1` (the earlier, looser layout) still
parse.

The layout reads structure from the blocks without editing their text:

- **Role context.** In Experience and Projects, a paragraph with a ` | `
  segment is a role header when bullets or a plain paragraph follow it. A plain
  paragraph directly after it is a context line and stays regular. A paragraph
  directly followed by bullets remains a role header.
- **Labels.** A paragraph or bullet that opens with a short `Label:` followed by a space (at most
  five words and 40 characters, with a letter, and not a URL scheme or a time)
  draws the label in bold and the rest regular.
- **Compact lists.** A run of three or more consecutive bullets that each fit on
  one line is drawn as one wrapped paragraph with the items joined by ` · ` and
  no bullet glyphs (`minCompactListItems` in `compact-list.ts`). Runs with a
  two-line bullet stay bullets.

The PDF tags label and compact lines with marked content, and the DOCX uses a
`CompactList` style, so the inspectors split a compact paragraph back into its
bullets and rejoin labels. Content-integrity and block-order checks are
unchanged.

The PDF font is a profile property (`typography.pdfFont`). Carlito Regular and
Bold are vendored unmodified (SIL OFL 1.1) as a generated, Flate-compressed
TypeScript module, so the CLI and the bundled desktop app need no file lookup;
a two-page PDF is about 570 kB. Wrapping and the length estimate measure with
the font's own advance widths. `compact-one-page` keeps the unembedded
Helvetica. The font source, pinned checksums, licence, and regeneration steps
are in `packages/rendering/fonts/carlito/NOTICE.md`.

#### Printed PDFs (#1362)

`renderPrintHtml` (`packages/rendering/src/print-html.ts`) turns an artifact into one
self-contained A4 HTML document for the selected template. It embeds Carlito and marks every
visible block with `data-dl-unit`, whose text content is exactly the block's text. A bullet is a
real `•` in a hanging indent. There is no letter-spacing; Modern's uppercase headings are a CSS case
transform, so the reported units keep the artifact's text. Keep rules are CSS `break-*` properties.

The desktop host passes a `PdfPrinter` with PDF exports
(`apps/desktop/src/electron/pdf-printer.ts`). It loads the HTML in a hidden, sandboxed window on an
in-memory session that refuses every other request, collects the marked units, and prints with
`printToPDF` (CSS page size, tagged PDF). `exportApprovedRun` then builds the export from those
bytes with `renderedPrintedPdf`. QA (`buildPrintedPdfRenderingQa`) compares the reported units
with the artifact in place of reading text back from the bytes, and takes the page count from the
PDF. An export that fails QA writes nothing. Without a printer, as in the CLI, a PDF is drawn by
the built-in writer.

#### Rendering templates (#1328)

A rendering template is validated data (`renderingTemplateSchema`, exposed as
`@draft-loop/schemas/rendering-template`): page margins and page target, font
sizes and line height, spacing, heading rule and case, name alignment, body
alignment, the role context-line style and an optional accent colour. Every value
is bounded, and the enums accept only what the renderer draws today.

`packages/rendering/src/templates.ts` holds the built-ins. `classic` (the
renderer's fallback when no template is named) and `modern` (the export default)
produce the `standard-two-page` profile and `compact`
produces `compact-one-page`. `profileFromTemplate` derives the profile every
output format shares; settings a template does not carry (font names, wrapping
caps, preview spacing, title and heading leading) are fixed per page target for
the `sans` family, except that the title line grows to fit a larger name. `renderArtifact` takes an optional `templateId` and still accepts
`layoutProfile`; naming both requires that they agree.

Modern (#1329) follows the owner's hand-made reference CV: a left-aligned name,
uppercase headings and role dates in a teal accent, justified text, labelled
paragraphs with a hanging indent, and an italic context line under each role
(the engine slants regular Carlito; no italic face is embedded).

Every output draws these options: the printed desktop PDF and the DOCX since #1412, the built-in PDF writer since #1791.

- **DOCX.** It uses the template's own profile (`profileFromTemplate`), so
  Modern's margins and sizes too. The look lives in paragraph styles: the
  `Title` alignment, `caps` and the accent colour on `Heading1`, `both`
  justification on `Normal`, a `RoleContext` style for the italic line under a
  role, and a `Labelled` style with a hanging indent. The text stays as
  written, so rendering QA reads the same words as from Classic. Classic and
  Compact DOCX bytes are unchanged.
- **Built-in PDF writer.** It also uses the template's own profile. It draws
  the name's alignment, fill colours for the name, contact line, headings and
  role dates, the rule colour, justified body lines (word spacing), and the
  context line slanted and greyed. Capitalised headings carry their written
  text as `/ActualText`, which both PDF readers in `packages/rendering` use,
  so rendering QA reads the same words as from Classic.

The id and version of the template are on `RenderedDocument.metadata.renderingTemplate`
and in the export payload as `renderingTemplate`. The rendering-QA report keeps
only the layout profile.

The person picks the template at export (#1330): `ExportCommand.templateId`,
`export --template <id>` in the CLI, and the `template` field of the desktop
`export` action, which the bridge allowlist accepts only for built-in ids. The
desktop remembers the choice per application in `localStorage`, keyed by the
application's first run (`apps/desktop/src/export-template.ts`). A chosen
template's page target replaces the writing policy's in the length warning.

#### Role headers

In an Experience or Projects section, a paragraph directly followed by bullets
is a role header (`role` layout block, `packages/rendering/src/role-header.ts`).
It is drawn bold with extra space before it, except directly under a section
heading (`roleBeforePt`; bullets follow each other with no extra gap). If its last
` | ` segment is a month-year or year date range, that segment is right-aligned
on the same baseline: a right tab stop in the DOCX, flex alignment in the HTML
preview. A left part too long for the line wraps, and a line that cannot share
its row with the dates falls back to plain bold. The block text is never edited.

The PDF draws role headers in font resource `F3`, a second name for the bold
face of `F2` that reuses the same embedded font file. The inspectors read `F2`
runs as headings and `F3` runs as body text, so role headers are not counted as
sections. The layout does not draw the ` | ` before a right-aligned date; the
PDF and DOCX inspectors restore it when they recover the text (same baseline, or
a bare tab), so content integrity compares role lines like any paragraph.

`buildRenderingQaReport` produces a strict, immutable, content-free report of
exact visible-content integrity, section/block order, active-content signatures,
and inspectable PDF page counts. The application builds this report after exact
approval and before writing any export, and persists it with export history.
Markdown uses deterministic QA; PDF and DOCX use the named controlled byte
inspectors, which recover text and report bounded page/layout failures.

Content-integrity, active-content, clipped-text, blank-page, and orphan-section
failures stop the export before any file is written. A PDF that fails only page
fit is still written: its stored report keeps `passed: false`, and the export
writes one `Length warning:` line with the real page count, as DOCX and
Markdown do from their length estimate.

The PDF inspector checks page targets, blank pages, text coordinates (each run measured with the PDF font's real advance widths against the right margin), and
orphaned section starts where a page boundary makes them determinable. The DOCX
inspector checks OOXML text order, explicit page breaks, package integrity, and
relationship targets. OOXML bytes cannot establish true office pagination or
visual clipping, so that limitation remains explicit; this is not exhaustive
cross-viewer certification. Structured links and images remain unsupported by
the current artifact model.
