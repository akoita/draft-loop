import type { SourceSensitivityTier } from "@draft-loop/domain/source-sensitivity";
import type { WorkJournalStoredNote } from "@draft-loop/schemas/work-journal";

import type {
  AddedHostedKnowledgeSource,
  HostedKnowledgeIntake,
} from "./hosted-knowledge-intake.js";
import type { HostedSensitivityRules } from "./hosted-sensitivity-rules.js";
import type { SourceSensitivityRuleInput } from "./source-sensitivity-service.js";
import type { WorkJournalPublish } from "./work-journal.js";

/**
 * An approved work-journal note as career evidence (#2022): a Markdown knowledge source with the
 * `work-journal` evidence kind and sensitivity rules that follow the project's visibility. The
 * same note always renders the same bytes, so a second approval finds the source already present.
 */

export const workJournalSourceMediaType = "text/markdown";

const roleLabels = {
  designed: "Designed",
  implemented: "Implemented",
  directed: "Directed",
  reviewed: "Reviewed",
} as const;

/**
 * The top heading; the note id keeps it unique in the knowledge base, so rules match one note.
 * Markdown punctuation is dropped from the title, so the heading reads back exactly as written.
 */
export function workJournalSourceHeading(note: WorkJournalStoredNote): string {
  const title = note.content.title
    .replace(/[\\`*_[\]<>#|]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return `Work journal: ${title} (${note.id})`;
}

/** Text placed in Markdown stays text: no heading, list or link syntax from the agent. */
function plain(value: string): string {
  return value.replace(/[\\`*_[\]<>#|]/gu, (character) => `\\${character}`);
}

function bullet(value: string): string {
  return `- ${plain(value)}`;
}

export function renderWorkJournalMarkdown(note: WorkJournalStoredNote): string {
  const { content } = note;
  const period =
    content.period.end === undefined || content.period.end === content.period.start
      ? content.period.start
      : `${content.period.start} to ${content.period.end}`;
  const project = [
    bullet(`Project: ${content.project.name} (${content.project.visibility})`),
    ...(content.project.repository === undefined
      ? []
      : [bullet(`Repository: ${content.project.repository}`)]),
    ...content.links.map((link) => `- ${link.kind}: <${link.url}>`),
  ];
  const sections = [
    `# ${workJournalSourceHeading(note)}`,
    "Candidate-provided evidence: a note recorded from an agent session and approved by the candidate.",
    "## Summary",
    plain(content.summary),
    "## Technologies",
    content.technologies.map(bullet).join("\n"),
    "## Role",
    content.candidate_role.map((role) => bullet(roleLabels[role])).join("\n"),
    "## Period",
    plain(period),
    "## Metrics",
    content.metrics.length === 0
      ? "None recorded."
      : content.metrics
          .map((metric) =>
            bullet(`${metric.description} (measured by ${metric.how_measured ?? ""})`),
          )
          .join("\n"),
    "## Project and links",
    project.join("\n"),
  ];
  return `${sections.join("\n\n")}\n`;
}

export function renderWorkJournalSource(note: WorkJournalStoredNote): {
  readonly displayName: string;
  readonly bytes: Uint8Array;
} {
  return {
    displayName: `work-journal-${note.id}.md`,
    bytes: new TextEncoder().encode(renderWorkJournalMarkdown(note)),
  };
}

export interface WorkJournalSourceRule extends SourceSensitivityRuleInput {
  readonly id: string;
}

/**
 * The note's sensitivity rules: the whole note at the confirmed tier when it is stricter than
 * `normal`, and for a private or unknown project the `Project and links` section `never-share`,
 * so a run can use the work while the repository's name never reaches a provider.
 */
export function workJournalSourceRules(
  note: WorkJournalStoredNote,
  tier: SourceSensitivityTier,
): WorkJournalSourceRule[] {
  const heading = workJournalSourceHeading(note);
  const rules: WorkJournalSourceRule[] = [];
  if (tier !== "normal") {
    rules.push({ id: `wj-${note.id}`, tier, match: { kind: "heading-path", path: [heading] } });
  }
  if (note.content.project.visibility !== "public" && tier !== "never-share") {
    rules.push({
      id: `wj-${note.id}-links`,
      tier: "never-share",
      match: { kind: "heading-path", path: [heading, "Project and links"] },
    });
  }
  return rules;
}

export interface WorkJournalPublisherOptions {
  readonly intake: Pick<HostedKnowledgeIntake, "addFileSource">;
  readonly rules: Pick<HostedSensitivityRules, "list" | "add">;
  /** Sets the source's evidence kind, which detection never picks for a note. */
  readonly setEvidenceKind: (
    knowledgeBaseId: string,
    sourceId: string,
    kind: "work-journal",
  ) => Promise<void>;
  /** Screens the stored source like an upload; the route passes the request's screening. */
  readonly screen?: (added: AddedHostedKnowledgeSource, bytes: Uint8Array) => Promise<void>;
}

/** What approval calls: writes the rules first, so the source is never readable without them. */
export function createWorkJournalPublisher(
  options: WorkJournalPublisherOptions,
): WorkJournalPublish {
  return async ({ note, knowledgeBaseId, tier }) => {
    const existing = new Set(
      (await options.rules.list(knowledgeBaseId)).rules.map((rule) => rule.id),
    );
    for (const { id, ...rule } of workJournalSourceRules(note, tier)) {
      if (!existing.has(id)) await options.rules.add(knowledgeBaseId, rule, id);
    }
    const { displayName, bytes } = renderWorkJournalSource(note);
    const added = await options.intake.addFileSource({
      knowledgeBaseId,
      displayName,
      mediaType: workJournalSourceMediaType,
      bytes,
    });
    if (added.created) {
      await options.setEvidenceKind(knowledgeBaseId, added.source.id, "work-journal");
      await options.screen?.(added, bytes);
    }
    return { sourceId: added.source.id, status: added.created ? "created" : "already-present" };
  };
}
