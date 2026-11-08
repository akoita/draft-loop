import type { SavedApplicationMaterial } from "@draft-loop/schemas/saved-application-material";
import type { SavedApplicationMaterialStore } from "@draft-loop/storage/saved-application-material";

import type {
  ApplicationMaterialDraft,
  ApplicationMaterialPort,
  DraftApplicationMaterialInput,
} from "./application-material.js";
import type { ApplicationMaterialRecordInput } from "./application-material-input.js";
import { type MaterialCriticPort, runCriticPass } from "./material-critic.js";

/**
 * The critic pass on a saved cover letter (#2525): the worker reviews the version the candidate
 * just drafted and saves the author's revision as the next version. The candidate's own edits and
 * versions the pass already wrote are never reviewed, so a pass runs at most once per draft.
 */

export interface ReviewSavedApplicationMaterialCommand {
  readonly drafts: Pick<SavedApplicationMaterialStore, "get" | "list" | "insert">;
  readonly workspaceId: string;
  readonly applicationId: string;
  readonly materialId: string;
  /** What the draft was written from, read from the record as the job runs. */
  readonly input: ApplicationMaterialRecordInput;
  /** The application's document language; English when unset. */
  readonly language?: string | undefined;
  readonly critic: MaterialCriticPort;
  readonly author: ApplicationMaterialPort;
  readonly newId: () => string;
  readonly now: () => Date;
  /** What the pass's calls cost so far, in US dollars, read once it ends. */
  readonly spentUsd?: () => number;
}

/** What one pass did; only `revised` saved a version. */
export type MaterialReviewOutcome =
  /** The author's revision passed every rule and was saved as the next version. */
  | "revised"
  /** The critic found nothing worth rewriting. */
  | "clean"
  /** The revision broke a citation rule, so the draft stands. */
  | "kept"
  /** No such draft for the application. */
  | "missing"
  /** Interview questions, an edited version or one the pass already wrote: no call was made. */
  | "skipped"
  /** The candidate saved a newer version meanwhile: theirs wins and nothing is saved. */
  | "superseded";

export interface MaterialReviewResult {
  readonly outcome: MaterialReviewOutcome;
  readonly findings: number;
  /** The saved revision when the outcome is `revised`. */
  readonly record?: SavedApplicationMaterial;
}

/** Whether the pass may review this version: a drafted cover letter nobody has changed. */
export function reviewableMaterial(material: SavedApplicationMaterial): boolean {
  return (
    material.kind === "cover-letter" &&
    material.based_on === undefined &&
    material.critic_findings === undefined &&
    !material.items.some((item) => item.edited === true)
  );
}

function draftOf(material: SavedApplicationMaterial): ApplicationMaterialDraft {
  return {
    kind: material.kind,
    items: material.items.map((item) => ({
      question: item.question,
      text: item.text,
      factIds: item.citations.map((citation) => citation.fact_id),
      ...(item.company_citations === undefined
        ? {}
        : { companyFactIds: item.company_citations.map((citation) => citation.finding_id) }),
    })),
    model: material.model,
  };
}

async function newestId(
  command: ReviewSavedApplicationMaterialCommand,
  kind: SavedApplicationMaterial["kind"],
): Promise<string | undefined> {
  const [newest] = await command.drafts.list(command.workspaceId, command.applicationId, {
    kind,
    limit: 1,
  });
  return newest?.id;
}

export async function reviewSavedApplicationMaterial(
  command: ReviewSavedApplicationMaterialCommand,
): Promise<MaterialReviewResult> {
  const base = await command.drafts.get(command.workspaceId, command.materialId);
  if (base === undefined || base.application_id !== command.applicationId) {
    return { outcome: "missing", findings: 0 };
  }
  if (!reviewableMaterial(base)) return { outcome: "skipped", findings: 0 };
  if ((await newestId(command, base.kind)) !== base.id)
    return { outcome: "superseded", findings: 0 };

  const { input } = command;
  // The company facts the letter cited, as it saved them: a revision may keep them, never add one.
  const company = new Map(
    base.items.flatMap((item) =>
      (item.company_citations ?? []).map(
        (citation) => [citation.finding_id, citation.text] as const,
      ),
    ),
  );
  const draftInput: DraftApplicationMaterialInput = {
    kind: base.kind,
    facts: input.facts,
    requirements: input.requirements,
    ...(input.usage === undefined ? {} : { usage: input.usage }),
    ...(input.voice === undefined ? {} : { voice: input.voice }),
    ...(base.guidance === undefined ? {} : { guidance: base.guidance }),
    ...(command.language === undefined ? {} : { language: command.language }),
    ...(company.size === 0
      ? {}
      : { companyFacts: [...company].map(([id, text]) => ({ id, text })) }),
  };
  const pass = await runCriticPass(command.critic, command.author, draftInput, draftOf(base));
  const findings = pass.findings.length;
  if (findings === 0) return { outcome: "clean", findings };
  if (!pass.revised) return { outcome: "kept", findings };
  // The candidate may have saved an edit while the models answered: their version wins.
  if ((await newestId(command, base.kind)) !== base.id) return { outcome: "superseded", findings };

  const byId = new Map(input.facts.map((fact) => [fact.id, fact]));
  const record: SavedApplicationMaterial = {
    ...base,
    id: command.newId(),
    created_at: command.now().toISOString(),
    items: pass.draft.items.map((item) => ({
      question: item.question,
      text: item.text,
      citations: item.factIds.map((id) => {
        const fact = byId.get(id);
        return {
          fact_id: id,
          text: fact === undefined ? id : `${fact.category} ${fact.field}: ${fact.value}`,
        };
      }),
      ...((item.companyFactIds ?? []).length === 0
        ? {}
        : {
            company_citations: (item.companyFactIds ?? []).map((id) => ({
              finding_id: id,
              text: company.get(id) ?? id,
            })),
          }),
    })),
    based_on: base.id,
    model: pass.draft.model ?? base.model,
    critic_findings: pass.findings.map((finding) => ({ ...finding })),
    ...(pass.criticModel === undefined ? {} : { critic_model: pass.criticModel }),
    cost_usd: command.spentUsd?.() ?? 0,
  };
  await command.drafts.insert(record);
  return { outcome: "revised", findings, record };
}
