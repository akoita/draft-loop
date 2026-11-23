import { z } from "zod";

import { applicationIdSchema } from "./application.js";
import { coverLetterKitSchema } from "./cover-letter-kit.js";
import { interviewDetailsSchema } from "./interview-details.js";
import { researchTopics } from "./research-brief.js";

/**
 * A cover letter, interview question set, interview preparation guide (#2615) or cover letter
 * writing kit (#3278) saved with its application (#2477), so the candidate
 * can reopen it, compare versions and delete it. It holds the draft as the candidate saw it,
 * with each item's citations, the model that wrote it and what it cost. It is candidate
 * material: it lives in the workspace's storage under its consent and is erased with it.
 */

export const savedApplicationMaterialKinds = [
  "cover-letter",
  "interview-questions",
  "interview-guide",
  "cover-letter-kit",
] as const;

export const maximumSavedApplicationMaterialItems = 10;
/** An interview preparation guide (#2615) is one long document of sectioned items. */
export const maximumSavedInterviewGuideItems = 80;

/**
 * The sections of an interview preparation guide (#2615), in reading order. Each guide item
 * belongs to one. `topic` holds a topic the candidate asked to cover, such as salary.
 */
export const interviewGuideSections = [
  "read-first",
  "interview",
  "company",
  "role",
  "market",
  "matrix",
  "pitch",
  "stories",
  "defense",
  "questions",
  "ask",
  "practical",
  "topic",
  "never-say",
  "checklist",
  "sources",
] as const;
export type InterviewGuideSection = (typeof interviewGuideSections)[number];
export const maximumSavedApplicationMaterialItemCharacters = 4_000;
export const maximumSavedApplicationMaterialCitations = 20;
/** The most critic findings one revised version keeps (#2524). */
export const maximumMachineTellFindings = 8;
/** What a career record may lack, so a cover letter cannot name it. */
export const savedMaterialRecordGaps = ["employer", "dates"] as const;

export const savedApplicationMaterialIdSchema = z
  .string()
  .regex(/^amd_[A-Za-z0-9_-]{8,64}$/u, "must be a saved application material id");

const shortText = z.string().trim().min(1).max(200);

export const applicationMaterialTones = ["formal", "warm", "direct"] as const;
export const applicationMaterialLengths = ["short", "standard", "long"] as const;
export const maximumApplicationMaterialEmphasisCharacters = 400;
export const maximumApplicationMaterialAddresseeCharacters = 120;

/**
 * The candidate's own guidance for one draft (#2478): what to stress, the tone, the length and,
 * for a cover letter, whom to address. It steers the writing and is never a source: a claim or a
 * number still needs a cited fact.
 */
export const applicationMaterialGuidanceSchema = z
  .strictObject({
    emphasis: z
      .string()
      .trim()
      .max(maximumApplicationMaterialEmphasisCharacters)
      .optional()
      .describe("What to stress, in the candidate's words."),
    tone: z.enum(applicationMaterialTones).optional(),
    length: z.enum(applicationMaterialLengths).optional(),
    addressee: z
      .string()
      .trim()
      .max(maximumApplicationMaterialAddresseeCharacters)
      .optional()
      .describe("Whom a cover letter is addressed to, such as a hiring manager's name."),
  })
  .meta({ id: "ApplicationMaterialGuidance" });

export type ApplicationMaterialGuidance = z.infer<typeof applicationMaterialGuidanceSchema>;

