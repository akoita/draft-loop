import type { CandidateKnowledgeRetrievalStatus, ScoredEvidenceChunk } from "@draft-loop/domain";
import type { AuthorArtifactProposal } from "@draft-loop/schemas";

const sectionTokenPattern = /[\p{L}\p{N}]+/gu;
const unavailableSectionTextPattern =
  /\b(?:unavailable|not\s+available|not\s+provided|not\s+listed|not\s+specified|unknown|none(?:\s+(?:listed|provided|specified))?|no\s+(?:information|details?|data|records?|content|entries?)|not\s+applicable)\b|\bn\s*\/\s*a\b/iu;

interface SectionVocabulary {
  readonly identities: readonly string[];
  readonly queryTerms: readonly string[];
  readonly evidenceTerms: readonly string[];
}

const sectionVocabularies: readonly SectionVocabulary[] = Object.freeze([
  {
    identities: ["summary", "professionalsummary", "profile", "objective", "overview"],
    queryTerms: ["summary", "profile", "objective", "overview", "headline"],
    evidenceTerms: ["summary", "profile", "objective", "overview", "headline"],
  },
  {
    identities: [
      "experience",
      "professionalexperience",
      "workexperience",
      "employment",
      "employmenthistory",
      "workhistory",
      "roles",
    ],
    queryTerms: [
      "experience",
      "employment",
      "work",
      "career",
      "role",
      "position",
      "organisation",
      "organization",
      "period",
      "engineer",
    ],
    evidenceTerms: [
      "experience",
      "employment",
      "career",
      "role",
      "position",
      "organisation",
      "organization",
      "period",
      "engineer",
    ],
  },
  {
    identities: [
      "education",
      "academicbackground",
      "academicexperience",
      "qualifications",
      "degrees",
    ],
    queryTerms: [
      "education",
      "academic",
      "degree",
      "degrees",
      "bachelor",
      "master",
      "msc",
      "bsc",
      "phd",
      "doctorate",
      "university",
      "college",
      "school",
      "studied",
    ],
    evidenceTerms: [
      "education",
      "academic",
      "degree",
      "degrees",
      "bachelor",
      "master",
      "msc",
      "bsc",
      "phd",
      "doctorate",
      "university",
      "college",
      "school",
      "studied",
    ],
  },
  {
    identities: [
      "certification",
      "certifications",
      "certificate",
      "certificates",
      "certified",
      "credential",
      "credentials",
      "licenses",
      "licensesandcertifications",
    ],
    queryTerms: [
      "certification",
      "certifications",
      "certificate",
      "certificates",
      "certified",
      "credential",
      "credentials",
      "license",
      "licensed",
      "training",
    ],
    evidenceTerms: [
      "certification",
      "certifications",
      "certificate",
      "certificates",
      "certified",
      "credential",
      "credentials",
      "license",
      "licensed",
      "training",
    ],
  },
  {
    identities: ["language", "languages", "spokenlanguages", "languageskills"],
    queryTerms: [
      "language",
      "languages",
      "fluent",
      "fluency",
      "native",
      "proficient",
      "english",
      "french",
      "german",
      "spanish",
      "italian",
      "portuguese",
      "dutch",
      "mandarin",
      "japanese",
      "korean",
      "arabic",
      "russian",
    ],
    evidenceTerms: [
      "language",
      "languages",
      "fluent",
      "fluency",
      "native",
      "proficient",
      "english",
      "french",
      "german",
      "spanish",
      "italian",
      "portuguese",
      "dutch",
      "mandarin",
      "japanese",
      "korean",
      "arabic",
      "russian",
    ],
  },
  {
    identities: ["skill", "skills", "technicalskills", "technologies", "techstack", "tools"],
    queryTerms: [
      "skill",
      "skills",
      "technology",
      "technologies",
      "technical",
      "stack",
      "programming",
    ],
    evidenceTerms: [
      "skill",
      "skills",
      "technology",
      "technologies",
      "technical",
      "stack",
      "programming",
    ],
  },
  {
    identities: ["project", "projects", "portfolio", "selectedprojects", "personalprojects"],
    queryTerms: [
      "project",
      "projects",
      "portfolio",
      "prototype",
      "prototypes",
      "experiment",
      "experiments",
    ],
    evidenceTerms: [
      "project",
      "projects",
      "portfolio",
      "prototype",
      "prototypes",
      "experiment",
      "experiments",
    ],
  },
]);

