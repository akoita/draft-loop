import { z } from "zod";

import {
  type DecisionAnswer,
  DecisionModelError,
  type DecisionQuestion,
  type DecisionRequest,
} from "./decision-model.js";
import type { ParsedDecisionResponse } from "./systemone-wire.js";

/**
 * The OpenAI Decisions API wire format (`POST /v1/decisions`): `input` holds the input, and
 * `questions` is an array of named questions. A choice lists `choices` of `{ value, description }`
 * and a score lists `levels` of `{ label, description }`. Answers come back in an array, each
 * carrying its question's name; a declined question comes back as a `refusal`.
 */

type OpenAIDecisionQuestion =
  | { readonly type: "predicate"; readonly name: string; readonly instructions: string }
  | {
      readonly type: "choice";
      readonly name: string;
      readonly instructions: string;
      readonly choices: readonly { readonly value: string; readonly description?: string }[];
    }
  | {
      readonly type: "score";
      readonly name: string;
      readonly instructions: string;
      readonly levels: readonly { readonly label: string }[];
    };

export function openAIDecisionsRequestBody(
  model: string,
  request: DecisionRequest,
): { model: string; input: string; questions: OpenAIDecisionQuestion[] } {
  // The API takes text or messages; a JSON input goes as JSON text, as the SDKs send it.
  const input = typeof request.input === "string" ? request.input : JSON.stringify(request.input);
  return { model, input, questions: request.questions.map(openAIQuestion) };
}

function openAIQuestion(question: DecisionQuestion): OpenAIDecisionQuestion {
  switch (question.kind) {
    case "predicate":
      return { type: "predicate", name: question.name, instructions: question.instructions };
    case "choice":
      return {
        type: "choice",
        name: question.name,
        instructions: question.instructions,
        choices: Object.entries(question.options).map(([value, description]) =>
          description === null ? { value } : { value, description },
        ),
      };
    case "score":
      return {
        type: "score",
        name: question.name,
        instructions: question.instructions,
        levels: question.levels.map((label) => ({ label })),
      };
  }
}

const probability = z.number();
const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("predicate"), name: z.string(), probability }),
  z.object({
    type: z.literal("choice"),
    name: z.string(),
    choice: z.string(),
    probabilities: z.array(z.object({ value: z.string(), probability })),
    confidence: probability,
  }),
  z.object({
    type: z.literal("score"),
    name: z.string(),
    score: z.number(),
    probabilities: z.array(z.object({ label: z.string(), probability })),
    confidence: probability,
  }),
  z.object({ type: z.literal("refusal"), name: z.string() }),
]);

const responseSchema = z.object({
  model: z.string().min(1),
  answers: z.array(answerSchema),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});

export function parseOpenAIDecisionsResponse(
  questions: readonly DecisionQuestion[],
  json: unknown,
  requestId: string | null,
): ParsedDecisionResponse {
  const invalid = (): DecisionModelError =>
    new DecisionModelError(
      "openai-decisions",
      "invalid-response",
      "The decision response does not match its schema.",
      {
        requestId,
      },
    );
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) throw invalid();
  const levelsByName = new Map(
    questions.flatMap((question) =>
      question.kind === "score" ? [[question.name, question.levels]] : [],
    ),
  );
  const answers: Record<string, DecisionAnswer> = {};
  for (const answer of parsed.data.answers) {
    const name = answer.name;
    if (Object.hasOwn(answers, name)) throw invalid();
    switch (answer.type) {
      case "predicate":
        answers[name] = { kind: "predicate", name, probability: answer.probability };
        break;
      case "choice":
        answers[name] = {
          kind: "choice",
          name,
          choice: answer.choice,
          probabilities: Object.fromEntries(
            answer.probabilities.map((entry) => [entry.value, entry.probability]),
          ),
          confidence: answer.confidence,
        };
        break;
      case "score": {
        const levels = levelsByName.get(name);
        if (levels === undefined) throw invalid();
        const byLevel = levels.map(() => 0);
        for (const entry of answer.probabilities) {
          const index = levels.indexOf(entry.label);
          if (index < 0) throw invalid();
          byLevel[index] = entry.probability;
        }
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
