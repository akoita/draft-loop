import type {
  ApplicationMaterialFact,
  ApplicationMaterialRequirement,
  ApplicationMaterialVoice,
} from "./application-material.js";
import type { FactUsageService, FactUsageSettings } from "./fact-usage.js";
import type { ApplicationService } from "./index.js";
import type { WritingSamplesService } from "./writing-samples.js";

/**
 * What drafting or reviewing an application's material reads from the record (#2525): the last
 * reviewed profile's facts (#2816), the newest brief's requirements, the candidate's voice and where each fact may
 * be used. The API's material route and the worker's critic pass read the same input.
 */
/** Which career profile version the material drew its facts from (#2816). */
export interface ApplicationMaterialProfileSource {
  readonly version: number;
  /** False only when no version has been reviewed yet, so the newest draft was used. */
  readonly reviewed: boolean;
  /** A newer draft waits for review; it is not used until it is reviewed. */
  readonly newerDraftWaiting: boolean;
}

export interface ApplicationMaterialRecordInput {
  readonly facts: ApplicationMaterialFact[];
  /** Absent when the record has no career profile yet. */
  readonly profile?: ApplicationMaterialProfileSource;
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
  const { facts, profile } = await careerFacts(service, root);
  const voice = await candidateVoice(service, root, options.writingSamples);
  const usage = await options.factUsage?.read(root);
  return {
    facts,
    ...(profile === undefined ? {} : { profile }),
    requirements,
    ...(voice === undefined ? {} : { voice }),
    ...(usage === undefined ? {} : { usage }),
  };
}

/**
 * The facts of the last reviewed career profile version, as the Career profile card promises: a
 * newer draft is used only once it is reviewed (#2816). Before any version is reviewed, the newest
 * draft is used and the source says so. Identity and contact fields the profile omits stay out.
 */
async function careerFacts(
  service: ApplicationMaterialRecordService,
  root: string,
): Promise<{ facts: ApplicationMaterialFact[]; profile?: ApplicationMaterialProfileSource }> {
  const profiles = await service.listCanonicalCandidateProfileVersions({ root });
  const newestFirst = [...profiles].sort((left, right) =>
    right.profile.updatedAt.localeCompare(left.profile.updatedAt),
  );
  const newest = newestFirst[0];
  if (newest === undefined) return { facts: [] };
  const reviewed = newestFirst.find(({ profile }) => profile.status === "reviewed");
  const used = reviewed ?? newest;
  const facts = used.profile.facts.map((fact) => ({
    id: fact.id,
    category: fact.category,
    ...(fact.subjectId === undefined ? {} : { subjectId: fact.subjectId }),
    field: fact.field,
    value: fact.value,
  }));
  return {
    facts,
    profile: {
      version: used.profile.version,
      reviewed: reviewed !== undefined,
      newerDraftWaiting: reviewed !== undefined && newest !== reviewed,
    },
  };
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
