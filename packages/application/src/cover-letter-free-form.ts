import {
  type ApplicationMaterialContext,
  type ApplicationMaterialDraft,
  ApplicationMaterialError,
  type ApplicationMaterialItem,
  type ApplicationMaterialModelIdentity,
  applicationMaterialContext,
  type DraftApplicationMaterialInput,
} from "./application-material.js";
import type { ApplicationMaterialCompanyFact } from "./application-material-company.js";
import {
  type CheckedCoverLetterSentence,
  type CoverLetterClaimCheck,
  type CoverLetterClaimCheckPort,
  checkCoverLetter,
} from "./cover-letter-claims.js";
import { type PickedCoverLetterFact, pickCoverLetterFacts } from "./cover-letter-facts.js";

/**
 * A cover letter written as prose, then checked (#2586): the writer tells a few job-matched facts
 * as one letter, the claim check holds each sentence to them, the writer revises the failing
 * sentences once, and any that still fail are dropped. The letter is never returned with an
 * unsupported sentence.
 */

export interface FreeFormCoverLetterRequest {
  readonly facts: readonly PickedCoverLetterFact[];
  readonly companyFacts: readonly ApplicationMaterialCompanyFact[];
  readonly requirements: ApplicationMaterialContext["requirements"];
  readonly guidance?: ApplicationMaterialContext["guidance"];
  readonly voice?: ApplicationMaterialContext["voice"];
  readonly language?: string;
  /** On the second call: the first letter and the sentences that failed, with why. */
  readonly revision?: {
    readonly letter: string;
    readonly sentences: readonly { readonly text: string; readonly problems: readonly string[] }[];
  };
}

export interface FreeFormCoverLetterWriterPort {
  write(
    request: FreeFormCoverLetterRequest,
  ): Promise<{ readonly letter: string; readonly model?: ApplicationMaterialModelIdentity }>;
}

export interface FreeFormCoverLetterDraft extends ApplicationMaterialDraft {
  /** The sentences dropped because no picked fact supported them, even after one revision. */
  readonly droppedSentences: readonly string[];
}

/** Paragraphs from the supported sentences, each citing the facts its sentences cite. */
function itemsOf(sentences: readonly CheckedCoverLetterSentence[]): ApplicationMaterialItem[] {
  const paragraphs = new Map<number, CheckedCoverLetterSentence[]>();
  for (const sentence of sentences) {
    if (sentence.problems.length > 0) continue;
    paragraphs.set(sentence.paragraph, [...(paragraphs.get(sentence.paragraph) ?? []), sentence]);
  }
  return [...paragraphs.values()].map((kept) => {
    const companyFactIds = [...new Set(kept.flatMap((sentence) => sentence.companyFactIds))];
    return {
      question: "",
      text: kept.map((sentence) => sentence.text).join(" "),
      factIds: [...new Set(kept.flatMap((sentence) => sentence.factIds))],
      ...(companyFactIds.length === 0 ? {} : { companyFactIds }),
    };
  });
}

function failing(check: CoverLetterClaimCheck) {
  return check.sentences.filter((sentence) => sentence.problems.length > 0);
}

export async function draftFreeFormCoverLetter(
  writer: FreeFormCoverLetterWriterPort,
  checker: CoverLetterClaimCheckPort,
  input: DraftApplicationMaterialInput,
): Promise<FreeFormCoverLetterDraft> {
  // The bounded context decides which facts may reach a model and bounds the rest of the input.
  const context = applicationMaterialContext({ ...input, kind: "cover-letter" });
  const allowed = new Set(context.facts.map((fact) => fact.id));
  const facts = pickCoverLetterFacts(
    input.facts.filter((fact) => allowed.has(fact.id)),
    input.requirements,
  );
  if (facts.length === 0) {
    throw new ApplicationMaterialError(
      "no_facts",
      "The career record holds no fact the draft may cite.",
    );
  }
  const companyFacts = context.company ?? [];
  const request: FreeFormCoverLetterRequest = {
    facts,
    companyFacts,
    requirements: context.requirements,
    ...(context.guidance === undefined ? {} : { guidance: context.guidance }),
    ...(context.voice === undefined ? {} : { voice: context.voice }),
    ...(context.language === undefined ? {} : { language: context.language }),
  };
  const first = await writer.write(request);
  let check = await checkCoverLetter(first.letter, facts, companyFacts, checker);
  let model = first.model;
  if (!check.supported) {
    const revised = await writer.write({
      ...request,
      revision: {
        letter: first.letter,
        sentences: failing(check).map(({ text, problems }) => ({ text, problems })),
      },
    });
    check = await checkCoverLetter(revised.letter, facts, companyFacts, checker);
    model = revised.model ?? model;
  }
  const items = itemsOf(check.sentences);
  if (!items.some((item) => item.factIds.length > 0)) {
    throw new ApplicationMaterialError(
      "invalid_draft",
      "No sentence of the drafted letter was supported by the career record.",
    );
  }
  return {
    kind: "cover-letter",
    items,
    ...(model === undefined ? {} : { model }),
    droppedSentences: failing(check).map((sentence) => sentence.text),
  };
}