export const savedApplicationMaterialSchema = z
  .strictObject({
    id: savedApplicationMaterialIdSchema,
    workspace_id: z.string().min(1).max(256),
    application_id: applicationIdSchema,
    kind: z.enum(savedApplicationMaterialKinds),
    items: z
      .array(
        z.strictObject({
          question: z.string().max(maximumSavedApplicationMaterialItemCharacters),
          text: z.string().min(1).max(maximumSavedApplicationMaterialItemCharacters),
          /** The guide section this item belongs to; set on every interview guide item only. */
          section: z.enum(interviewGuideSections).optional(),
          /** For a likely question in a guide: the answer to avoid, and why. */
          trap: z.string().min(1).max(maximumSavedApplicationMaterialItemCharacters).optional(),
          /** True when the candidate rewrote this item's text (#2480). */
          edited: z.boolean().optional(),
          citations: z
            .array(
              z.strictObject({
                fact_id: shortText,
                text: z.string().max(maximumSavedApplicationMaterialItemCharacters),
              }),
            )
            .max(maximumSavedApplicationMaterialCitations),
          /** The research brief's findings a statement about the employer rests on (#2544). */
          company_citations: z
            .array(
              z.strictObject({
                finding_id: shortText,
                text: z.string().max(maximumSavedApplicationMaterialItemCharacters),
              }),
            )
            .max(maximumSavedApplicationMaterialCitations)
            .optional(),
        }),
      )
      .max(maximumSavedInterviewGuideItems)
      .describe("At least one item; none for a writing kit, which holds `kit` instead."),
    /** A cover letter writing kit (#3278); set on every kit and nothing else. */
    kit: coverLetterKitSchema.optional(),
    guidance: applicationMaterialGuidanceSchema.optional(),
    /** The interview a guide was written for (#2616); set on every guide and nothing else. */
    interview_details: interviewDetailsSchema.optional(),
    /** The research brief the company citations come from (#2544); absent when none was used. */
    research_brief_id: shortText.optional(),
    /** The saved draft this version was edited from (#2480); absent for a drafted version. */
    based_on: savedApplicationMaterialIdSchema.optional(),
    /**
     * `candidate` for a cover letter the candidate wrote in their own words beside a writing kit
     * (#3279): no model wrote any of it, and `based_on` names the kit or their earlier letter.
     * Absent for a letter a model drafted.
     */
    written_by: z.enum(["candidate"]).optional(),
    model: z.strictObject({ provider: shortText, model: shortText }),
    /**
     * The critic's findings this version revised (#2525): each sentence of the version it is based
     * on that read as machine-written. Absent unless the critic pass wrote this version.
     */
    critic_findings: z
      .array(
        z.strictObject({
          paragraph: z
            .number()
            .int()
            .min(0)
            .max(maximumSavedApplicationMaterialItems - 1),
          sentence: z.string().min(1).max(maximumSavedApplicationMaterialItemCharacters),
          reason: z.string().max(200),
        }),
      )
      .max(maximumMachineTellFindings)
      .optional(),
    /** The critic that found them, from another company than the author. */
    critic_model: z.strictObject({ provider: shortText, model: shortText }).optional(),
    /**
     * A free-form cover letter's or a guide's sentences left out because no career fact supported them
     * (#2586, #2619). Absent when none was dropped.
     */
    dropped_sentences: z
      .array(z.string().min(1).max(maximumSavedApplicationMaterialItemCharacters))
      .max(maximumSavedInterviewGuideItems * 2)
      .optional(),
    /**
     * For a guide (#2632): the topics research kept no source for, whose sections stay short and
     * state no fact. Absent when every topic had a source.
     */
    unsourced_topics: z.array(z.enum(researchTopics)).max(researchTopics.length).optional(),
    /**
     * For a cover letter (#2725): what the career record did not hold when it was drafted, so the
     * letter could not name it. Absent when the record had both.
     */
    record_gaps: z
      .array(z.enum(savedMaterialRecordGaps))
      .max(savedMaterialRecordGaps.length)
      .optional(),
    prompt_version: shortText,
    cost_usd: z.number().min(0),
    created_at: z.iso.datetime({ offset: true }),
  })
  .superRefine((material, context) => {
    const guide = material.kind === "interview-guide";
    const kit = material.kind === "cover-letter-kit";
    if (kit !== (material.kit !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["kit"],
        message: kit ? "a writing kit needs its kit" : "only a writing kit has a kit",
      });
    }
    if (kit !== (material.items.length === 0)) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: kit ? "a writing kit holds no items" : "holds at least one item",
      });
    }
    if (material.written_by !== undefined && material.kind !== "cover-letter") {
      context.addIssue({
        code: "custom",
        path: ["written_by"],
        message: "only a cover letter is written by the candidate",
      });
    }
    if (guide !== (material.interview_details !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["interview_details"],
        message: guide
          ? "a guide needs its interview details"
          : "only a guide has interview details",
      });
    }
    if (!guide && material.items.length > maximumSavedApplicationMaterialItems) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: `holds at most ${maximumSavedApplicationMaterialItems} items`,
      });
    }
    material.items.forEach((item, index) => {
      if (guide !== (item.section !== undefined)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "section"],
          message: guide ? "a guide item needs a section" : "only a guide item has a section",
        });
      }
      if (!guide && item.trap !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "trap"],
          message: "only a guide item has a trap",
        });
      }
    });
  });

export type SavedApplicationMaterial = z.infer<typeof savedApplicationMaterialSchema>;
