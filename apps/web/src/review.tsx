import { useCallback, useEffect, useState } from "react";

import { type ApiClient, describeError } from "./api-client.js";
import { readDefaultApplication } from "./applications.js";
import { describeActionError } from "./consent-model.js";
import { FinishPanel } from "./finish.js";
import {
  approveRequest,
  canExport,
  type ExportFormat,
  exportFileName,
  exportRequestBody,
  type RunExport,
} from "./finish-model.js";
import { useRecordId } from "./record-context.js";
import {
  type BlockView,
  blockEditProblem,
  type Decision,
  decisionChoices,
  decisionLabel,
  decisionRequest,
  type Finding,
  pendingCount,
  type RunReview,
  reviewOpen,
  reviewSections,
} from "./review-model.js";
import type { Run } from "./run-model.js";
import { saveFile } from "./save-file.js";
import { currentRunId, screenMemory } from "./screen-memory.js";

export interface ReviewStepProps {
  readonly client: ApiClient;
  /** The run the Run step follows; the newest run when the page has not opened one. */
  readonly run: Run | undefined;
  /** Follows a run in the Run step, after asking for another round. */
  readonly onFollowRun: (run: Run) => void;
}

/** The draft with its evidence, the critic's findings and their decisions, and block edits. */
export function ReviewStep({ client, run, onFollowRun }: ReviewStepProps) {
  const workspaceId = useRecordId();
  const [review, setReview] = useState<RunReview | undefined>(undefined);
  const [exports, setExports] = useState<readonly RunExport[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const runId =
        run?.runId ??
        (await readDefaultApplication(client, workspaceId).then((application) =>
          currentRunId(application, screenMemory.read()),
        ));
      if (runId === undefined) return;
      const path = { workspaceId, runId };
      const read = await client.call("GET /v1/workspaces/{workspaceId}/runs/{runId}/review", {
        path,
      });
      setReview(read);
      if (canExport(read))
        setExports(
          (await client.call("GET /v1/workspaces/{workspaceId}/runs/{runId}/exports", { path }))
            .exports,
        );
    } catch (error) {
      setMessages([describeError(error)]);
    } finally {
      setLoaded(true);
    }
  }, [client, run?.runId, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: () => Promise<RunReview>): Promise<boolean> {
    setBusy(true);
    try {
      setReview(await action());
      setMessages([]);
      return true;
    } catch (error) {
      setMessages([describeError(error)]);
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <p role="status">Reading the review…</p>;
  if (review === undefined)
    return (
      <section className="panel">
        <h2>Review</h2>
        <p>No run yet. Start one in the Run step.</p>
        <Messages messages={messages} />
      </section>
    );

  const path = { workspaceId, runId: review.run.runId };

  async function attempt(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      setMessages([]);
    } catch (error) {
      setMessages([describeActionError(error)]);
    } finally {
      setBusy(false);
    }
  }

  const approve = (rationale: string) => {
    if (review === undefined) return;
    const request = approveRequest(review, rationale);
    if ("problem" in request) {
      setMessages([request.problem]);
      return;
    }
    void attempt(async () => {
      await client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/approve", {
        path,
        body: request.body,
      });
      await load();
    });
  };

  const revise = (direction: string) =>
    void attempt(async () => {
      const trimmed = direction.trim();
      onFollowRun(
        await client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/revision", {
          path,
          header: { "idempotency-key": crypto.randomUUID() },
          body: trimmed === "" ? {} : { candidateDirection: trimmed },
        }),
      );
    });

  const exportDraft = (format: ExportFormat, templateId: string) =>
    void attempt(async () => {
      const exported = await client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/exports", {
        path,
        header: { "idempotency-key": crypto.randomUUID() },
        body: exportRequestBody(format, templateId),
      });
      await load();
      download(exported);
    });

  const download = (exported: RunExport) =>
    void attempt(async () => {
      const bytes = await client.call(
        "GET /v1/workspaces/{workspaceId}/runs/{runId}/exports/{exportId}/content",
        { path: { ...path, exportId: exported.id } },
      );
      saveFile(bytes, exportFileName(exported));
    });

  return (
    <>
      <ReviewPanel
        review={review}
        busy={busy}
        messages={messages}
        onDecide={(findingId, decision, rationale) => {
          const request = decisionRequest(decision, rationale);
          if ("problem" in request) {
            setMessages([request.problem]);
            return Promise.resolve(false);
          }
          return act(() =>
            client.call(
              "PUT /v1/workspaces/{workspaceId}/runs/{runId}/findings/{findingId}/decision",
              { path: { ...path, findingId }, body: request.body },
            ),
          );
        }}
        onEdit={(blockId, text) => {
          const problem = blockEditProblem(text);
          if (problem !== undefined) {
            setMessages([problem]);
            return Promise.resolve(false);
          }
          return act(() =>
            client.call("PUT /v1/workspaces/{workspaceId}/runs/{runId}/edits/{blockId}", {
              path: { ...path, blockId },
              body: { text },
            }),
          );
        }}
      />
      <FinishPanel
        review={review}
        exports={exports}
        busy={busy}
        onApprove={approve}
        onRevise={revise}
        onExport={exportDraft}
        onDownload={download}
      />
    </>
  );
}

