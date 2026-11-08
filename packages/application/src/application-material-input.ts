import type {
  ApplicationMaterialFact,
  ApplicationMaterialRequirement,
  ApplicationMaterialVoice,
} from "./application-material.js";
import type { FactUsageService, FactUsageSettings } from "./fact-usage.js";
import type { ApplicationService } from "./index.js";
import type { WritingSamplesService } from "./writing-samples.js";

/**
 * What drafting or reviewing an application's material reads from the record (#2525): the newest
 * profile's facts, the newest brief's requirements, the candidate's voice and where each fact may
 * be used. The API's material route and the worker's critic pass read the same input.
 */
export interface ApplicationMaterialRecordInput {
  readonly facts: ApplicationMaterialFact[];
  readonly requirements: ApplicationMaterialRequirement[];
  readonly voice?: ApplicationMaterialVoice;
  readonly usage?: FactUsageSettings;
}

export type ApplicationMaterialRecordService = Pick<
  ApplicationService,
  "listCanonicalCandidateProfileVersions" | "getOpportunity" | "getWritingPolicy"
>;

export interface ApplicationMaterialRecordOptions {
  readonly service: ApplicationMaterialRecordService;
  readonly root: string;
  /** The application's newest brief, or undefined when it has none. */
  readonly briefId: string | undefined;
  readonly writingSamples?: Pick<WritingSamplesService, "read"> | undefined;
  readonly factUsage?: Pick<FactUsageService, "read"> | undefined;
}

export async function applicationMaterialRecordInput(
  options: ApplicationMaterialRecordOptions,
): Promise<ApplicationMaterialRecordInput> {
  const { service, root } = options;
  const opportunity =
    options.briefId === undefined
      ? undefined
      : await service.getOpportunity({ root, briefId: options.briefId });
  const requirements = (opportunity?.brief.requirements ?? []).map((requirement) => ({
    id: requirement.id,
    text: requirement.text,
    priority: requirement.priority,
  }));
  const facts = await careerFacts(service, root);
  const voice = await candidateVoice(service, root, options.writingSamples);
  const usage = await options.factUsage?.read(root);
  return {
    facts,
    requirements,
    ...(voice === undefined ? {} : { voice }),
    ...(usage === undefined ? {} : { usage }),
  };
}

/** The newest canonical profile's facts, without identity or contact fields the profile omits. */
async function careerFacts(
  service: ApplicationMaterialRecordService,
  root: string,
): Promise<ApplicationMaterialFact[]> {
  const profiles = await service.listCanonicalCandidateProfileVersions({ root });
  const newest = [...profiles].sort((left, right) =>
    right.profile.updatedAt.localeCompare(left.profile.updatedAt),
  )[0];
  return (newest?.profile.facts ?? []).map((fact) => ({
    id: fact.id,
    category: fact.category,
    ...(fact.subjectId === undefined ? {} : { subjectId: fact.subjectId }),
    field: fact.field,
    value: fact.value,
  }));
}

/**
 * How the candidate writes: their samples, and the writing policy's forbidden terms, tone and
 * spelling. Each is style for the model, never a fact.
 */
async function candidateVoice(
  service: ApplicationMaterialRecordService,
  root: string,
  samples: Pick<WritingSamplesService, "read"> | undefined,
): Promise<ApplicationMaterialVoice | undefined> {
  const texts = (await samples?.read(root)) ?? [];
  const policy = (await service.getWritingPolicy?.({ root, includeContent: false }))?.policy;
  const avoidTerms = (policy?.rules ?? []).flatMap((rule) =>
    rule.kind === "forbidden-term" ? [rule.term] : [],
  );
  const preferences = policy?.preferences;
  const voice: ApplicationMaterialVoice = {
    ...(texts.length === 0 ? {} : { samples: texts }),
    ...(avoidTerms.length === 0 ? {} : { avoidTerms }),
    ...(preferences?.tone === undefined ? {} : { tone: preferences.tone }),
    ...(preferences?.spellingLocale === undefined
      ? {}
      : { spellingLocale: preferences.spellingLocale }),
  };
  return Object.keys(voice).length === 0 ? undefined : voice;
}
