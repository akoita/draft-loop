import { z } from "zod";

import {
  type ProjectCardDetails,
  projectCardContributionSchema,
  projectCardHighlightSchema,
  projectCardLimits,
  projectCardLine,
  projectCardRoles,
  projectCardScaleSchema,
} from "./project-card-details.js";
import {
  containsSecretLikeContent,
  type WorkJournalCandidateRole,
  type WorkJournalNoteContent,
  workJournalLimits,
} from "./work-journal.js";

export * from "./project-card-details.js";

/**
 * A project card as an agent files it (#2894, #2895): a short, cited summary of one code
 * repository, never its code. The agent counts the numbers from git; the candidate reviews the
 * card as a pending work-journal note before any run can use it. Field names follow the MCP
 * tool's snake_case.
 */

export const projectCardVisibilities = ["public", "private"] as const;
export type ProjectCardVisibility = (typeof projectCardVisibilities)[number];

/** Content-free refusal codes; a refusal names what is wrong, never the refused text. */
export const projectCardRefusalCodes = [
  "invalid_card",
  "secret_like_content",
  "link_not_https",
  "contributor_identity",
  "private_card_with_links",
] as const;
export type ProjectCardRefusalCode = (typeof projectCardRefusalCodes)[number];

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

const httpsUrl = z
  .string()
  .trim()
  .max(2_000)
  .refine(isHttpsUrl, { message: "must be an https address", params: { code: "link_not_https" } });

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if ((code < 0x20 || code === 0x7f) && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      return true;
    }
  }
  return false;
}

export const projectCardInputSchema = z
  .object({
    name: projectCardLine(1, 120),
    purpose: projectCardLine(projectCardLimits.purposeMin, projectCardLimits.purposeMax),
    summary: z
      .string()
      .trim()
      .min(workJournalLimits.summaryMin)
      .max(workJournalLimits.summaryMax)
      .refine((value) => !hasControlCharacter(value), "must be plain text"),
    role: z.enum(projectCardRoles),
    visibility: z.enum(projectCardVisibilities),
    stack: z
      .array(projectCardLine(1, 60))
      .min(workJournalLimits.technologiesMin)
      .max(workJournalLimits.technologiesMax)
      .refine(
        (values) => new Set(values.map((value) => value.toLowerCase())).size === values.length,
        "stack entries must be unique",
      ),
    contribution: projectCardContributionSchema,
    scale: projectCardScaleSchema.default({}),
    highlights: z
      .array(projectCardHighlightSchema)
      .max(projectCardLimits.highlightsMax)
      .default([]),
    repository_url: httpsUrl.optional(),
    live_url: httpsUrl.optional(),
    release_url: httpsUrl.optional(),
    dedupe_key: projectCardLine(1, 200).optional(),
    dry_run: z.boolean().optional(),
  })
  .strict();
export type ProjectCardInput = z.infer<typeof projectCardInputSchema>;

export type ProjectCardCheck =
  | { readonly ok: true; readonly card: ProjectCardInput }
  | {
      readonly ok: false;
      readonly code: ProjectCardRefusalCode;
      /** Dotted paths of the fields at fault; never their values. */
      readonly fields: readonly string[];
    };

const emailLocal = /^[A-Za-z0-9._%+-]+$/u;
const emailLabel = /^[A-Za-z0-9-]+$/u;
const emailTopLevel = /^[A-Za-z]{2,}$/u;

/**
 * Whether text holds an email address: a card names no contributor, the candidate included.
 * Each word is checked by splitting on `@` and `.`, so the check stays linear on any input.
 */
export function containsEmailAddress(value: string): boolean {
  for (const word of value.split(/[\s<>()[\]"',;:]/u)) {
    const at = word.indexOf("@");
    if (at <= 0 || at !== word.lastIndexOf("@")) continue;
    const labels = word.slice(at + 1).split(".");
    const top = labels.at(-1) ?? "";
    if (
      emailLocal.test(word.slice(0, at)) &&
      labels.length >= 2 &&
      labels.slice(0, -1).every((label) => emailLabel.test(label)) &&
      emailTopLevel.test(top)
    ) {
      return true;
    }
  }
  return false;
}

function stringsOf(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsOf(item, into);
  else if (value !== null && typeof value === "object")
    for (const item of Object.values(value)) stringsOf(item, into);
  return into;
}

/** Checks what an agent sent, refusing with a content-free code. */
export function checkProjectCardInput(input: unknown): ProjectCardCheck {
  if (containsSecretLikeContent(input))
    return { ok: false, code: "secret_like_content", fields: [] };
  if (stringsOf(input).some(containsEmailAddress)) {
    return { ok: false, code: "contributor_identity", fields: [] };
  }
  const parsed = projectCardInputSchema.safeParse(input);
  if (!parsed.success) {
    const https = parsed.error.issues.filter(
      (issue) =>
        issue.code === "custom" &&
        (issue as { params?: { code?: string } }).params?.code === "link_not_https",
    );
    const issues = https.length > 0 ? https : parsed.error.issues;
    return {
      ok: false,
      code: https.length > 0 ? "link_not_https" : "invalid_card",
      fields: [...new Set(issues.map((issue) => issue.path.join(".")))],
    };
  }
  const card = parsed.data;
  if (card.visibility === "private") {
    const linked = (["repository_url", "live_url", "release_url"] as const).filter(
      (field) => card[field] !== undefined,
    );
    if (linked.length > 0) return { ok: false, code: "private_card_with_links", fields: linked };
  }
  return { ok: true, card };
}

const noteRoles: Readonly<Record<ProjectCardInput["role"], readonly WorkJournalCandidateRole[]>> = {
  "sole-author": ["designed", "implemented"],
  lead: ["directed", "implemented"],
  contributor: ["implemented"],
};

function title(card: ProjectCardInput): string {
  const full = `${card.name}: ${card.purpose}`;
  if (full.length <= workJournalLimits.titleMax) return full;
  return `${full.slice(0, workJournalLimits.titleMax - 3).trimEnd()}...`;
}

/** The dedupe key: the agent's own key, else the repository address, else the project name. */
export function projectCardDedupeKey(card: ProjectCardInput): string {
  const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/gu, " ");
  if (card.dedupe_key !== undefined) return `card-key:${normalized(card.dedupe_key)}`;
  if (card.repository_url !== undefined) return `repo:${normalized(card.repository_url)}`;
  return `project:${normalized(card.name)}`;
}

/** A card as a work-journal note: its note-shaped content and the card's own details. */
export function projectCardNote(card: ProjectCardInput): {
  readonly content: WorkJournalNoteContent;
  readonly details: ProjectCardDetails;
} {
  const links = [
    ...(card.repository_url === undefined
      ? []
      : [{ kind: "repository" as const, url: card.repository_url }]),
    ...(card.live_url === undefined ? [] : [{ kind: "website" as const, url: card.live_url }]),
    ...(card.release_url === undefined
      ? []
      : [{ kind: "release" as const, url: card.release_url }]),
  ];
  const { first_commit: start, last_commit: end } = card.contribution;
  return {
    content: {
      title: title(card),
      summary: card.summary,
      period: end === start ? { start } : { start, end },
      project: {
        name: card.name,
        visibility: card.visibility,
        ...(card.repository_url === undefined ? {} : { repository: card.repository_url }),
      },
      technologies: [...card.stack],
      category: "other",
      candidate_role: [...noteRoles[card.role]],
      links,
      metrics: [],
    },
    details: {
      purpose: card.purpose,
      role: card.role,
      contribution: card.contribution,
      scale: card.scale,
      highlights: card.highlights,
    },
  };
}
