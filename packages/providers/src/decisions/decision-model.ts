import type { ProviderErrorCode } from "../index.js";

/**
 * The decision model port: one provider-independent way to ask a fast judgment model small closed
 * questions about one input. A predicate answers with the probability that a statement holds, a
 * choice picks one option from a fixed set, and a score places the input on ordered levels. The
 * model writes no text, so the caller's code makes the decision from the answers.
 *
 * Vendors differ only in their wire format, behind `createDecisionModel`. Jev (TypeSafe) is the
 * default; the OpenAI Decisions API and Microsoft Decision 1 are the alternatives.
 */

export const decisionVendors = [
  "typesafe-jev",
  "openai-decisions",
  "microsoft-decision-1",
] as const;
export type DecisionVendor = (typeof decisionVendors)[number];

export const defaultDecisionVendor: DecisionVendor = "typesafe-jev";

/** The limits all three vendors document; a request outside them is refused before it is sent. */
export const decisionLimits = Object.freeze({
  maxQuestions: 400,
  minChoiceOptions: 2,
  maxChoiceOptions: 255,
  minScoreLevels: 2,
  maxScoreLevels: 10,
});

export type DecisionQuestion =
  | {
      readonly kind: "predicate";
      /** Unique within the request; the answer comes back under the same name. */
      readonly name: string;
      /** The statement whose probability the model gives. */
      readonly instructions: string;
    }
  | {
      readonly kind: "choice";
      readonly name: string;
      readonly instructions: string;
      /** Option value to an optional description of when it applies. */
      readonly options: Readonly<Record<string, string | null>>;
    }
  | {
      readonly kind: "score";
      readonly name: string;
      readonly instructions: string;
      /** Ordered level labels, lowest first; a level's index is its score. */
      readonly levels: readonly string[];
    };

export type DecisionAnswer =
  | { readonly kind: "predicate"; readonly name: string; readonly probability: number }
  | {
      readonly kind: "choice";
      readonly name: string;
      readonly choice: string;
      readonly probabilities: Readonly<Record<string, number>>;
      readonly confidence: number;
    }
  | {
      readonly kind: "score";
      readonly name: string;
      /** The probability-weighted level index, so it can fall between levels. */
      readonly score: number;
      /** Probability of each level, by level index. */
      readonly probabilities: readonly number[];
      readonly confidence: number;
    }
  | { readonly kind: "refusal"; readonly name: string };

/**
 * What a request may send, decided by the caller before the call. A vendor not listed, or
 * sensitive material without an explicit acknowledgement, is refused before anything is sent.
 */
export interface DecisionDataPolicy {
  readonly allowTransmission: boolean;
  readonly allowedVendors: readonly DecisionVendor[];
  readonly sensitiveData: boolean;
  readonly sensitiveDataAcknowledged: boolean;
}

export interface DecisionRequest {
  /** The shared input every question is about: text, or a JSON value sent as JSON. */
  readonly input: string | Readonly<Record<string, unknown>> | readonly unknown[];
  readonly questions: readonly DecisionQuestion[];
  readonly dataPolicy: DecisionDataPolicy;
  readonly signal?: AbortSignal;
}

export interface DecisionUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface DecisionResult {
  readonly vendor: DecisionVendor;
  /** The versioned model that answered, as the vendor reported it. */
  readonly model: string;
  /** One answer per question, keyed by question name. */
  readonly answers: Readonly<Record<string, DecisionAnswer>>;
  readonly usage: DecisionUsage | null;
  readonly requestId: string | null;
}

export interface DecisionModelIdentity {
  readonly vendor: DecisionVendor;
  /** The model or deployment the request names. */
  readonly model: string;
}

export interface DecisionModel {
  readonly identity: DecisionModelIdentity;
  decide(request: DecisionRequest): Promise<DecisionResult>;
}

/**
 * Every failure of a decision call. The message is fixed text per code: it never carries the
 * input, a question, or a vendor's response body, so it can be logged.
 */
export class DecisionModelError extends Error {
  readonly vendor: DecisionVendor;
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly status: number | null;
  readonly requestId: string | null;
  readonly retryAfterMs: number | null;

