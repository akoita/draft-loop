/**
 * Application material (#2215): one cover letter or one set of interview questions for an
 * application, drafted from the career record by a model behind `ApplicationMaterialPort`. The
 * module is pure: it builds the bounded context, asks the port, and refuses any draft that cites a
 * fact the candidate did not allow or states a number no cited fact holds. It never stores a draft.
 */

/** The parts of a canonical profile fact the drafter reads. */
export interface ApplicationMaterialFact {
  readonly id: string;
  readonly category: string;
  readonly field: string;
  readonly value: string;
}

/** A requirement from the application's job post: untrusted third-party text. */
export interface ApplicationMaterialRequirement {
  readonly id: string;
  readonly text: string;
  readonly priority: "critical" | "high" | "medium" | "low";
}

export const applicationMaterialKinds = ["cover-letter", "interview-questions"] as const;
export type ApplicationMaterialKind = (typeof applicationMaterialKinds)[number];

/** What reaches the model: allowed facts and the application's requirements, bounded. */
export interface ApplicationMaterialContext {
  readonly kind: ApplicationMaterialKind;
  readonly facts: readonly { readonly id: string; readonly text: string }[];
  readonly requirements: readonly {
    readonly id: string;
    readonly text: string;
    readonly priority: ApplicationMaterialRequirement["priority"];
  }[];
}

/**
 * One paragraph of a cover letter, or one interview question with its talking point. `question`
 * is empty for a cover letter paragraph.
 */
export interface ApplicationMaterialItem {
  readonly question: string;
  readonly text: string;
  readonly factIds: readonly string[];
}

export interface ApplicationMaterialModelIdentity {
  readonly provider: string;
  readonly model: string;
}

export interface ApplicationMaterialRequest {
  readonly context: ApplicationMaterialContext;
  /** Rules the previous attempt broke, so the model can avoid them; empty on the first call. */
  readonly refusedRules: readonly string[];
}

export interface ApplicationMaterialReply {
  readonly items: readonly ApplicationMaterialItem[];
  readonly model?: ApplicationMaterialModelIdentity;
}

/** Anything that drafts application material, such as a model adapter or a scripted fake. */
export interface ApplicationMaterialPort {
  draft(request: ApplicationMaterialRequest): Promise<ApplicationMaterialReply>;
}

export interface ApplicationMaterialDraft {
  readonly kind: ApplicationMaterialKind;
  readonly items: readonly ApplicationMaterialItem[];
  readonly model?: ApplicationMaterialModelIdentity;
}

export type ApplicationMaterialViolationCode =
  | "empty_draft"
  | "too_many_items"
  | "text_too_long"
  | "missing_question"
  | "missing_citation"
  | "unknown_fact"
  | "fact_not_allowed"
  | "unsupported_number";

export interface ApplicationMaterialViolation {
  readonly code: ApplicationMaterialViolationCode;
  /** The item's position in the draft, when the violation belongs to one item. */
  readonly item?: number;
  readonly detail: string;
}

export class ApplicationMaterialError extends Error {
  readonly code: "no_facts" | "invalid_draft";
  readonly violations: readonly ApplicationMaterialViolation[];

  constructor(
    code: "no_facts" | "invalid_draft",
    message: string,
    violations: readonly ApplicationMaterialViolation[] = [],
  ) {
    super(message);
    this.name = "ApplicationMaterialError";
    this.code = code;
    this.violations = violations;
  }
}

/** The categories the drafter never needs: who the candidate is and how to reach them. */
export const withheldApplicationMaterialCategories: ReadonlySet<string> = new Set([
  "identity",
  "contact",
]);
export const maximumApplicationMaterialFacts = 60;
export const maximumApplicationMaterialRequirements = 20;
const maximumContextCharacters = 300;
export const maximumApplicationMaterialItems: Readonly<Record<ApplicationMaterialKind, number>> = {
  "cover-letter": 6,
  "interview-questions": 10,
};
export const maximumApplicationMaterialItemCharacters = 1_200;

export interface ApplicationMaterialContextInput {
  readonly kind: ApplicationMaterialKind;
  readonly facts: readonly ApplicationMaterialFact[];
  readonly requirements: readonly ApplicationMaterialRequirement[];
  /** The host's sensitivity rules: whether a fact may reach the provider. */
  readonly mayTransmit?: (fact: ApplicationMaterialFact) => boolean;
}

/** Whether the candidate allowed a fact to reach the model: never identity or contact. */
function allowedFact(input: ApplicationMaterialContextInput, fact: ApplicationMaterialFact) {
  return (
    !withheldApplicationMaterialCategories.has(fact.category) &&
    (input.mayTransmit === undefined || input.mayTransmit(fact))
  );
}

const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 } as const;

/**
 * The bounded context: allowed facts, then the job's requirements by priority. Each entry is
 * capped in length; the requirements are data for the model, never instructions.
 */
export function applicationMaterialContext(
  input: ApplicationMaterialContextInput,
): ApplicationMaterialContext {
  const facts = input.facts
    .filter((fact) => allowedFact(input, fact))
    .slice(0, maximumApplicationMaterialFacts)
    .map((fact) => ({
      id: fact.id,
      text: `${fact.category} ${fact.field}: ${fact.value}`.slice(0, maximumContextCharacters),
    }));
  const requirements = [...input.requirements]
    .sort((left, right) => priorityOrder[left.priority] - priorityOrder[right.priority])
    .slice(0, maximumApplicationMaterialRequirements)
    .map((requirement) => ({
      id: requirement.id,
      text: requirement.text.slice(0, maximumContextCharacters),
      priority: requirement.priority,
    }));
  return { kind: input.kind, facts, requirements };
}

