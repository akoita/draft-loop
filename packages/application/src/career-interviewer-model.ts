import type { ModelSelection } from "@draft-loop/domain";
import type {
  CareerInterviewConversationTopic,
  CareerInterviewerPort,
  CareerInterviewerRequest,
} from "@draft-loop/orchestrator";
import type {
  DataExposurePolicy,
  JsonObject,
  JsonValue,
  ModelRequest,
  ModelResponse,
} from "@draft-loop/providers";

import type { CareerInterviewFact } from "./career-interview-topics.js";

/**
 * The guided career interview's model adapter (#2176): it phrases the interviewer's turns through
 * any provider adapter's `execute`, with no SDK here. The default model is Claude Sonnet, Claude
 * Haiku the economy option; the host picks and records the selection. Only the bounded topic
 * context built by `careerInterviewTopicContext` reaches the provider.
 */

/** The interview's default and economy models; the host maps them to a route. */
export const careerInterviewDefaultModelId = "claude-sonnet-5-5";
export const careerInterviewEconomyModelId = "claude-haiku-5-5";
export const careerInterviewPromptVersion = "career-interview-v2";

/** The most record entries one topic sends, and the longest any of them may be. */
export const maximumCareerInterviewContextEntries = 12;
const maximumContextEntryCharacters = 300;

/**
 * The record entries a topic may send to the provider: the facts it read, minus any the host's
 * sensitivity rules withhold (never-share always, sensitive without consent), bounded in count
 * and length.
 */
export function careerInterviewTopicContext(
  topic: { readonly kind: string; readonly reason: string; readonly factIds: readonly string[] },
  facts: readonly CareerInterviewFact[],
  mayTransmit: (fact: CareerInterviewFact) => boolean,
): CareerInterviewConversationTopic {
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const context = topic.factIds
    .map((id) => byId.get(id))
    .filter((fact): fact is CareerInterviewFact => fact !== undefined && mayTransmit(fact))
    .slice(0, maximumCareerInterviewContextEntries)
    .map((fact) =>
      `${fact.category} ${fact.field}: ${fact.value}`.slice(0, maximumContextEntryCharacters),
    );
  return { kind: topic.kind, reason: topic.reason, context };
}

const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "summary"],
  properties: {
    text: {
      type: "string",
      description:
        "The interviewer's next turn: one open question, or, when closing, a request to confirm the summary.",
    },
    summary: {
      type: "string",
      description:
        "Empty unless closing: the topic's story in the candidate's own terms, with no detail they did not give.",
    },
  },
} as const satisfies JsonObject;

const callInstructions =
  "Write the interviewer's next turn for the topic below. When `closing` is true, write a short summary of what the candidate said and ask them to confirm it; otherwise leave `summary` empty and ask exactly one question. When `refused_rules` is not empty, your previous turn broke those rules: avoid them.";

/** Anything that executes a structured model request, such as a provider or routed adapter. */
export interface CareerInterviewModelExecutor {
  execute(request: ModelRequest<JsonValue>): Promise<ModelResponse<JsonValue>>;
}

export interface CareerInterviewerModelOptions {
  readonly executor: CareerInterviewModelExecutor;
  readonly model: ModelSelection;
  readonly dataPolicy: DataExposurePolicy;
  /** The session id, recorded as the request's context identity. */
  readonly sessionId: string;
  readonly signal?: AbortSignal;
}

function inputOf(request: CareerInterviewerRequest): JsonObject {
  return {
    topic: {
      kind: request.topic.kind,
      reason: request.topic.reason,
      record: [...request.topic.context],
    },
    target_job_themes: [...request.targetThemes],
    conversation: request.turns.map((turn) => ({
      role: turn.role,
      text:
        turn.mark === "skipped"
          ? "(skipped)"
          : turn.mark === "unknown"
            ? "(I don't remember)"
            : turn.text,
    })),
    closing: request.closing,
    refused_rules: [...request.refusedRules],
  };
}

export function createModelCareerInterviewer(
  options: CareerInterviewerModelOptions,
): CareerInterviewerPort {
  return {
    reply: async (request) => {
      const response = await options.executor.execute({
        contextSnapshotId: options.sessionId,
        model: options.model,
        systemPrompt: [...request.instructions, callInstructions].join("\n"),
        input: inputOf(request),
        outputSchema,
        outputName: "career_interview_turn",
        maxOutputTokens: 1_024,
        dataPolicy: options.dataPolicy,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      const output = response.output as { readonly text?: unknown; readonly summary?: unknown };
      const text = typeof output.text === "string" ? output.text : "";
      const summary = typeof output.summary === "string" ? output.summary.trim() : "";
      return {
        text,
        ...(summary === "" ? {} : { summary }),
        model: { provider: response.company, model: response.modelId },
      };
    },
  };
}
