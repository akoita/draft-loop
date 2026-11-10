/**
 * Web research for an interview preparation guide (#2617). A guide always researches first: the
 * employer, the job and its team, the state of the role's field and, for an extensive guide or a
 * topic that asks for it, the hiring process and pay. Sources must be recent, and each is rated
 * so the guide can rank official sources above the press and the press above forums. The plan
 * reads nothing about the candidate: only the employer, the role and the interview's shape.
 */

import type { InterviewDetails } from "@draft-loop/schemas/interview-details";
import type {
  ResearchBrief,
  ResearchReliability,
  ResearchTopic,
} from "@draft-loop/schemas/research-brief";

import type { ResearchQuery, ResearchSubject } from "./research-run.js";

/** How far back a guide's sources may date: a year, two for reports on how a company hires. */
export const interviewGuideWindowMonths = 12;
export const interviewGuideProcessWindowMonths = 24;
/** The research cost caps per depth; the writer's own cap is separate. */
export const interviewGuideResearchMaxCostUsd = { essential: 0.08, extensive: 0.15 } as const;
/** A brief younger than this is reused instead of searching again. */
export const interviewGuideResearchReuseDays = 14;

/** The topics a guide of each depth needs sources for. */
export function interviewGuideResearchTopics(
  details: Pick<InterviewDetails, "depth" | "topics">,
): ResearchTopic[] {
  const topics: ResearchTopic[] =
    details.depth === "essential"
      ? ["company", "role", "field"]
      : ["company", "news", "role", "field", "process"];
  if (details.topics?.includes("salary")) topics.push("salary");
  return topics;
}

/** The searches a guide makes, one per topic, each with its window. */
export function interviewGuideResearchQueries(
  subject: ResearchSubject,
  details: Pick<InterviewDetails, "depth" | "topics">,
  now: Date,
): ResearchQuery[] {
  const employer = subject.employer.trim();
  const role = subject.role.trim();
  const where = subject.country?.trim() ? ` ${subject.country.trim()}` : "";
  const year = now.getUTCFullYear();
  const words: Readonly<Record<ResearchTopic, string>> = {
    company: `${employer} ${role}${where}`,
    news: `${employer} news ${year}`,
    role: `${employer} careers ${role} team`,
    field: `${role} trends ${year}${where}`,
    process: `${employer} interview process ${role}`,
    salary: `${role} salary${where} ${year}`,
  };
  return interviewGuideResearchTopics(details).map((topic) => ({
    query: words[topic].replace(/\s+/gu, " ").trim(),
    topic,
    windowMonths:
      topic === "process" ? interviewGuideProcessWindowMonths : interviewGuideWindowMonths,
  }));
}

/** Sites whose pages are reports or opinions, never an official statement, by their name. */
const weakSites = new Set([
  "reddit",
  "quora",
  "glassdoor",
  "indeed",
  "medium",
  "substack",
  "teamblind",
  "twitter",
  "facebook",
  "youtube",
  "tiktok",
]);

/** Public bodies: governments, the EU, central banks, regulators and standards bodies. */
const officialHosts = [
  ".gov",
  ".gouv.fr",
  "europa.eu",
  "ecb.europa.eu",
  "bis.org",
  "imf.org",
  "oecd.org",
];

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./u, "");
  } catch {
    return undefined;
  }
}

/** The employer's name as it may appear in its own domain: letters and digits only. */
function domainWord(employer: string): string {
  return employer
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "");
}

/**
 * How far a source can be trusted, from its address only: the employer's own site or a public
 * body is primary, a forum, review site, blog or social network is weak, the rest is press.
 */
export function researchSourceReliability(url: string, employer: string): ResearchReliability {
  const host = hostOf(url);
  if (host === undefined) return "weak";
  const labels = host.split(".");
  if (host === "x.com" || labels.slice(0, -1).some((label) => weakSites.has(label))) {
    return "weak";
  }
  if (officialHosts.some((official) => host.endsWith(official))) return "primary";
  const word = domainWord(employer);
  if (word.length >= 3 && labels.slice(0, -1).some((label) => label.replace(/-/gu, "") === word)) {
    return "primary";
  }
  return "press";
}

/** The research plan `runResearch` takes for a guide. */
export function interviewGuideResearchPlan(
  subject: ResearchSubject,
  details: Pick<InterviewDetails, "depth" | "topics">,
  now: Date,
): {
  readonly queries: readonly ResearchQuery[];
  readonly reliabilityOf: (url: string) => ResearchReliability;
  readonly maxCostUsd: number;
} {
  return {
    queries: interviewGuideResearchQueries(subject, details, now),
    reliabilityOf: (url) => researchSourceReliability(url, subject.employer),
    maxCostUsd: interviewGuideResearchMaxCostUsd[details.depth],
  };
}

/**
 * The topics a guide needs that the brief kept no source for. The guide marks their sections as
 * unsourced and keeps them short; it never fills them from the model's memory.
 */
export function interviewGuideMissingTopics(
  brief: Pick<ResearchBrief, "sources"> | undefined,
  details: Pick<InterviewDetails, "depth" | "topics">,
): ResearchTopic[] {
  const covered = new Set(brief?.sources.flatMap((source) => source.topic ?? []) ?? []);
  return interviewGuideResearchTopics(details).filter((topic) => !covered.has(topic));
}

/**
 * Whether a guide can reuse the application's newest brief instead of searching again: it is
 * recent and already covers every topic the guide needs.
 */
export function interviewGuideCanReuseBrief(
  brief: Pick<ResearchBrief, "sources" | "created_at"> | undefined,
  details: Pick<InterviewDetails, "depth" | "topics">,
  now: Date,
): boolean {
  if (brief === undefined) return false;
  const ageDays = (now.getTime() - Date.parse(brief.created_at)) / 86_400_000;
  return (
    ageDays >= 0 &&
    ageDays <= interviewGuideResearchReuseDays &&
    interviewGuideMissingTopics(brief, details).length === 0
  );
}
