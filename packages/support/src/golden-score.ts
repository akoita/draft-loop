import type { SupportReply } from "./assistant.js";
import type { SupportGoldenQuestion } from "./golden-set.js";

/**
 * How the paid check (#2884) grades one golden question. An answerable question passes when the
 * assistant answers and cites at least one expected section; a refusal question passes when the
 * assistant refuses. Guide search (the assistant fell back) and "needs a person" are not passes.
 */
export type SupportGoldenVerdict =
  | "answered_correctly"
  | "refused_correctly"
  | "wrong_source"
  | "should_have_refused"
  | "refused_answerable"
  | "needs_person"
  | "fell_back";

export interface SupportGoldenResult {
  readonly id: string;
  readonly verdict: SupportGoldenVerdict;
  readonly cited: readonly string[];
  readonly estimatedUsd: number;
}

export function gradeSupportGoldenReply(
  question: SupportGoldenQuestion,
  reply: SupportReply,
  estimatedUsd: number,
): SupportGoldenResult {
  const cited = reply.sections.map((section) => section.id);
  const result = (verdict: SupportGoldenVerdict) => ({
    id: question.id,
    verdict,
    cited,
    estimatedUsd,
  });
  if (reply.mode === "guide_search") return result("fell_back");
  if ("refuse" in question.expect) {
    return result(reply.outcome === "refused" ? "refused_correctly" : "should_have_refused");
  }
  if (reply.outcome === "refused") return result("refused_answerable");
  if (reply.outcome === "needs_person") return result("needs_person");
  const expected: readonly string[] = question.expect.sections;
  return result(cited.some((id) => expected.includes(id)) ? "answered_correctly" : "wrong_source");
}

export interface SupportGoldenSummary {
  readonly asked: number;
  readonly answerable: number;
  readonly refusals: number;
  readonly counts: Readonly<Record<SupportGoldenVerdict, number>>;
  readonly totalUsd: number;
  /** Mean cost of a reply the model gave, fallbacks left out; null when there was none. */
  readonly usdPerAnswer: number | null;
}

export function summarizeSupportGoldenRun(
  questions: readonly SupportGoldenQuestion[],
  results: readonly SupportGoldenResult[],
): SupportGoldenSummary {
  const counts: Record<SupportGoldenVerdict, number> = {
    answered_correctly: 0,
    refused_correctly: 0,
    wrong_source: 0,
    should_have_refused: 0,
    refused_answerable: 0,
    needs_person: 0,
    fell_back: 0,
  };
  for (const result of results) counts[result.verdict] += 1;
  const asked = new Set(results.map((result) => result.id));
  const askedQuestions = questions.filter((question) => asked.has(question.id));
  const refusals = askedQuestions.filter((question) => "refuse" in question.expect).length;
  const totalUsd = results.reduce((sum, result) => sum + result.estimatedUsd, 0);
  const modelReplies = results.length - counts.fell_back;
  return {
    asked: results.length,
    answerable: askedQuestions.length - refusals,
    refusals,
    counts,
    totalUsd,
    usdPerAnswer: modelReplies === 0 ? null : totalUsd / modelReplies,
  };
}
