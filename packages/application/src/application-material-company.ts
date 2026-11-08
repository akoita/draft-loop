import type { ResearchBrief } from "@draft-loop/schemas/research-brief";

/**
 * Company facts for application material (#2544): the newest research brief's findings, offered to
 * the drafter as context about the employer. A finding may support a statement about the company,
 * never a claim about the candidate, which still cites career facts only.
 */

/** One finding about the employer, as the drafter may cite it. */
export interface ApplicationMaterialCompanyFact {
  /** The finding's id in its brief, such as `fnd_1`. */
  readonly id: string;
  readonly text: string;
  /** The newest publication date among the finding's sources, `YYYY-MM-DD`, when any has one. */
  readonly publishedOn?: string;
}

export const maximumApplicationMaterialCompanyFacts = 12;
const maximumCompanyFactCharacters = 400;

/** The company facts that reach the model: capped in number and length. */
export function boundedCompanyFacts(
  facts: readonly ApplicationMaterialCompanyFact[] | undefined,
): ApplicationMaterialCompanyFact[] {
  return (facts ?? [])
    .filter((fact) => fact.text.trim() !== "")
    .slice(0, maximumApplicationMaterialCompanyFacts)
    .map((fact) => ({
      id: fact.id,
      text: fact.text.trim().slice(0, maximumCompanyFactCharacters),
      ...(fact.publishedOn === undefined ? {} : { publishedOn: fact.publishedOn }),
    }));
}

/** A brief's findings as company facts, each dated by its newest cited source. */
export function researchCompanyFacts(brief: ResearchBrief): ApplicationMaterialCompanyFact[] {
  const dates = new Map(brief.sources.map((source) => [source.id, source.published_on]));
  return brief.findings.map((finding) => {
    const newest = finding.source_ids
      .map((id) => dates.get(id))
      .filter((date): date is string => date !== undefined)
      .sort()
      .at(-1);
    return {
      id: finding.id,
      text: finding.text,
      ...(newest === undefined ? {} : { publishedOn: newest }),
    };
  });
}

export type CompanyFactViolationCode = "unknown_company_fact" | "company_fact_as_candidate_fact";

/**
 * What an item breaks with its company citations: a finding cited as a career fact, which would
 * let a fact about the employer stand for the candidate, or a finding the context does not hold.
 */
export function companyFactViolations(
  item: { readonly factIds: readonly string[]; readonly companyFactIds?: readonly string[] },
  index: number,
  offered: ReadonlySet<string>,
): { readonly code: CompanyFactViolationCode; readonly item: number; readonly detail: string }[] {
  const violations: {
    readonly code: CompanyFactViolationCode;
    readonly item: number;
    readonly detail: string;
  }[] = [];
  for (const id of item.factIds) {
    if (offered.has(id)) {
      violations.push({
        code: "company_fact_as_candidate_fact",
        item: index,
        detail: `The item cites company fact ${id} as a career fact; cite it in company_fact_ids, and only for a statement about the company.`,
      });
    }
  }
  for (const id of item.companyFactIds ?? []) {
    if (!offered.has(id)) {
      violations.push({
        code: "unknown_company_fact",
        item: index,
        detail: `The item cites company fact ${id}, which the research brief does not hold.`,
      });
    }
  }
  return violations;
}
