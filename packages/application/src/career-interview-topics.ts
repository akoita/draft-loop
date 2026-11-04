/**
 * The guided career interview's topic finder (#2174): what is worth talking about, from what the
 * career record and the candidate's own applications already hold. It is deterministic and makes no
 * model call; the conversation (#2176) phrases the proposals. The method guide is
 * `docs/reference/career-interview-method.md`.
 */

/** The parts of a canonical profile fact the finder reads. */
export interface CareerInterviewFact {
  readonly id: string;
  readonly category: string;
  readonly subjectId?: string | undefined;
  readonly field: string;
  readonly value: string;
}

/** A requirement from one of the candidate's own job posts. */
export interface CareerInterviewRequirement {
  readonly id: string;
  readonly applicationId: string;
  readonly text: string;
  readonly priority: "critical" | "high" | "medium" | "low";
}

export type CareerInterviewTopicKind =
  | "role-gap"
  | "untold-period"
  | "untold-theme"
  | "application-relevance";

export type CareerInterviewRoleGap = "dates" | "outcome" | "scope";

export interface CareerInterviewTopic {
  /**
   * Stable for the same record: it changes when the facts it read change, so a declined topic
   * returns only after the record does.
   */
  readonly key: string;
  readonly kind: CareerInterviewTopicKind;
  /** Why the topic is proposed, in plain words the interviewer can repeat. */
  readonly reason: string;
  readonly subjectId?: string;
  readonly missing?: readonly CareerInterviewRoleGap[];
  readonly period?: { readonly from: number; readonly to: number };
  readonly theme?: string;
  readonly factIds: readonly string[];
  readonly requirementIds: readonly string[];
}

export interface FindCareerInterviewTopicsInput {
  readonly facts: readonly CareerInterviewFact[];
  readonly requirements?: readonly CareerInterviewRequirement[];
  /** Keys of topics the candidate declined; an unchanged topic is not proposed again. */
  readonly declinedTopicKeys?: ReadonlySet<string> | readonly string[];
  readonly maximumTopics?: number;
}

export const defaultMaximumCareerInterviewTopics = 12;

const themes: readonly { readonly theme: string; readonly pattern: RegExp }[] = [
  { theme: "volunteering", pattern: /\bvolunteer(?:ing|ed)?\b|\bbénévol/iu },
  { theme: "mentoring", pattern: /\bmentor(?:ing|ed|ship)?\b|\bcoach(?:ing|ed)\b/iu },
  {
    theme: "teaching",
    pattern: /\bteach(?:ing)?\b|\btaught\b|\blectur(?:e|er|ing)\b|\btrainer\b/iu,
  },
  { theme: "speaking", pattern: /\bspeaker\b|\btalk at\b|\bconference talk\b|\bkeynote\b/iu },
  { theme: "awards", pattern: /\baward(?:s|ed)?\b|\bprize\b|\brecognition\b/iu },
  { theme: "open source", pattern: /\bopen[- ]source\b|\bmaintainer\b/iu },
  { theme: "side projects", pattern: /\bside project\b|\bpersonal project\b|\bhackathon\b/iu },
  { theme: "leadership", pattern: /\blead(?:er|ership)?\b|\bmanag(?:er|ed|ing)\b|\bhead of\b/iu },
];

const scopeField = /scope|team|responsib|budget|summary|description|mission/iu;
const yearPattern = /\b(19[5-9]\d|20\d{2})\b/gu;
const presentPattern = /\b(?:present|current|now|today|ongoing|aujourd(?:'|’)hui)\b/iu;

const stopWords = new Set([
  "about",
  "ability",
  "across",
  "after",
  "being",
  "between",
  "build",
  "experience",
  "experienced",
  "including",
  "knowledge",
  "least",
  "other",
  "skills",
  "strong",
  "their",
  "there",
  "these",
  "using",
  "where",
  "which",
  "while",
  "with",
  "within",
  "working",
  "years",
]);

/** FNV-1a over the facts a topic read, so its key follows the record without a crypto import. */
function fingerprint(parts: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const character of parts.join("\u0000")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function factParts(facts: readonly CareerInterviewFact[]): string[] {
  return facts.map((fact) => `${fact.id}=${fact.value}`).sort();
}

function significantWords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^\p{L}\p{N}+#]+/u)
        .filter((word) => word.length >= 5 && !stopWords.has(word)),
    ),
  ];
}

