import type { RetrievalBenchmarkCase } from "./index.js";

/** A language of the evidence or of the job, as an ISO 639-1 code. */
export type EvaluationLanguage = "en" | "fr";

/**
 * Bilingual retrieval fixture: every chunk and every job requirement exists in English and in
 * French with the same meaning, so all language pairs share one ground truth.
 */
export interface CrossLanguageRetrievalFixture {
  readonly corpus: readonly ({ readonly id: string } & Record<EvaluationLanguage, string>)[];
  readonly cases: readonly ({
    readonly id: string;
    readonly groundTruthEvidenceIds: readonly string[];
  } & Record<EvaluationLanguage, string>)[];
}

export interface LanguagePair {
  readonly id: string;
  readonly evidence: EvaluationLanguage;
  readonly job: EvaluationLanguage;
  /** The same-language pair this pair is measured against; itself for a same-language pair. */
  readonly baseline: string;
}

/** Same-language baselines first, then the cross-language pair that shares each evidence language. */
export const languagePairs: readonly LanguagePair[] = [
  { id: "en-evidence-en-job", evidence: "en", job: "en", baseline: "en-evidence-en-job" },
  { id: "fr-evidence-fr-job", evidence: "fr", job: "fr", baseline: "fr-evidence-fr-job" },
  { id: "fr-evidence-en-job", evidence: "fr", job: "en", baseline: "fr-evidence-fr-job" },
  { id: "en-evidence-fr-job", evidence: "en", job: "fr", baseline: "en-evidence-en-job" },
];

/**
 * The largest recall drop a cross-language pair may show against its same-language baseline in the
 * same retrieval mode before light stemming or another lexical change is worth filing.
 */
export const crossLanguageRecallMargin = 0.1;

export interface LanguagePairCorpusEntry {
  readonly id: string;
  readonly text: string;
  readonly ordinal: number;
}

/** The evidence chunks in the pair's evidence language, in fixture order. */
export function languagePairCorpus(
  fixture: CrossLanguageRetrievalFixture,
  pair: LanguagePair,
): readonly LanguagePairCorpusEntry[] {
  return fixture.corpus.map((entry, ordinal) => ({
    id: entry.id,
    text: entry[pair.evidence],
    ordinal,
  }));
}

/** Benchmark cases whose queries are the job requirements in the pair's job language. */
export function languagePairCases(
  fixture: CrossLanguageRetrievalFixture,
  pair: LanguagePair,
): readonly Omit<RetrievalBenchmarkCase, "corpus">[] {
  return fixture.cases.map((benchmarkCase) => ({
    id: benchmarkCase.id,
    query: benchmarkCase[pair.job],
    groundTruthEvidenceIds: benchmarkCase.groundTruthEvidenceIds,
    requirements: [{ id: `${benchmarkCase.id}-requirement`, text: benchmarkCase[pair.job] }],
  }));
}

export interface LanguagePairRecall {
  readonly pair: string;
  readonly mode: string;
  readonly recall: number;
  readonly baselineRecall: number;
  /** Baseline recall minus this pair's recall; zero for a same-language pair. */
  readonly drop: number;
  readonly withinMargin: boolean;
}

/** Compares each pair's recall with its same-language baseline in the same mode. */
export function compareWithSameLanguage(
  recallByPairAndMode: ReadonlyMap<string, ReadonlyMap<string, number>>,
): readonly LanguagePairRecall[] {
  const rows: LanguagePairRecall[] = [];
  for (const pair of languagePairs) {
    const modes = recallByPairAndMode.get(pair.id);
    const baselineModes = recallByPairAndMode.get(pair.baseline);
    if (modes === undefined || baselineModes === undefined) {
      continue;
    }
    for (const [mode, recall] of modes) {
      const baselineRecall = baselineModes.get(mode);
      if (baselineRecall === undefined) {
        continue;
      }
      const drop = baselineRecall - recall;
      rows.push({
        pair: pair.id,
        mode,
        recall,
        baselineRecall,
        drop,
        withinMargin: drop <= crossLanguageRecallMargin + Number.EPSILON,
      });
    }
  }
  return rows;
}
