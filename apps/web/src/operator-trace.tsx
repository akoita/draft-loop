import { t } from "@lingui/core/macro";
import { type FormEvent, useEffect, useId, useState } from "react";

import type { ApiClient, ApiSchemas } from "./api-client.js";
import { ApiRequestError } from "./api-client.js";

export type OperatorRunTrace = ApiSchemas["OperatorRunTrace"];
type Span = OperatorRunTrace["spans"][number];

type TraceState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly trace: OperatorRunTrace };

/** Reads one member's run trace by organisation and run id (#3111). */
export async function readRunTrace(
  client: ApiClient,
  organisationId: string,
  runId: string,
): Promise<TraceState> {
  try {
    const trace = await client.call(
      "GET /v1/operator/organisations/{organisationId}/runs/{runId}/trace",
      { path: { organisationId, runId } },
    );
    return { kind: "ready", trace };
  } catch (error) {
    if (error instanceof ApiRequestError && error.code === "trace_not_found") {
      return { kind: "failed", message: t`No trace for that run in that organisation.` };
    }
    return { kind: "failed", message: t`The trace could not be read. Try again.` };
  }
}

/** Each span with its depth in the tree, parents first, children in start order. */
export function spanRows(spans: readonly Span[]): { span: Span; depth: number }[] {
  const ids = new Set(spans.map((span) => span.span_id));
  const children = new Map<string | null, Span[]>();
  for (const span of spans) {
    const parent =
      span.parent_span_id !== null && ids.has(span.parent_span_id) ? span.parent_span_id : null;
    children.set(parent, [...(children.get(parent) ?? []), span]);
  }
  const rows: { span: Span; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const span of children.get(parent) ?? []) {
      if (seen.has(span.span_id)) continue;
      seen.add(span.span_id);
      rows.push({ span, depth });
      walk(span.span_id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

function seconds(span: Span): string {
  if (span.ended_at === null) return t`did not finish`;
  const ms = Date.parse(span.ended_at) - Date.parse(span.started_at);
  const duration = (ms / 1000).toFixed(1);
  return Number.isFinite(ms) ? t`${duration} s` : "";
}

type Attributes = Readonly<Record<string, string | number | boolean | undefined>>;

function spanLabel(span: Span): string {
  const attributes = span.attributes as Attributes;
  const step = attributes["draftloop.step"];
  const attempt = attributes["draftloop.attempt"];
  const base = typeof step === "string" ? `${span.name} · ${step}` : span.name;
  return typeof attempt === "number" ? `${base} #${attempt}` : base;
}

function spanDetail(span: Span): string {
  const a = span.attributes as Attributes;
  const usd = a["draftloop.estimated_usd"];
  const inputTokens = a["gen_ai.usage.input_tokens"];
  const inputCount = String(inputTokens);
  const outputTokens = String(a["gen_ai.usage.output_tokens"] ?? 0);
  const parts = [
    a["gen_ai.provider.name"],
    a["gen_ai.request.model"],
    inputTokens === undefined ? undefined : t`${inputCount} in / ${outputTokens} out`,
    typeof usd === "number" ? `US$${usd.toFixed(4)}` : undefined,
    a["error.type"],
    a["draftloop.failure_reason"],
  ];
  return parts.filter((part) => part !== undefined && part !== "").join(" · ");
}

/** One trace: the workspace, the request id and each step, nested under the step it ran in. */
export function RunTraceResult({ trace }: { readonly trace: OperatorRunTrace }) {
  const workspaceId = trace.workspace_id;
  const requestId = trace.request_id ?? "";
  return (
    <>
      <p>
        {t`Workspace ${workspaceId}.`}{" "}
        {requestId === "" ? t`No request id recorded.` : t`Request id ${requestId}.`}
      </p>
      <ol className="operator-trace" aria-label={t`Run steps`}>
        {spanRows(trace.spans).map(({ span, depth }) => (
          <li
            key={span.span_id}
            className={span.status === "error" ? "operator-trace-error" : undefined}
            style={{ paddingInlineStart: `${depth * 1.25}rem` }}
          >
            <strong>{spanLabel(span)}</strong>{" "}
            <span>
              {span.status === "error" ? t`failed` : span.status === "ok" ? t`ok` : t`open`}
            </span>{" "}
            <span className="muted">
              {seconds(span)}
              {spanDetail(span) === "" ? "" : ` · ${spanDetail(span)}`}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

/** A run to trace, as a feedback note names it (#3134). */
export interface RunTraceTarget {
  readonly organisationId: string;
  readonly runId: string;
}

/**
 * The operator's run trace: an organisation and run id in, the run's steps as a timeline out. A
 * target, as from a feedback note's View trace, fills both fields and reads the trace at once.
 */
export function RunTraceSection({
  client,
  target,
}: {
  readonly client: ApiClient;
  readonly target?: RunTraceTarget | undefined;
}) {
  const organisationField = useId();
  const organisationHint = useId();
  const runField = useId();
  const [organisationId, setOrganisationId] = useState(target?.organisationId ?? "");
  const [runId, setRunId] = useState(target?.runId ?? "");
  const [state, setState] = useState<TraceState>({ kind: "idle" });

  useEffect(() => {
    if (target === undefined) return;
    let current = true;
    setOrganisationId(target.organisationId);
    setRunId(target.runId);
    setState({ kind: "loading" });
    void readRunTrace(client, target.organisationId, target.runId).then((next) => {
      if (current) setState(next);
    });
    return () => {
      current = false;
    };
  }, [client, target]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (organisationId.trim() === "" || runId.trim() === "") return;
    setState({ kind: "loading" });
    setState(await readRunTrace(client, organisationId.trim(), runId.trim()));
  };

  return (
    <section className="panel operator-section" aria-labelledby="operator-trace">
      <h2 id="operator-trace">{t`Run trace`}</h2>
      <p className="muted">
        {t`Open a run from its feedback note with View the run's trace, or type the ids from the note's context. Steps, models, errors, tokens and cost only: never what the member wrote. Each read is written to the audit log.`}
      </p>
      <form className="operator-trace-form" onSubmit={(event) => void submit(event)}>
        <label htmlFor={organisationField}>{t`Organisation id`}</label>
        <input
          id={organisationField}
          type="text"
          aria-describedby={organisationHint}
          value={organisationId}
          onChange={(event) => setOrganisationId(event.target.value)}
          autoComplete="off"
        />
        <p id={organisationHint} className="muted">
          {t`The member's account space. Each feedback note shows it under Context, as Organisation.`}
        </p>
        <label htmlFor={runField}>{t`Run id`}</label>
        <input
          id={runField}
          type="text"
          value={runId}
          onChange={(event) => setRunId(event.target.value)}
          autoComplete="off"
        />
        <button type="submit" disabled={state.kind === "loading"}>
          {state.kind === "loading" ? t`Reading…` : t`Read trace`}
        </button>
      </form>
      {state.kind === "failed" ? (
        <p className="problem" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.kind === "ready" ? <RunTraceResult trace={state.trace} /> : null}
    </section>
  );
}