  constructor(
    vendor: DecisionVendor,
    code: ProviderErrorCode,
    message: string,
    options: {
      readonly retryable?: boolean;
      readonly status?: number | null;
      readonly requestId?: string | null;
      readonly retryAfterMs?: number | null;
    } = {},
  ) {
    super(message);
    this.name = "DecisionModelError";
    this.vendor = vendor;
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? null;
    this.requestId = options.requestId ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

/** Refuses a request the policy does not allow for this vendor. */
export function assertDecisionDataAllowed(
  vendor: DecisionVendor,
  policy: DecisionDataPolicy,
): void {
  if (!policy.allowTransmission) {
    throw new DecisionModelError(
      vendor,
      "policy",
      "Transmission is not approved for this request.",
    );
  }
  if (!policy.allowedVendors.includes(vendor)) {
    throw new DecisionModelError(
      vendor,
      "policy",
      "This decision vendor is not approved for this request.",
    );
  }
  if (policy.sensitiveData && !policy.sensitiveDataAcknowledged) {
    throw new DecisionModelError(
      vendor,
      "policy",
      "Sensitive material needs an explicit acknowledgement before it is sent.",
    );
  }
}

function invalidRequest(vendor: DecisionVendor, message: string): DecisionModelError {
  return new DecisionModelError(vendor, "invalid-request", message);
}

/** Checks the questions against the shared limits before any vendor sees them. */
export function assertDecisionQuestionsValid(
  vendor: DecisionVendor,
  questions: readonly DecisionQuestion[],
): void {
  if (questions.length < 1 || questions.length > decisionLimits.maxQuestions) {
    throw invalidRequest(
      vendor,
      `A decision request needs 1 to ${decisionLimits.maxQuestions} questions.`,
    );
  }
  const names = new Set<string>();
  for (const question of questions) {
    if (question.name.trim() === "" || names.has(question.name)) {
      throw invalidRequest(vendor, "Every decision question needs a unique, non-empty name.");
    }
    names.add(question.name);
    if (question.instructions.trim() === "") {
      throw invalidRequest(vendor, "Every decision question needs instructions.");
    }
    if (question.kind === "choice") {
      const count = Object.keys(question.options).length;
      if (count < decisionLimits.minChoiceOptions || count > decisionLimits.maxChoiceOptions) {
        throw invalidRequest(
          vendor,
          `A choice question needs ${decisionLimits.minChoiceOptions} to ${decisionLimits.maxChoiceOptions} options.`,
        );
      }
    }
    if (question.kind === "score") {
      const count = question.levels.length;
      if (count < decisionLimits.minScoreLevels || count > decisionLimits.maxScoreLevels) {
        throw invalidRequest(
          vendor,
          `A score question needs ${decisionLimits.minScoreLevels} to ${decisionLimits.maxScoreLevels} levels.`,
        );
      }
      if (new Set(question.levels).size !== count) {
        throw invalidRequest(vendor, "A score question's levels must be distinct.");
      }
    }
  }
}

function isProbability(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Checks that the vendor answered every question once, with the question's own kind, an option or
 * level the question offered, and probabilities between 0 and 1. A refusal counts as an answer.
 */
export function assertDecisionAnswersMatch(
  vendor: DecisionVendor,
  questions: readonly DecisionQuestion[],
  answers: Readonly<Record<string, DecisionAnswer>>,
  requestId: string | null,
): void {
  const invalid = (): DecisionModelError =>
    new DecisionModelError(
      vendor,
      "invalid-response",
      "The decision response does not match its questions.",
      {
        requestId,
      },
    );
  const asked = new Map(questions.map((question) => [question.name, question]));
  if (Object.keys(answers).length !== asked.size) throw invalid();
  for (const [name, answer] of Object.entries(answers)) {
    const question = asked.get(name);
    if (question === undefined || answer.name !== name) throw invalid();
    if (answer.kind === "refusal") continue;
    if (answer.kind !== question.kind) throw invalid();
    if (answer.kind === "predicate") {
      if (!isProbability(answer.probability)) throw invalid();
    } else if (answer.kind === "choice" && question.kind === "choice") {
      if (!Object.hasOwn(question.options, answer.choice) || !isProbability(answer.confidence))
        throw invalid();
      for (const [option, probability] of Object.entries(answer.probabilities)) {
        if (!Object.hasOwn(question.options, option) || !isProbability(probability))
          throw invalid();
      }
    } else if (answer.kind === "score" && question.kind === "score") {
      const top = question.levels.length - 1;
      if (!Number.isFinite(answer.score) || answer.score < 0 || answer.score > top) throw invalid();
      if (!isProbability(answer.confidence)) throw invalid();
      if (answer.probabilities.length !== question.levels.length) throw invalid();
      if (!answer.probabilities.every(isProbability)) throw invalid();
    }
  }
}
