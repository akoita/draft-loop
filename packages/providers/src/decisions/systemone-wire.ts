import { z } from "zod";

import {
  type DecisionAnswer,
  DecisionModelError,
  type DecisionQuestion,
  type DecisionRequest,
  type DecisionUsage,
  type DecisionVendor,
} from "./decision-model.js";

/**
 * The "System One" wire format that Jev (TypeSafe) defines and Microsoft Decision 1 on Foundry
 * also speaks: `state` holds the input, `questions` is an object keyed by question name, a
 * predicate is a `noul` question, a choice maps option names to descriptions in `criteria`, and a
 * score lists its level labels in `criteria`. Answers come back keyed by the same names.
 */

type SystemOneQuestion =
  | { readonly type: "noul"; readonly instructions: string }
  | {
      readonly type: "choice";
      readonly instructions: string;
      readonly criteria: Readonly<Record<string, string | null>>;
    }
  | { readonly type: "score"; readonly instructions: string; readonly criteria: readonly string[] };

export function systemOneRequestBody(
  model: string,
  request: DecisionRequest,
): {
  model: string;
  state: DecisionRequest["input"];
  questions: Record<string, SystemOneQuestion>;
} {
  const questions: Record<string, SystemOneQuestion> = {};
  for (const question of request.questions) {
    questions[question.name] = systemOneQuestion(question);
  }
  return { model, state: request.input, questions };
}

function systemOneQuestion(question: DecisionQuestion): SystemOneQuestion {
  switch (question.kind) {
    case "predicate":
      return { type: "noul", instructions: question.instructions };
    case "choice":
      return { type: "choice", instructions: question.instructions, criteria: question.options };
    case "score":
      return { type: "score", instructions: question.instructions, criteria: question.levels };
  }
}

const probability = z.number();
const systemOneAnswerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: probability }),
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    probabilities: z.record(z.string(), probability),
    confidence: probability,
  }),
  z.object({
    type: z.literal("score"),
    score: z.number(),
    probabilities: z.record(z.string(), probability),
    confidence: probability,
  }),
  z.object({ type: z.literal("refusal") }),
]);

const systemOneResponseSchema = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), systemOneAnswerSchema),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});

export interface ParsedDecisionResponse {
  readonly model: string;
  readonly answers: Record<string, DecisionAnswer>;
  readonly usage: DecisionUsage | null;
}

export function parseSystemOneResponse(
  vendor: DecisionVendor,
  questions: readonly DecisionQuestion[],
  json: unknown,
  requestId: string | null,
): ParsedDecisionResponse {
  const invalid = (): DecisionModelError =>
    new DecisionModelError(
      vendor,
      "invalid-response",
      "The decision response does not match its schema.",
      {
        requestId,
      },
    );
  const parsed = systemOneResponseSchema.safeParse(json);
  if (!parsed.success) throw invalid();
  const levelsByName = new Map(
    questions.flatMap((question) =>
      question.kind === "score" ? [[question.name, question.levels.length]] : [],
    ),
  );
  const answers: Record<string, DecisionAnswer> = {};
  for (const [name, answer] of Object.entries(parsed.data.answers)) {
    switch (answer.type) {
      case "noul":
        answers[name] = { kind: "predicate", name, probability: answer.noul };
        break;
      case "choice":
        answers[name] = {
          kind: "choice",
          name,
          choice: answer.choice,
          probabilities: answer.probabilities,
          confidence: answer.confidence,
        };
        break;
      case "score": {
        const levels = levelsByName.get(name);
        if (levels === undefined) throw invalid();
        const indexes = Object.keys(answer.probabilities);
        if (indexes.some((key) => !/^\d+$/.test(key) || Number(key) >= levels)) throw invalid();
        const byLevel = Array.from(
          { length: levels },
          (_, index) => answer.probabilities[String(index)] ?? 0,
        );
        answers[name] = {
          kind: "score",
          name,
          score: answer.score,
          probabilities: byLevel,
          confidence: answer.confidence,
        };
        break;
      }
      case "refusal":
        answers[name] = { kind: "refusal", name };
        break;
    }
  }
  const usage = parsed.data.usage;
  return {
    model: parsed.data.model,
    answers,
    usage:
      usage === undefined
        ? null
        : { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens },
  };
}
