/**
 * The parts of an interview preparation guide computed without a model (#2618): which job
 * requirements the candidate's facts support, which are gaps to defend, and what never to say.
 * The writer receives the matrix and the gaps as data, so a model never decides on its own that
 * the candidate has an experience; a gap stays a gap unless the candidate's facts say otherwise.
 * Never-said facts and the candidate's own never-say list stay on the server: the guide lists
 * them for the candidate, and the check drops any written sentence that comes close to one.
 */

import {
  type CanonicalCandidateProfileFactCategory,
  canonicalCandidateProfileFactCategories,
} from "@draft-loop/domain";
import {
  type FactUsageSettings,
  factUsageAllows,
  resolveFactUsage,
} from "@draft-loop/domain/fact-usage";

import {
  type ApplicationMaterialFact,
  type ApplicationMaterialRequirement,
  applicationMaterialFactText,
  applicationMaterialMatchWords,
  withheldApplicationMaterialCategories,
} from "./application-material.js";

/** How many supporting facts one requirement lists, the strongest first. */
export const maximumInterviewGuideSupportingFacts = 3;
/** How many gaps a guide defends: three for an essential guide, more for an extensive one. */
export const interviewGuideDefenseLines = { essential: 3, extensive: 6 } as const;

export interface InterviewGuideMatrixRow {
  readonly requirementId: string;
  readonly requirement: string;
  readonly priority: ApplicationMaterialRequirement["priority"];
  /** The allowed facts that share the requirement's words, the strongest first; empty for a gap. */
  readonly factIds: readonly string[];
}

export interface InterviewGuideMatrix {
  readonly rows: readonly InterviewGuideMatrixRow[];
  /** The rows no fact supports, by priority: the weak points the guide prepares a defense for. */
  readonly gaps: readonly InterviewGuideMatrixRow[];
}

const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 } as const;

/** How many words a fact shares with a requirement, or 0 when that is too few to count. */
function support(required: ReadonlySet<string>, fact: ReadonlySet<string>): number {
  let shared = 0;
  for (const word of fact) if (required.has(word)) shared += 1;
  // A long requirement needs two shared words; a one- or two-word one, such as a tool, needs one.
  return shared >= 2 || (shared === 1 && required.size <= 2) ? shared : 0;
}

/**
 * Matches each requirement to the facts that share its words. The facts must already be the
 * ones allowed for interview preparation: the matrix never widens what the writer may cite.
 */
export function interviewGuideMatrix(
  requirements: readonly ApplicationMaterialRequirement[],
  allowedFacts: readonly ApplicationMaterialFact[],
): InterviewGuideMatrix {
  const factWords = allowedFacts.map((fact) => ({
    id: fact.id,
    words: applicationMaterialMatchWords(`${fact.field} ${fact.value}`),
  }));
  const rows = [...requirements]
    .map((requirement, index) => ({ requirement, index }))
    .sort(
      (left, right) =>
        priorityOrder[left.requirement.priority] - priorityOrder[right.requirement.priority] ||
        left.index - right.index,
    )
    .map(({ requirement }) => {
      const required = applicationMaterialMatchWords(requirement.text);
      const factIds = factWords
        .map((fact, index) => ({ id: fact.id, index, score: support(required, fact.words) }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .slice(0, maximumInterviewGuideSupportingFacts)
        .map((entry) => entry.id);
      return {
        requirementId: requirement.id,
        requirement: requirement.text,
        priority: requirement.priority,
        factIds,
      };
    });
  return { rows, gaps: rows.filter((row) => row.factIds.length === 0) };
}

/**
 * The record's facts as a guide uses them: the ones allowed for interview preparation, which the
 * writer may cite, and the ones marked never said, which only the never-say section lists. A fact
 * the sensitivity rules withhold, or an identity or contact fact, is in neither.
 */
export function interviewGuideFacts(
  facts: readonly ApplicationMaterialFact[],
  options: {
    readonly usage?: FactUsageSettings | undefined;
    readonly mayTransmit?: ((fact: ApplicationMaterialFact) => boolean) | undefined;
  } = {},
): { readonly allowed: ApplicationMaterialFact[]; readonly neverSaid: ApplicationMaterialFact[] } {
  const allowed: ApplicationMaterialFact[] = [];
  const neverSaid: ApplicationMaterialFact[] = [];
  for (const fact of facts) {
    if (withheldApplicationMaterialCategories.has(fact.category)) continue;
    const canonical = (canonicalCandidateProfileFactCategories as readonly string[]).includes(
      fact.category,
    );
    const level =
      options.usage === undefined || !canonical
        ? "cv"
        : resolveFactUsage(options.usage, {
            category: fact.category as CanonicalCandidateProfileFactCategory,
            field: fact.field,
            value: fact.value,
          });
    if (level === "never-say") {
      neverSaid.push(fact);
      continue;
    }
    if (!factUsageAllows(level, "interview")) continue;
    if (options.mayTransmit !== undefined && !options.mayTransmit(fact)) continue;
    allowed.push(fact);
  }
  return { allowed, neverSaid };
}

/** One entry of the guide's never-say section, as the candidate will read it. */
export interface InterviewGuideNeverSayEntry {
  readonly text: string;
  /** `fact` for a fact the candidate marked never said; `own` for their own list. */
  readonly source: "fact" | "own";
}

/** The never-say section: never-said facts, then the candidate's own entries, without repeats. */
export function interviewGuideNeverSay(
  neverSaidFacts: readonly ApplicationMaterialFact[],
  ownEntries: readonly string[] = [],
): InterviewGuideNeverSayEntry[] {
  const seen = new Set<string>();
  const entries: InterviewGuideNeverSayEntry[] = [];
  const add = (text: string, source: InterviewGuideNeverSayEntry["source"]) => {
    const trimmed = text.trim();
    const key = trimmed.toLowerCase();
    if (trimmed === "" || seen.has(key)) return;
    seen.add(key);
    entries.push({ text: trimmed, source });
  };
  for (const fact of neverSaidFacts) add(applicationMaterialFactText(fact), "fact");
  for (const entry of ownEntries) add(entry, "own");
  return entries;
}

/**
 * Whether a written sentence comes close to a never-say entry: it holds most of the entry's
 * telling words (all of them for an entry of one or two). Such a sentence is dropped from the
 * guide, whatever it cites.
 */
export function touchesNeverSay(
  sentence: string,
  entries: readonly Pick<InterviewGuideNeverSayEntry, "text">[],
): boolean {
  const words = applicationMaterialMatchWords(sentence);
  return entries.some((entry) => {
    const telling = applicationMaterialMatchWords(entry.text);
    if (telling.size === 0) return false;
    let shared = 0;
    for (const word of telling) if (words.has(word)) shared += 1;
    return telling.size <= 2 ? shared === telling.size : shared / telling.size >= 0.6;
  });
}