const numberPattern = /\d+(?:[.,]\d+)*/gu;

function numbersIn(text: string): string[] {
  return [...text.matchAll(numberPattern)].map((match) => match[0]);
}

/** Whether a number stated in the draft appears, as a whole number, in one of the sources. */
function supported(number: string, sources: readonly string[]): boolean {
  const pattern = new RegExp(
    `(?<![\\d.,])${number.replace(/[.,]/gu, "[.,]")}(?![\\d]|[.,]\\d)`,
    "u",
  );
  return sources.some((source) => pattern.test(source));
}

/**
 * Every rule a draft breaks. A paragraph or talking point cites at least one fact of the context;
 * a fact outside the allowed set, even one the record holds, is refused; every number in the text
 * appears in a cited fact. A question may also repeat a number from the job's requirements.
 */
export function applicationMaterialViolations(
  input: ApplicationMaterialContextInput,
  items: readonly ApplicationMaterialItem[],
): ApplicationMaterialViolation[] {
  const context = applicationMaterialContext(input);
  const sent = new Set(context.facts.map((fact) => fact.id));
  const allowed = new Map(
    input.facts.filter((fact) => sent.has(fact.id)).map((fact) => [fact.id, fact]),
  );
  const known = new Set(input.facts.map((fact) => fact.id));
  const requirementTexts = context.requirements.map((requirement) => requirement.text);
  const violations: ApplicationMaterialViolation[] = [];
  if (items.length === 0) {
    return [{ code: "empty_draft", detail: "The draft has no paragraph or question." }];
  }
  const maximum = maximumApplicationMaterialItems[input.kind];
  if (items.length > maximum) {
    violations.push({
      code: "too_many_items",
      detail: `The draft has ${items.length} items; at most ${maximum} are allowed.`,
    });
  }
  items.forEach((item, index) => {
    if (
      item.text.length > maximumApplicationMaterialItemCharacters ||
      item.question.length > maximumApplicationMaterialItemCharacters
    ) {
      violations.push({ code: "text_too_long", item: index, detail: "The item is too long." });
    }
    if (input.kind === "interview-questions" && item.question.trim() === "") {
      violations.push({
        code: "missing_question",
        item: index,
        detail: "The item has no question.",
      });
    }
    if (item.factIds.length === 0) {
      violations.push({ code: "missing_citation", item: index, detail: "The item cites no fact." });
    }
    const cited: ApplicationMaterialFact[] = [];
    for (const id of item.factIds) {
      const fact = allowed.get(id);
      if (fact !== undefined) cited.push(fact);
      else if (known.has(id)) {
        violations.push({
          code: "fact_not_allowed",
          item: index,
          detail: `The item cites fact ${id}, which may not be used.`,
        });
      } else {
        violations.push({
          code: "unknown_fact",
          item: index,
          detail: `The item cites fact ${id}, which the record does not hold.`,
        });
      }
    }
    const citedValues = cited.map((fact) => fact.value);
    for (const number of numbersIn(item.text)) {
      if (!supported(number, citedValues)) {
        violations.push({
          code: "unsupported_number",
          item: index,
          detail: `The number ${number} appears in no cited fact.`,
        });
      }
    }
    for (const number of numbersIn(item.question)) {
      if (!supported(number, [...citedValues, ...requirementTexts])) {
        violations.push({
          code: "unsupported_number",
          item: index,
          detail: `The number ${number} in the question appears in no cited fact or requirement.`,
        });
      }
    }
  });
  return violations;
}

export interface DraftApplicationMaterialInput extends ApplicationMaterialContextInput {
  /** Attempts before the draft is refused; the second sees the first one's broken rules. */
  readonly maximumAttempts?: number;
}

/**
 * Drafts the material through the port and returns it only once it passes every rule. A draft
 * that still breaks a rule after the last attempt is refused with its violations, never returned.
 */
export async function draftApplicationMaterial(
  port: ApplicationMaterialPort,
  input: DraftApplicationMaterialInput,
): Promise<ApplicationMaterialDraft> {
  const context = applicationMaterialContext(input);
  if (context.facts.length === 0) {
    throw new ApplicationMaterialError(
      "no_facts",
      "The career record holds no fact the draft may cite.",
    );
  }
  const attempts = Math.max(1, input.maximumAttempts ?? 2);
  let refusedRules: string[] = [];
  let violations: ApplicationMaterialViolation[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const reply = await port.draft({ context, refusedRules });
    const items = reply.items.map((item) => ({
      question: item.question.trim(),
      text: item.text.trim(),
      factIds: [...new Set(item.factIds)],
    }));
    violations = applicationMaterialViolations(input, items);
    if (violations.length === 0) {
      return {
        kind: input.kind,
        items,
        ...(reply.model === undefined ? {} : { model: reply.model }),
      };
    }
    refusedRules = [...new Set(violations.map((violation) => violation.detail))];
  }
  throw new ApplicationMaterialError(
    "invalid_draft",
    "The drafted material broke the citation rules and was refused.",
    violations,
  );
}