export interface RequiredSectionQuery {
  readonly section: string;
  readonly query: string;
}

export interface RequiredSectionRetrievalResult {
  readonly status: CandidateKnowledgeRetrievalStatus;
  readonly hits: readonly ScoredEvidenceChunk[];
}

export interface RequiredSectionSupplement {
  readonly section: string;
  readonly result: RequiredSectionRetrievalResult;
}

export interface RequiredSectionProposalIssue {
  readonly path: PropertyKey[];
  readonly code: "required_section_evidence_omitted";
  readonly message: string;
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function sectionIdentity(value: string): string {
  return normalized(value).replace(/\s+/gu, "").trim();
}

function tokens(value: string): readonly string[] {
  return normalized(value).match(sectionTokenPattern) ?? [];
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim() !== ""))];
}

function vocabularyFor(section: string): SectionVocabulary | undefined {
  const identity = sectionIdentity(section);
  return sectionVocabularies.find((vocabulary) => vocabulary.identities.includes(identity));
}

function sectionQueryTerms(section: string): readonly string[] {
  const vocabulary = vocabularyFor(section);
  return unique([...(tokens(section) ?? []), ...(vocabulary?.queryTerms ?? [])]).slice(0, 32);
}

function evidenceTermsFor(section: string): readonly string[] {
  const vocabulary = vocabularyFor(section);
  return unique([...(tokens(section) ?? []), ...(vocabulary?.evidenceTerms ?? [])]);
}

function textHasTerm(text: string, term: string): boolean {
  const normalizedTerm = normalized(term);
  if (normalizedTerm.includes(" ")) return normalized(text).includes(normalizedTerm);
  return new Set(tokens(text)).has(normalizedTerm);
}

