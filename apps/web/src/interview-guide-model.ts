import { t } from "@lingui/core/macro";

import type { ApiSchemas } from "./api-client.js";
import type { ApplicationMaterialDraft } from "./application-material-model.js";

/**
 * The interview preparation guide in the Prepare panel (#2621): the interview details form's
 * choices and labels, the request it sends, and how a saved guide reads as sections. Pure, so it
 * is tested without a page.
 */

export type InterviewDetails = ApiSchemas["InterviewDetailsInput"];
export type InterviewStage = InterviewDetails["stage"];
export type InterviewGuideDepth = InterviewDetails["depth"];
export type InterviewTopic = NonNullable<InterviewDetails["topics"]>[number];
export type InterviewGuideRequest = ApiSchemas["InterviewGuideRequestInput"];
export type InterviewGuidePart = NonNullable<InterviewGuideRequest["parts"]>[number];
export type InterviewGuideSection = NonNullable<
  ApplicationMaterialDraft["items"][number]["section"]
>;

export const interviewStages: readonly InterviewStage[] = [
  "screen",
  "technical",
  "manager",
  "case",
  "combined",
  "final",
];

export const interviewTopics: readonly InterviewTopic[] = [
  "salary",
  "availability",
  "remote-and-travel",
  "language",
  "career-gap",
  "departure",
  "management",
  "unused-technology",
];

export const interviewStageLabels = (): Readonly<Record<InterviewStage, string>> => ({
  screen: t`Screening call`,
  technical: t`Technical interview`,
  manager: t`Hiring manager`,
  case: t`Case study`,
  combined: t`Screening and technical together`,
  final: t`Final round`,
});

export const interviewFormatLabels = (): Readonly<
  Record<NonNullable<InterviewDetails["format"]>, string>
> => ({ video: t`Video call`, phone: t`Phone`, onsite: t`On site` });

export const interviewTopicLabels = (): Readonly<Record<InterviewTopic, string>> => ({
  salary: t`Salary`,
  availability: t`Availability and notice`,
  "remote-and-travel": t`Remote work and travel`,
  language: t`Language`,
  "career-gap": t`A gap in my career`,
  departure: t`Why I left`,
  management: t`Managing people`,
  "unused-technology": t`A technology I have not used`,
});

/** Each depth with what it holds and what it costs, as the server caps it. */
export const interviewGuideDepthLabels = (): Readonly<
  Record<InterviewGuideDepth, { readonly name: string; readonly detail: string }>
> => ({
  essential: {
    name: t`Essential`,
    detail: t`For a 15 to 30 minute screen: the key points, your pitch, weak points and six likely questions. About US$0.10 to 0.15, at most US$0.20.`,
  },
  extensive: {
    name: t`Extensive`,
    detail: t`For an interview of an hour or more: adds the market, a requirement matrix, stories, twelve questions and a checklist. About US$0.30 to 0.40, at most US$0.40.`,
  },
});

/** The depth suggested for an interview, as the server suggests it; the candidate can switch. */
export function suggestedInterviewGuideDepth(
  stage: InterviewStage,
  lengthMinutes: number | undefined,
): InterviewGuideDepth {
  if (stage === "combined" || stage === "final") return "extensive";
  if (lengthMinutes !== undefined) {
    if (lengthMinutes <= 30) return "essential";
    if (lengthMinutes >= 60) return "extensive";
  }
  return stage === "screen" ? "essential" : "extensive";
}

/** The details form as the candidate fills it: free text kept as typed until it is sent. */
export interface InterviewDetailsForm {
  readonly stage: InterviewStage;
  /** Undefined while the candidate follows the suggestion. */
  readonly depth?: InterviewGuideDepth;
  readonly scheduledAt: string;
  readonly lengthMinutes: string;
  readonly format: InterviewDetails["format"] | "";
  readonly interviewerRole: string;
  readonly topics: readonly InterviewTopic[];
  /** One topic per line. */
  readonly otherTopics: string;
  readonly notes: string;
  /** One entry per line. */
  readonly neverSay: string;
}

export const emptyInterviewDetailsForm: InterviewDetailsForm = {
  stage: "screen",
  scheduledAt: "",
  lengthMinutes: "",
  format: "",
  interviewerRole: "",
  topics: [],
  otherTopics: "",
  notes: "",
  neverSay: "",
};

const lines = (text: string, limit: number) =>
  text
    .split("\n")
    .map((line) => line.trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, limit);

function minutesOf(text: string): number | undefined {
  const minutes = Number.parseInt(text, 10);
  return Number.isFinite(minutes) && minutes >= 5 && minutes <= 480 ? minutes : undefined;
}

/** The depth the guide will be written at: the candidate's choice, else the suggestion. */
export function interviewGuideDepthOf(form: InterviewDetailsForm): InterviewGuideDepth {
  return form.depth ?? suggestedInterviewGuideDepth(form.stage, minutesOf(form.lengthMinutes));
}