function Messages({ messages }: { readonly messages: readonly string[] }) {
  return (
    <>
      {messages.map((message) => (
        <p key={message} className="problem" role="alert">
          {message}
        </p>
      ))}
    </>
  );
}

export interface ReviewPanelProps {
  readonly review: RunReview;
  readonly busy: boolean;
  readonly messages: readonly string[];
  readonly onDecide: (
    findingId: string,
    decision: Exclude<Decision, "pending">,
    rationale: string,
  ) => Promise<boolean>;
  readonly onEdit: (blockId: string, text: string) => Promise<boolean>;
}

export function ReviewPanel({ review, busy, messages, onDecide, onEdit }: ReviewPanelProps) {
  const open = reviewOpen(review);
  if (review.draft === null)
    return (
      <section className="panel">
        <h2>Review</h2>
        <p>The run has no draft yet. The Run step shows where it is.</p>
      </section>
    );
  const { sections, general } = reviewSections(review.draft, review.findings);
  const pending = pendingCount(review.findings);

  return (
    <div className="review">
      <section className="panel">
        <h2>Review</h2>
        <p className="muted">
          Draft version {review.draft.version} ·{" "}
          {pending === 0 ? "every finding decided" : `${pending} finding(s) to decide`}
          {open ? "" : " · the run no longer takes decisions or edits"}
        </p>
        <ReviewFacts review={review} />
        <Messages messages={messages} />
      </section>
      {general.length === 0 ? null : (
        <section className="panel">
          <h3>Findings about the whole CV</h3>
          {general.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              open={open}
              busy={busy}
              onDecide={onDecide}
            />
          ))}
        </section>
      )}
      {sections.map((section) => (
        <section key={section.id} className="panel draft-section">
          <h3>{section.title}</h3>
          {section.blocks.map((view) => (
            <DraftBlock key={view.block.id} view={view} open={open} busy={busy} onEdit={onEdit} />
          ))}
          {section.findings.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              open={open}
              busy={busy}
              onDecide={onDecide}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function ReviewFacts({ review }: { readonly review: RunReview }) {
  const independent = review.independentReview;
  return (
    <>
      <dl className="facts">
        {independent === null ? null : (
          <>
            <dt>Independent review</dt>
            <dd>
              Author {independent.authorLineage}, critic {independent.criticLineage}
              {independent.lineagesDistinct ? "" : ": the same company, so the critique is weaker"}
            </dd>
          </>
        )}
        {review.readiness === null ? null : (
          <>
            <dt>Readiness</dt>
            <dd>
              {review.readiness.ready ? "Ready" : "Not ready"}
              {review.readiness.scores.length === 0
                ? ""
                : ` · ${review.readiness.scores
                    .map(
                      (score) =>
                        `${score.dimension} ${Math.round(score.score * 100)}% (needs ${Math.round(score.threshold * 100)}%)`,
                    )
                    .join(", ")}`}
            </dd>
          </>
        )}
        {review.candidateDirection === null ? null : (
          <>
            <dt>Your direction</dt>
            <dd>{review.candidateDirection}</dd>
          </>
        )}
      </dl>
      {review.approvalCheck === null || review.approvalCheck.blockers.length === 0 ? null : (
        <div className="notice">
          <strong>Before approval</strong>
          <ul>
            {review.approvalCheck.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

interface DraftBlockProps {
  readonly view: BlockView;
  readonly open: boolean;
  readonly busy: boolean;
  readonly onEdit: (blockId: string, text: string) => Promise<boolean>;
}

export function DraftBlock({ view, open, busy, onEdit }: DraftBlockProps) {
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const { block, claims } = view;

  return (
    <div className="block">
      {editing === undefined ? (
        <p className={`paper block-${block.type}`}>
          {block.text}
          {block.edited ? <span className="muted"> · edited by you</span> : null}
        </p>
      ) : (
        <>
          <textarea
            aria-label="Block text"
            className="short"
            value={editing}
            onChange={(event) => setEditing(event.target.value)}
          />
          <div className="actions">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void onEdit(block.id, editing).then((saved) => saved && setEditing(undefined))
              }
            >
              Save the block
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(undefined)}>
              Cancel
            </button>
          </div>
        </>
      )}
      {claims.length === 0 ? null : (
        <details className="evidence">
          <summary>
            Evidence for {claims.length === 1 ? "1 claim" : `${claims.length} claims`}
          </summary>
          {claims.map((claim) => (
            <div key={claim.id} className="claim">
              <p>
                <strong>{claim.text}</strong> <span className="muted">{claim.status}</span>
              </p>
              {claim.evidence.length === 0 ? (
                <p className="notice">No evidence links this claim to your sources.</p>
              ) : (
                <ul>
                  {claim.evidence.map((item) => (
                    <li key={`${item.sourcePath}-${item.locator ?? ""}-${item.excerpt}`}>
                      <blockquote>{item.excerpt}</blockquote>
                      <span className="muted">
                        {item.sourcePath}
                        {item.locator === undefined ? "" : `, ${item.locator}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </details>
      )}
      {open && editing === undefined ? (
        <button type="button" className="secondary small" onClick={() => setEditing(block.text)}>
          Edit
        </button>
      ) : null}
    </div>
  );
}

interface FindingCardProps {
  readonly finding: Finding;
  readonly open: boolean;
  readonly busy: boolean;
  readonly onDecide: ReviewPanelProps["onDecide"];
}

export function FindingCard({ finding, open, busy, onDecide }: FindingCardProps) {
  const [rationale, setRationale] = useState("");
  return (
    <article className={`finding finding-${finding.severity}`}>
      <p>
        <span className={`severity severity-${finding.severity}`}>{finding.severity}</span>{" "}
        {finding.message}
      </p>
      {finding.requirement?.text === undefined ? null : (
        <p className="muted">Requirement: {finding.requirement.text}</p>
      )}
      <p className="muted">Decision: {decisionLabel(finding.decision)}</p>
      {open ? (
        <>
          <input
            aria-label="Reason, required to override"
            placeholder="Reason (required to override)"
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
          />
          <div className="actions">
            {decisionChoices.map((choice) => (
              <button
                key={choice.decision}
                type="button"
                className={finding.decision === choice.decision ? undefined : "secondary"}
                title={choice.effect}
                disabled={busy}
                onClick={() => void onDecide(finding.id, choice.decision, rationale)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </article>
  );
}