function headingIdentity(value: string): string {
  return sectionIdentity(value.replace(/^\s*#{1,6}\s*/u, "").replace(/[:\-–—]\s*$/u, ""));
}

function hasContentBeyondHeading(section: string, text: string): boolean {
  return contentClauses(section, text).length > 0;
}

/** Missing details are local to their clause, not evidence that the whole section is absent. */
function contentClauses(section: string, text: string): readonly string[] {
  return text
    .split(/[\n;,]|\.\s+/u)
    .map((clause) => clause.trim())
    .filter(
      (clause) =>
        tokens(clause).length > 0 &&
        headingIdentity(clause.replace(/\.$/u, "")) !== sectionIdentity(section) &&
        !unavailableSectionTextPattern.test(clause) &&
        !/^(?:[-*]\s*)?no\b/iu.test(clause),
    );
}

/** Build a bounded lexical query for one required section. */
export function requiredSectionQuery(section: string): string {
  return sectionQueryTerms(section).join(" ").slice(0, 1_000);
}

/** Reserve at most one supplementary query slot for each required section. */
export function requiredSectionQueries(
  requiredSections: readonly string[],
  limit: number,
): readonly RequiredSectionQuery[] {
  const maximum = Math.max(0, limit - 1);
  const seen = new Set<string>();
  const queries: RequiredSectionQuery[] = [];
  for (const section of requiredSections) {
    const trimmed = section.trim();
    const identity = sectionIdentity(trimmed);
    if (trimmed === "" || seen.has(identity) || queries.length >= maximum) continue;
    seen.add(identity);
    queries.push({ section: trimmed, query: requiredSectionQuery(trimmed) });
  }
  return Object.freeze(queries.map((query) => Object.freeze(query)));
}

/** Identify retrieved source content that can support a required section. */
export function matchesRequiredSectionEvidence(section: string, text: string): boolean {
  const sectionTerms = evidenceTermsFor(section);
  const clauses = contentClauses(section, text);
  if (clauses.length === 0) return false;
  const hasHeading = text
    .split(/\r?\n/u)
    .some((line) => headingIdentity(line) === sectionIdentity(section));
  return (
    hasHeading || clauses.some((clause) => sectionTerms.some((term) => textHasTerm(clause, term)))
  );
}

export function hasRequiredSectionEvidence(
  section: string,
  retrievedEvidence: readonly ScoredEvidenceChunk[],
): boolean {
  return retrievedEvidence.some((chunk) => matchesRequiredSectionEvidence(section, chunk.text));
}

function matchesRequiredSection(
  section: AuthorArtifactProposal["sections"][number],
  requiredSection: string,
): boolean {
  const identity = sectionIdentity(requiredSection);
  return sectionIdentity(section.title) === identity || sectionIdentity(section.kind) === identity;
}

function sectionHasContent(
  section: AuthorArtifactProposal["sections"][number],
  requiredSection: string,
): boolean {
  return section.blocks.some((block) => {
    const text = block.text.trim();
    return (
      hasContentBeyondHeading(requiredSection, text) &&
      hasContentBeyondHeading(section.title, text) &&
      headingIdentity(text) !== sectionIdentity(requiredSection) &&
      headingIdentity(text) !== sectionIdentity(section.title)
    );
  });
}

/** Reject provider placeholders only when the selected evidence establishes content. */
export function requiredSectionProposalIssues(
  proposal: AuthorArtifactProposal,
  requiredSections: readonly string[],
  retrievedEvidence: readonly ScoredEvidenceChunk[],
): readonly RequiredSectionProposalIssue[] {
  const issues: RequiredSectionProposalIssue[] = [];
  for (const requiredSection of requiredSections) {
    if (!hasRequiredSectionEvidence(requiredSection, retrievedEvidence)) continue;
    const sectionIndex = proposal.sections.findIndex((section) =>
      matchesRequiredSection(section, requiredSection),
    );
    const section = sectionIndex < 0 ? undefined : proposal.sections[sectionIndex];
    if (section !== undefined && sectionHasContent(section, requiredSection)) continue;
    issues.push({
      path: sectionIndex < 0 ? ["sections"] : ["sections", sectionIndex],
      code: "required_section_evidence_omitted",
      message: "required section omits content established by retrieved candidate evidence",
    });
  }
  return Object.freeze(issues.map((issue) => Object.freeze(issue)));
}

/** Merge primary retrieval with matched, one-hit-per-section supplementary results. */
export function mergeRequiredSectionEvidence(
  primary: RequiredSectionRetrievalResult,
  supplements: readonly RequiredSectionSupplement[],
  limit: number,
): readonly ScoredEvidenceChunk[] {
  if (limit < 1) return [];
  const primaryById = new Map<string, ScoredEvidenceChunk>();
  for (const hit of primary.hits) {
    if (!primaryById.has(hit.id)) primaryById.set(hit.id, hit);
  }
  const requiredHits: ScoredEvidenceChunk[] = [];
  const requiredIds = new Set(primaryById.keys());
  for (const supplement of supplements) {
    if (supplement.result.status !== "matched") continue;
    const hit = supplement.result.hits.find((candidate) =>
      matchesRequiredSectionEvidence(supplement.section, candidate.text),
    );
    if (hit === undefined || requiredIds.has(hit.id)) continue;
    requiredIds.add(hit.id);
    requiredHits.push(hit);
  }

  const selected: ScoredEvidenceChunk[] = [
    ...[...primaryById.values()].slice(0, Math.max(0, limit - requiredHits.length)),
    ...requiredHits,
  ];
  const selectedIds = new Set(selected.map((hit) => hit.id));
  for (const supplement of supplements) {
    if (selected.length >= limit || supplement.result.status !== "matched") break;
    for (const hit of supplement.result.hits) {
      if (selected.length >= limit) break;
      if (selectedIds.has(hit.id) || !matchesRequiredSectionEvidence(supplement.section, hit.text))
        continue;
      selectedIds.add(hit.id);
      selected.push(hit);
    }
  }
  return Object.freeze(selected.slice(0, limit));
}