/** The details as the request sends them: empty fields left out, lists split by line. */
export function interviewDetailsOf(form: InterviewDetailsForm): InterviewDetails {
  const lengthMinutes = minutesOf(form.lengthMinutes);
  const role = form.interviewerRole.trim().slice(0, 120);
  const otherTopics = lines(form.otherTopics, 5);
  const neverSay = lines(form.neverSay, 10);
  const notes = form.notes.trim().slice(0, 1_000);
  const scheduledAt = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/u.test(form.scheduledAt)
    ? form.scheduledAt
    : undefined;
  return {
    stage: form.stage,
    depth: interviewGuideDepthOf(form),
    ...(scheduledAt === undefined ? {} : { scheduled_at: scheduledAt }),
    ...(lengthMinutes === undefined ? {} : { length_minutes: lengthMinutes }),
    ...(form.format === "" || form.format === undefined ? {} : { format: form.format }),
    ...(role === "" ? {} : { interviewer_role: role }),
    ...(form.topics.length === 0 ? {} : { topics: [...form.topics] }),
    ...(otherTopics.length === 0 ? {} : { other_topics: otherTopics }),
    ...(notes === "" ? {} : { notes }),
    ...(neverSay.length === 0 ? {} : { never_say: neverSay }),
  };
}

/** A saved guide's details back in the form, to draft again from the same interview. */
export function interviewDetailsFormOf(details: InterviewDetails): InterviewDetailsForm {
  return {
    stage: details.stage,
    depth: details.depth,
    scheduledAt: details.scheduled_at ?? "",
    lengthMinutes: details.length_minutes === undefined ? "" : String(details.length_minutes),
    format: details.format ?? "",
    interviewerRole: details.interviewer_role ?? "",
    topics: [...(details.topics ?? [])],
    otherTopics: (details.other_topics ?? []).join("\n"),
    notes: details.notes ?? "",
    neverSay: (details.never_say ?? []).join("\n"),
  };
}

export const interviewGuideSectionLabels = (): Readonly<Record<InterviewGuideSection, string>> => ({
  "read-first": t`If you read one thing`,
  interview: t`The interview`,
  company: t`The company`,
  role: t`The role in plain words`,
  market: t`The state of the field`,
  matrix: t`What they ask for, and your proof`,
  pitch: t`Your pitch`,
  stories: t`Stories to tell`,
  defense: t`Weak points and how to answer`,
  questions: t`Likely questions`,
  ask: t`Questions to ask`,
  practical: t`Practical points to settle`,
  topic: t`Topics you asked to cover`,
  "never-say": t`Never say`,
  checklist: t`Before the interview`,
  sources: t`Sources`,
});

/** The parts of an extensive guide that can be written again, and the sections each holds. */
export const interviewGuideParts: Readonly<
  Record<InterviewGuidePart, readonly InterviewGuideSection[]>
> = {
  context: ["interview", "company", "role", "market"],
  story: ["pitch", "stories", "defense"],
  practice: ["read-first", "questions", "ask", "practical", "topic", "checklist"],
};

export const interviewGuidePartLabels = (): Readonly<Record<InterviewGuidePart, string>> => ({
  context: t`Write the interview, company, role and market again`,
  story: t`Write the pitch, stories and weak points again`,
  practice: t`Write the questions and checklist again`,
});

/** The part a section belongs to, or undefined for a section the server builds. */
export function interviewGuidePartOf(
  section: InterviewGuideSection,
): InterviewGuidePart | undefined {
  return (Object.keys(interviewGuideParts) as InterviewGuidePart[]).find((part) =>
    interviewGuideParts[part].includes(section),
  );
}

export interface InterviewGuideSectionView {
  readonly section: InterviewGuideSection;
  readonly title: string;
  /** Each item with its index in the draft, so an edit addresses the right one. */
  readonly items: readonly {
    readonly index: number;
    readonly item: ApplicationMaterialDraft["items"][number];
  }[];
}

/** A guide's items grouped by section, in the order the server saved them. */
export function interviewGuideSections(
  draft: ApplicationMaterialDraft,
): InterviewGuideSectionView[] {
  const labels = interviewGuideSectionLabels();
  const sections: InterviewGuideSectionView[] = [];
  draft.items.forEach((item, index) => {
    const section = item.section;
    if (section === undefined) return;
    const last = sections.at(-1);
    if (last?.section === section) {
      (last.items as { index: number; item: typeof item }[]).push({ index, item });
      return;
    }
    sections.push({ section, title: labels[section], items: [{ index, item }] });
  });
  return sections;
}

export const interviewGuideTopicLabels = (): Readonly<Record<string, string>> => ({
  company: t`the company`,
  news: t`recent news`,
  role: t`the role`,
  field: t`the field`,
  process: t`the hiring process`,
  salary: t`pay`,
});

/** What the guide says about topics research found no source for, or undefined when none. */
export function interviewGuideUnsourcedNote(draft: ApplicationMaterialDraft): string | undefined {
  const topics = draft.unsourced_topics ?? [];
  if (topics.length === 0) return undefined;
  const labels = interviewGuideTopicLabels();
  const named = topics.map((topic) => labels[topic] ?? topic).join(", ");
  return t`Research found no recent source on ${named}, so those sections state no fact. Check them yourself before the interview.`;
}

/** Named before the first guide: what is sent, what never is, and the research it may run. */
export const interviewGuideDisclosure = () =>
  t`A guide sends this application's job requirements, the career facts you allow for interviews and your interview details to Anthropic (Claude). Your name, contact details and never-say list are never sent. With research approved, the server first searches the public web for the employer, the role and the field, which nothing about you reaches.`;

export const interviewGuideRefusals = (): Readonly<Record<string, string>> => ({
  invalid_draft: t`No sentence of the guide about you was supported by your career record, so it was refused. Add facts to your record, or allow more of them for interviews.`,
  cost_cap_reached: t`This guide would pass the server's cost cap. Try the essential depth or the economy model.`,
});
