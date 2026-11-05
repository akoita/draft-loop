import type { SourceSensitivityTier } from "@draft-loop/domain/source-sensitivity";
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

function topicLabel(topic: CareerInterviewSessionTopic): string {
  return topic.reason
    .replace(/[\\`*_[\]<>#|]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 160);
}

/** The top heading; the session id and topic position keep it unique in the knowledge base. */
export function careerInterviewSourceHeading(
  session: Pick<CareerInterviewSession, "id">,
  topicIndex: number,
): string {
  return `Career interview ${session.id} topic ${topicIndex + 1}`;
}

export function renderCareerInterviewMarkdown(
  session: Pick<CareerInterviewSession, "id">,
  topicIndex: number,
  topic: CareerInterviewSessionTopic,
): string {
  if (topic.summary === undefined) {
    throw new Error("Only a topic with a confirmed summary becomes evidence.");
  }
  const words = topic.turns
    .filter((turn) => turn.mark === undefined && turn.text !== "")
    .map(
      (turn) => `- ${turn.role === "candidate" ? "Candidate" : "Interviewer"}: ${plain(turn.text)}`,
    );
  const sections = [
    `# ${careerInterviewSourceHeading(session, topicIndex)}`,
    "Candidate-provided evidence: a topic from a guided career interview, summarised and confirmed by the candidate.",
    "## Topic",
    plain(topicLabel(topic)),
    "## Confirmed summary",
    plain(topic.summary),
    "## Conversation",
    words.length === 0 ? "No words recorded." : words.join("\n"),
  ];
  return `${sections.join("\n\n")}\n`;
}

export function renderCareerInterviewSource(
  session: Pick<CareerInterviewSession, "id">,
  topicIndex: number,
  topic: CareerInterviewSessionTopic,
): { readonly displayName: string; readonly bytes: Uint8Array } {
  return {
    displayName: `career-interview-${session.id}-${topicIndex + 1}.md`,
    bytes: new TextEncoder().encode(renderCareerInterviewMarkdown(session, topicIndex, topic)),
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
): CareerInterviewSourceRule[] {
  if (tier === "normal") return [];
  return [
    {
      id: `ci-${session.id}-${topicIndex + 1}`,
      tier,
      match: { kind: "heading-path", path: [careerInterviewSourceHeading(session, topicIndex)] },
    },
  ];
}

export interface CareerInterviewPublishInput {
  readonly session: CareerInterviewSession;
  readonly topicIndex: number;
  readonly knowledgeBaseId: string;
  readonly tier: SourceSensitivityTier;
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
  return async ({ session, topicIndex, knowledgeBaseId, tier }) => {
    const topic = session.topics[topicIndex];
    if (topic === undefined) throw new Error("No such interview topic.");
    const existing = new Set(
      (await options.rules.list(knowledgeBaseId)).rules.map((rule) => rule.id),
    );
    for (const { id, ...rule } of careerInterviewSourceRules(session, topicIndex, tier)) {
      if (!existing.has(id)) await options.rules.add(knowledgeBaseId, rule, id);
    }
    const { displayName, bytes } = renderCareerInterviewSource(session, topicIndex, topic);
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