interface RoleSummary {
  readonly subjectId: string;
  readonly facts: readonly CareerInterviewFact[];
  readonly label: string;
  readonly from?: number;
  readonly to?: number;
  readonly missing: readonly CareerInterviewRoleGap[];
}

function summarizeRoles(facts: readonly CareerInterviewFact[], currentYear: number): RoleSummary[] {
  const bySubject = new Map<string, CareerInterviewFact[]>();
  for (const fact of facts) {
    if (fact.subjectId === undefined) continue;
    const group = bySubject.get(fact.subjectId) ?? [];
    group.push(fact);
    bySubject.set(fact.subjectId, group);
  }
  const roles: RoleSummary[] = [];
  for (const [subjectId, group] of bySubject) {
    if (!group.some((fact) => fact.category === "role")) continue;
    const title = group.find((fact) => fact.category === "role")?.value;
    const employer = group.find((fact) => fact.category === "employer")?.value;
    const label = [title, employer].filter((part) => part !== undefined).join(" at ");
    const dates = group.filter((fact) => fact.category === "date");
    const years = dates.flatMap((fact) =>
      [...fact.value.matchAll(yearPattern)].map((match) => Number(match[0])),
    );
    const ongoing = dates.some((fact) => presentPattern.test(fact.value));
    const missing: CareerInterviewRoleGap[] = [];
    if (years.length === 0) missing.push("dates");
    if (!group.some((fact) => fact.category === "achievement")) missing.push("outcome");
    if (!group.some((fact) => fact.category !== "date" && scopeField.test(fact.field))) {
      missing.push("scope");
    }
    roles.push({
      subjectId,
      facts: group,
      label: label === "" ? "a role" : label,
      ...(years.length === 0
        ? {}
        : { from: Math.min(...years), to: ongoing ? currentYear : Math.max(...years) }),
      missing,
    });
  }
  return roles;
}

const missingWords: Record<CareerInterviewRoleGap, string> = {
  dates: "when it happened",
  outcome: "what changed thanks to your work",
  scope: "what the role covered",
};

function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

interface RankedTopic {
  readonly topic: CareerInterviewTopic;
  readonly relevance: number;
  readonly recency: number;
  readonly order: number;
}

const kindOrder: Record<CareerInterviewTopicKind, number> = {
  "application-relevance": 0,
  "role-gap": 1,
  "untold-period": 2,
  "untold-theme": 3,
};

const priorityWeight: Record<CareerInterviewRequirement["priority"], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Topics worth proposing, most relevant to the candidate's applications first, then most recent.
 * An empty list is a valid answer: the interviewer proposes nothing when nothing is worth it.
 */
