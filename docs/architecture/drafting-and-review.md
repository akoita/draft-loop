# Drafting and review architecture

This page is the canonical current-state reference for evidence-grounded drafting, independent review, deterministic quality checks, and controlled rendering. It describes the provider-independent contracts and boundaries that shape author output, critic findings, revisions, readiness, and export QA.

Use [Architecture overview](overview.md) for the system map. See [Candidate evidence](candidate-evidence.md) for the source, policy, opportunity, and profile contracts, and [Runtime and trust](runtime-and-trust.md) for workflow state, provider, and export boundaries. [ADR 0003](../adr/0003-evidence-grounded-evaluator-optimizer.md) records the evaluator–optimizer adaptation.

## Evidence-grounded evaluator–optimizer

DraftLoop applies the evaluator–optimizer pattern to a factual, evidence-backed
workflow. The author is the optimizer's generator, the independent critic is
the evaluator, and each revision is a bounded optimization step against a
visible rubric. The product uses author–critic language in the UI because it is
clearer to candidates.

```text
canonical inputs + rubric
          |
          v
     author draft ---------> structured artifact + evidence links
          ^                                      |
          |                                      v
   bounded revision <----- independent evaluator + deterministic checks
          |
          v
  stable / budget exhausted / user review early
          |
          v
       human approval -> local export
```

The rubric covers factuality, evidence support, requirement coverage, and
quality. Deterministic validators handle checks that do not need a model.
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
It never loops indefinitely to optimize a subjective score. See [ADR
0003](../adr/0003-evidence-grounded-evaluator-optimizer.md).

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

Author grounding treats a narrow English action phrase such as `Built TypeScript
tools` as an action plus the protected technology name. The exception requires a
known opening past-tense verb, one acronym or mixed-case name, and a recognized
software-object noun. Headings, ambiguous title words, employer statements, and
multi-word names keep their existing full-span checks. Standalone mixed-case
names also appear in the source grounding guide and require whole-token support;
`SuperTypeScript` cannot support a claim of `TypeScript`. This is a conservative
syntactic rule, not general semantic verification.

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

### Chronology in local-source retrieval

For local-source contexts without a CKB selection, author and critic retrieval
reserves space for dated Markdown headings from the exact pinned source IDs
and checksums. Headings retain their original text, chunk identity, and source
references. Ranked evidence fills the remaining slots after duplicate and
unapproved-source filtering. This keeps explicit career ranges available even
when their headings contain no job-query terms.

The provider selection allows at most twenty chunks and 128 KiB of serialized
evidence. The heading scan allows at most one hundred pinned sources and one
hundred heading chunks per source. Missing or mismatched sources, scan overflow,
or headings that cannot fit the requested count or byte limit fail retrieval
before provider execution. The bounded matcher recognizes Markdown headings
with a year range or an ongoing end marker; it does not infer dates or repair
artifact chronology. CKB retrieval retains its separate selected-version path.

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
Replay locally by passing the saved `validationInputs` to `buildAuthorArtifact`.
Only a capture success/failure code joins normal error diagnostics; captured
content stays out of run history and retry feedback. Capture errors preserve the
original rejection and retry policy. Transport errors and provider token-budget
rejections occur before this boundary and are not captured. No provider call,
retry reset, candidate approval, or export is triggered by capture or replay.

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

`buildRenderingQaReport` produces a strict, immutable, content-free report of
exact visible-content integrity, section/block order, active-content signatures,
and inspectable PDF page counts. The application builds this report after exact
approval and before writing any export, and persists it with export history.
Markdown uses deterministic QA; PDF and DOCX use the named controlled byte
inspectors, which recover text and report bounded page/layout failures.

The PDF inspector checks page targets, blank pages, text coordinates, and
orphaned section starts where a page boundary makes them determinable. The DOCX
inspector checks OOXML text order, explicit page breaks, package integrity, and
relationship targets. OOXML bytes cannot establish true office pagination or
visual clipping, so that limitation remains explicit; this is not exhaustive
cross-viewer certification. Structured links and images remain unsupported by
the current artifact model.
