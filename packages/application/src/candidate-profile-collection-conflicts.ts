import type {
  CanonicalCandidateProfileFact,
  CanonicalCandidateProfileFactCategory,
} from "@draft-loop/domain";

import { normalizedSemantic } from "./canonical-profile-fact-keys.js";

const period = [
  "period",
  "dates",
  "date range",
  "duration",
  "employment period",
  "employment dates",
];
const startEnd = ["start date", "end date", "start", "end", "start year", "end year"];

/**
 * Fields that hold at most one value for one subject, per category. Two differing values in
 * one of these fields are a deterministic conflict. Every other field is a collection (revisions,
 * studies, confirmations, events, notes) and may hold several distinct values.
 */
const singleValuedFields: Readonly<
  Partial<Record<CanonicalCandidateProfileFactCategory, ReadonlySet<string>>>
> = {
  identity: new Set(["name", "full name", "legal name", "headline", "location"]),
  contact: new Set(["email", "email address", "phone", "phone number", "address", "location"]),
  role: new Set([
    "title",
    "role title",
    "job title",
    "position",
    "position title",
    "location",
    "employment type",
    ...startEnd,
    ...period,
  ]),
  employer: new Set(["name", "employer", "employer name", "company", "company name", "location"]),
  date: new Set([...startEnd, ...period]),
  education: new Set([
    "degree",
    "institution",
    "school",
    "university",
    "field of study",
    "location",
    "graduation date",
    "graduation year",
    ...startEnd,
    ...period,
  ]),
  certification: new Set([
    "certification",
    "name",
    "issuer",
    "issuing organization",
    "date",
    "issue date",
    "issued date",
    "expiry date",
    "expiration date",
  ]),
  achievement: new Set(["metric", "metric value", "percentage", "amount", "count", "revenue"]),
  project: new Set(["name", "title"]),
  language: new Set(["proficiency", "level"]),
  "approved-link": new Set(["url", "link"]),
};

function singularFieldKey(field: string): string {
  return normalizedSemantic(field.replace(/[-_/]+/gu, " "));
}

/**
 * Whether a fact belongs to a group that may legitimately hold several distinct values.
 * Skills and unscoped certifications are always collections; elsewhere only the known
 * single-valued fields of the category can conflict.
 */
export function isCandidateProfileCollectionFact(
  fact: Pick<CanonicalCandidateProfileFact, "category" | "field"> & {
    readonly subjectId?: string | undefined;
  },
): boolean {
  if (fact.category === "skill") return true;
  if (fact.category === "certification" && fact.subjectId === undefined) return true;
  return !(singleValuedFields[fact.category]?.has(singularFieldKey(fact.field)) ?? false);
}
