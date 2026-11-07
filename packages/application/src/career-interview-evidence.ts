import type { SourceSensitivityTier } from "@draft-loop/domain/source-sensitivity";
import { careerInterviewPhrases } from "@draft-loop/orchestrator";
import type {
  CareerInterviewSession,
  CareerInterviewSessionTopic,
} from "@draft-loop/schemas/career-interview";

import type { CareerInterviewFact } from "./career-interview-topics.js";
import type {
  AddedHostedKnowledgeSource,
  HostedKnowledgeIntake,
} from "./hosted-knowledge-intake.js";
import type { HostedSensitivityRules } from "./hosted-sensitivity-rules.js";
import type { SourceSensitivityRuleInput } from "./source-sensitivity-service.js";

/**
 * A confirmed interview topic as career evidence (#2177): a Markdown knowledge source holding the
 * summary the candidate confirmed and their own words, speaker-labelled, so facts drawn from it
 * cite what the candidate said. Its evidence kind is `transcript`. The same topic always renders
 * the same bytes, so a second confirmation finds the source already present.
 */

export const careerInterviewSourceMediaType = "text/markdown";

/** Text placed in Markdown stays text: no heading, list or link syntax. */
function plain(value: string): string {
  return value.replace(/[\\`*_[\]<>#|]/gu, (character) => `\\${character}`);
}

/**
 * The topic as the file names it: its reason, which the server words in English; in another
 * language, its short title when it has one (#2420).
 */
function topicLabel(topic: CareerInterviewSessionTopic, language: string | undefined): string {
  const english = careerInterviewPhrases(language) === careerInterviewPhrases("en");
  const label = english || topic.title === undefined ? topic.reason : topic.title;
  return label
    .replace(/[\\`*_[\]<>#|]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 160);
}

/** The top heading; the session id and topic position keep it unique in the knowledge base. */
export function careerInterviewSourceHeading(
  session: Pick<CareerInterviewSession, "id">,
  topicIndex: number,
  language?: string,
): string {
  const phrases = careerInterviewPhrases(language);
  return `${phrases.evidence.title} ${session.id} ${phrases.evidence.topic.toLowerCase()} ${topicIndex + 1}`;
}

/** How a marked candidate turn reads in the transcript evidence. */
export const careerInterviewMarkLabels = {
  skipped: careerInterviewPhrases("en").evidence.skipped,
  unknown: careerInterviewPhrases("en").evidence.unknown,
} as const satisfies Record<
  NonNullable<CareerInterviewSessionTopic["turns"][number]["mark"]>,
  string
>;

export function renderCareerInterviewMarkdown(
  session: Pick<CareerInterviewSession, "id">,
  topicIndex: number,
  topic: CareerInterviewSessionTopic,
  language?: string,
): string {
  const { evidence } = careerInterviewPhrases(language);
  if (topic.summary === undefined) {
    throw new Error("Only a topic with a confirmed summary becomes evidence.");
  }
  const words = topic.turns.flatMap((turn) => {
    const speaker = turn.role === "candidate" ? evidence.candidate : evidence.interviewer;
    // A marked turn stays, labelled, so the next answer never reads as a reply to its question
    // (#2256). The label is fixed text: no candidate words are invented.
    if (turn.mark !== undefined) {
      return [`- ${speaker}: ${turn.mark === "skipped" ? evidence.skipped : evidence.unknown}`];
    }
    return turn.text === "" ? [] : [`- ${speaker}: ${plain(turn.text)}`];
  });
  const sections = [
    `# ${careerInterviewSourceHeading(session, topicIndex, language)}`,
    evidence.intro,
    `## ${evidence.topic}`,
    plain(topicLabel(topic, language)),
    `## ${evidence.summary}`,
    plain(topic.summary),
    `## ${evidence.conversation}`,
    words.length === 0 ? evidence.noWords : words.join("\n"),
  ];
  return `${sections.join("\n\n")}\n`;
}

export function renderCareerInterviewSource(
  session: Pick<CareerInterviewSession, "id">,
  topicIndex: number,
  topic: CareerInterviewSessionTopic,
  language?: string,
): { readonly displayName: string; readonly bytes: Uint8Array } {
  return {
    displayName: `career-interview-${session.id}-${topicIndex + 1}.md`,
    bytes: new TextEncoder().encode(
      renderCareerInterviewMarkdown(session, topicIndex, topic, language),
    ),
  };
}

export interface CareerInterviewSourceRule extends SourceSensitivityRuleInput {
  readonly id: string;
}

/** The whole topic at the confirmed tier when it is stricter than `normal`. */
export function careerInterviewSourceRules(
  session: Pick<CareerInterviewSession, "id">,
  topicIndex: number,
  tier: SourceSensitivityTier,
  language?: string,
): CareerInterviewSourceRule[] {
  if (tier === "normal") return [];
  return [
    {
      id: `ci-${session.id}-${topicIndex + 1}`,
      tier,
      match: {
        kind: "heading-path",
        path: [careerInterviewSourceHeading(session, topicIndex, language)],
      },
    },
  ];
}

export interface CareerInterviewPublishInput {
  readonly session: CareerInterviewSession;
  readonly topicIndex: number;
  readonly knowledgeBaseId: string;
  readonly tier: SourceSensitivityTier;
  /** The conversation's language, which the file's headings and labels follow (#2420). */
  readonly language?: string | undefined;
}

export interface CareerInterviewPublished {
  readonly sourceId: string;
  readonly status: "created" | "already-present";
}

export type CareerInterviewPublish = (
  input: CareerInterviewPublishInput,
) => Promise<CareerInterviewPublished>;

export interface CareerInterviewPublisherOptions {
  readonly intake: Pick<HostedKnowledgeIntake, "addFileSource">;
  readonly rules: Pick<HostedSensitivityRules, "list" | "add">;
  /** Sets the source's evidence kind, which detection does not pick for an interview. */
  readonly setEvidenceKind: (
    knowledgeBaseId: string,
    sourceId: string,
    kind: "transcript",
  ) => Promise<void>;
  /** Screens the stored source like an upload. */
  readonly screen?: (added: AddedHostedKnowledgeSource, bytes: Uint8Array) => Promise<void>;
}

/** What confirmation calls: writes the rules first, so the source is never readable without them. */
export function createCareerInterviewPublisher(
  options: CareerInterviewPublisherOptions,
): CareerInterviewPublish {
  return async ({ session, topicIndex, knowledgeBaseId, tier, language }) => {
    const topic = session.topics[topicIndex];
    if (topic === undefined) throw new Error("No such interview topic.");
    const existing = new Set(
      (await options.rules.list(knowledgeBaseId)).rules.map((rule) => rule.id),
    );
    for (const { id, ...rule } of careerInterviewSourceRules(session, topicIndex, tier, language)) {
      if (!existing.has(id)) await options.rules.add(knowledgeBaseId, rule, id);
    }
    const { displayName, bytes } = renderCareerInterviewSource(
      session,
      topicIndex,
      topic,
      language,
    );
    const added = await options.intake.addFileSource({
      knowledgeBaseId,
      displayName,
      mediaType: careerInterviewSourceMediaType,
      bytes,
    });
    if (added.created) {
      await options.setEvidenceKind(knowledgeBaseId, added.source.id, "transcript");
      await options.screen?.(added, bytes);
    }
    return { sourceId: added.source.id, status: added.created ? "created" : "already-present" };
  };
}

/** A statement in a summary that disagrees with a record entry; both are shown, neither changes. */
export interface CareerInterviewConflict {
  readonly kind: "date";
  readonly summaryValue: string;
  readonly factId: string;
  readonly factValue: string;
}

const yearPattern = /\b(19[5-9]\d|20\d{2})\b/gu;

/**
 * Years in the summary that fall outside every dated record entry the topic read. The candidate
 * decides: keep both, edit the summary, or leave it; nothing in the record is overwritten.
 */
export function careerInterviewConflicts(
  summary: string,
  topicFacts: readonly CareerInterviewFact[],
): CareerInterviewConflict[] {
  const dated = topicFacts
    .filter((fact) => fact.category === "date")
    .map((fact) => {
      const years = [...fact.value.matchAll(yearPattern)].map((match) => Number(match[0]));
      return { fact, years };
    })
    .filter(({ years }) => years.length > 0);
  if (dated.length === 0) return [];
  const conflicts: CareerInterviewConflict[] = [];
  for (const match of summary.matchAll(yearPattern)) {
    const year = Number(match[0]);
    const inside = dated.some(
      ({ years }) => year >= Math.min(...years) && year <= Math.max(...years),
    );
    if (inside) continue;
    const nearest = dated[0];
    if (nearest !== undefined && !conflicts.some((c) => c.summaryValue === match[0])) {
      conflicts.push({
        kind: "date",
        summaryValue: match[0],
        factId: nearest.fact.id,
        factValue: nearest.fact.value,
      });
    }
  }
  return conflicts;
}