export function findCareerInterviewTopics(
  input: FindCareerInterviewTopicsInput,
  currentYear: number = new Date().getUTCFullYear(),
): CareerInterviewTopic[] {
  const requirements = input.requirements ?? [];
  const declined = new Set(input.declinedTopicKeys ?? []);
  const facts = input.facts;
  const requirementWords = requirements.map((requirement) => ({
    requirement,
    words: significantWords(requirement.text),
  }));
  const relevanceOf = (text: string): { score: number; ids: string[] } => {
    const words = new Set(significantWords(text));
    let score = 0;
    const ids: string[] = [];
    for (const { requirement, words: required } of requirementWords) {
      if (required.some((word) => words.has(word))) {
        score += priorityWeight[requirement.priority];
        ids.push(requirement.id);
      }
    }
    return { score, ids };
  };
  const ranked: RankedTopic[] = [];
  const roles = summarizeRoles(facts, currentYear);

  for (const role of roles) {
    if (role.missing.length === 0) continue;
    const relevance = relevanceOf(role.facts.map((fact) => fact.value).join(" "));
    ranked.push({
      topic: {
        key: `role-gap:${role.subjectId}:${fingerprint(factParts(role.facts))}`,
        kind: "role-gap",
        reason: `Your record names ${role.label} but not ${listWords(role.missing.map((gap) => missingWords[gap]))}.`,
        subjectId: role.subjectId,
        missing: role.missing,
        factIds: role.facts.map((fact) => fact.id),
        requirementIds: relevance.ids,
      },
      relevance: relevance.score,
      recency: role.to ?? 0,
      order: kindOrder["role-gap"],
    });
  }

  const dated = roles
    .filter((role) => role.from !== undefined && role.to !== undefined)
    .sort((left, right) => (left.from ?? 0) - (right.from ?? 0));
  let coveredUntil: number | undefined;
  let previous: RoleSummary | undefined;
  for (const role of dated) {
    const from = role.from ?? 0;
    if (coveredUntil !== undefined && previous !== undefined && from - coveredUntil > 1) {
      const period = { from: coveredUntil + 1, to: from - 1 };
      const read = [...previous.facts, ...role.facts].filter((fact) => fact.category === "date");
      ranked.push({
        topic: {
          key: `untold-period:${period.from}-${period.to}:${fingerprint(factParts(read))}`,
          kind: "untold-period",
          reason:
            period.from === period.to
              ? `Your record says nothing about ${period.from}.`
              : `Your record says nothing between ${period.from} and ${period.to}.`,
          period,
          factIds: read.map((fact) => fact.id),
          requirementIds: [],
        },
        relevance: 0,
        recency: period.to,
        order: kindOrder["untold-period"],
      });
    }
    if (coveredUntil === undefined || (role.to ?? 0) > coveredUntil) {
      coveredUntil = role.to;
      previous = role;
    }
  }

  const achievements = facts.filter((fact) => fact.category === "achievement");
  for (const { theme, pattern } of themes) {
    const hints = facts.filter(
      (fact) => fact.category !== "achievement" && pattern.test(fact.value),
    );
    if (hints.length === 0) continue;
    if (achievements.some((fact) => pattern.test(fact.value))) continue;
    const relevance = relevanceOf(hints.map((fact) => fact.value).join(" "));
    ranked.push({
      topic: {
        key: `untold-theme:${theme}:${fingerprint(factParts(hints))}`,
        kind: "untold-theme",
        theme,
        reason: `Your record mentions ${theme} but tells no story about it.`,
        factIds: hints.map((fact) => fact.id),
        requirementIds: relevance.ids,
      },
      relevance: relevance.score,
      recency: 0,
      order: kindOrder["untold-theme"],
    });
  }

  const recordWords = new Set(significantWords(facts.map((fact) => fact.value).join(" ")));
  for (const { requirement, words } of requirementWords) {
    if (words.length === 0 || words.some((word) => recordWords.has(word))) continue;
    ranked.push({
      topic: {
        key: `application-relevance:${requirement.applicationId}:${requirement.id}:${fingerprint([requirement.text, ...factParts(facts)])}`,
        kind: "application-relevance",
        reason: `A job you applied for asks for "${requirement.text}", and your record does not show it yet.`,
        factIds: [],
        requirementIds: [requirement.id],
      },
      relevance: priorityWeight[requirement.priority],
      recency: 0,
      order: kindOrder["application-relevance"],
    });
  }

  return ranked
    .filter((entry) => !declined.has(entry.topic.key))
    .sort(
      (left, right) =>
        right.relevance - left.relevance ||
        right.recency - left.recency ||
        left.order - right.order ||
        left.topic.key.localeCompare(right.topic.key),
    )
    .slice(0, input.maximumTopics ?? defaultMaximumCareerInterviewTopics)
    .map((entry) => entry.topic);
}
