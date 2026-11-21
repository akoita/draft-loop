/**
 * Run spans exported to Cloud Trace (#3238), beside the span store. The engine's tracer feeds the
 * recorder as before; this mirrors every span into OpenTelemetry under the GenAI convention names
 * the span store already uses, and sends them over OTLP to Google's telemetry endpoint. The same
 * content-free filter applies, so no prompt, completion or candidate text can leave, and nothing
 * here may fail a run. Off unless `DRAFT_LOOP_TRACE_EXPORT=cloud-trace`, so local and self-hosted
 * stacks are unchanged.
 */

import type { RunSpanRecorder } from "@draft-loop/application/run-span-recorder";
import { contentFreeSpanAttributes, type RunSpan, type RunTracer } from "@draft-loop/orchestrator";
import {
  type Context,
  context,
  ROOT_CONTEXT,
  type Span,
  SpanKind,
  SpanStatusCode,
  TraceFlags,
  type Tracer,
  trace,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { GoogleAuth } from "google-auth-library";

/** Google's OTLP endpoint for traces; it writes them to Cloud Trace in the caller's project. */
export const cloudTraceEndpoint = "https://telemetry.googleapis.com/v1/traces";

export interface TraceExportConfig {
  readonly projectId: string;
  readonly serviceName: string;
}

export interface TraceExport {
  /**
   * The recorder with every span mirrored into the exported trace; flushing also exports. With the
   * queuing request's `traceparent`, the run's spans continue that request's trace.
   */
  readonly wrap: (recorder: RunSpanRecorder, traceparent?: string) => RunSpanRecorder;
  /** Exports what is queued and stops; never rejects. */
  readonly shutdown: () => Promise<void>;
}

/** Reads the export's settings; `undefined` leaves export off. */
export function traceExportConfig(
  env: Readonly<Record<string, string | undefined>>,
): TraceExportConfig | undefined {
  const mode = env.DRAFT_LOOP_TRACE_EXPORT?.trim() ?? "";
  if (mode === "" || mode === "off") return undefined;
  if (mode !== "cloud-trace") {
    throw new Error("DRAFT_LOOP_TRACE_EXPORT must be cloud-trace or off.");
  }
  const projectId = env.DRAFT_LOOP_TRACE_PROJECT?.trim() ?? "";
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(projectId)) {
    throw new Error("DRAFT_LOOP_TRACE_PROJECT must name the Google Cloud project for Cloud Trace.");
  }
  const serviceName = env.OTEL_SERVICE_NAME?.trim() || "draft-loop-worker";
  return { projectId, serviceName };
}

/** Signs each export as the runtime's own service identity, for the project named. */
function googleHeaders(projectId: string): () => Promise<Record<string, string>> {
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  return async () => {
    const token = await auth.getAccessToken();
    return {
      ...(token === null || token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      "x-goog-user-project": projectId,
    };
  };
}

export function createTraceExport(
  config: TraceExportConfig,
  options: {
    readonly exporter?: SpanExporter;
    readonly onError?: (error: unknown) => void;
  } = {},
): TraceExport {
  const exporter =
    options.exporter ??
    new OTLPTraceExporter({ url: cloudTraceEndpoint, headers: googleHeaders(config.projectId) });
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      "service.name": config.serviceName,
      "gcp.project_id": config.projectId,
    }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
  const tracer = provider.getTracer("draft-loop-run");
  const quietly = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      try {
        options.onError?.(error);
      } catch {
        // A reporter that throws must not reach the run either.
      }
    }
  };
  return {
    wrap: (recorder, traceparent) => ({
      tracer: mirroredTracer(recorder.tracer, tracer, options.onError, remoteParent(traceparent)),
      flush: async () => {
        await recorder.flush();
        await quietly(() => provider.forceFlush());
      },
    }),
    shutdown: () => quietly(() => provider.shutdown()),
  };
}

const traceparentPattern = /^00-([\da-f]{32})-([\da-f]{16})-[\da-f]{2}$/u;

/**
 * The context of the queuing request's span, for the run's top spans to continue (#3238). It is
 * marked sampled whatever the request's flag says, because every run is exported; an absent or
 * malformed value starts a trace of its own.
 */
export function remoteParent(traceparent: string | undefined): Context | undefined {
  const match = traceparent === undefined ? null : traceparentPattern.exec(traceparent);
  if (match === null) return undefined;
  const [, traceId = "", spanId = ""] = match;
  if (/^0+$/u.test(traceId) || /^0+$/u.test(spanId)) return undefined;
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId,
    spanId,
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
  });
}

/**
 * A tracer that hands each span to `primary` and opens the same span in OpenTelemetry, with the
 * same parent. A failure on the OpenTelemetry side is reported once and never reaches the run.
 */
export function mirroredTracer(
  primary: RunTracer,
  otel: Tracer,
  onError?: (error: unknown) => void,
  rootParent?: Context,
): RunTracer {
  const pairs = new WeakMap<RunSpan, { readonly primary: RunSpan; readonly otel?: Span }>();
  let reported = false;
  const guard = <T>(work: () => T): T | undefined => {
    try {
      return work();
    } catch (error) {
      if (!reported) {
        reported = true;
        try {
          onError?.(error);
        } catch {
          // Ignored, as above.
        }
      }
      return undefined;
    }
  };
  return {
    startSpan: (name, attributes, parent) => {
      const parentPair = parent === undefined ? undefined : pairs.get(parent);
      const primarySpan = primary.startSpan(name, attributes, parentPair?.primary ?? parent);
      const otelSpan = guard(() => {
        const parentContext: Context =
          parentPair?.otel === undefined
            ? (rootParent ?? context.active())
            : trace.setSpan(context.active(), parentPair.otel);
        return otel.startSpan(
          name,
          { kind: SpanKind.INTERNAL, attributes: contentFreeSpanAttributes(attributes) },
          parentContext,
        );
      });
      const span: RunSpan = {
        setAttributes: (more) => {
          primarySpan.setAttributes(more);
          guard(() => otelSpan?.setAttributes(contentFreeSpanAttributes(more)));
        },
        end: (status) => {
          primarySpan.end(status);
          guard(() => {
            if (status === "error") otelSpan?.setStatus({ code: SpanStatusCode.ERROR });
            otelSpan?.end();
          });
        },
      };
      pairs.set(
        span,
        otelSpan === undefined
          ? { primary: primarySpan }
          : { primary: primarySpan, otel: otelSpan },
      );
      return span;
    },
  };
}
