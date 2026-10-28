import type {
  ApplicationService,
  ModelProfileReferences,
  WorkspaceDescriptor,
} from "@draft-loop/application";
import {
  estimateRunCredits,
  type RunCreditEstimate,
  type RunCreditEstimateInput,
  resolveRunCreditTiers,
} from "@draft-loop/application/run-credit-estimate";

/** What prices one run start: the workspace as it is now and the pair the request may name. */
export interface RunPricingRequest {
  readonly root: string;
  readonly workspace: WorkspaceDescriptor;
  readonly applicationId?: string | undefined;
  /** The begin request's own model profile pair, if it named one. */
  readonly modelProfiles?: ModelProfileReferences | undefined;
}

export type RunPricing =
  | {
      readonly status: "priced";
      readonly authorTier: RunCreditEstimateInput["authorTier"];
      readonly criticTier: RunCreditEstimateInput["criticTier"];
      readonly estimate: RunCreditEstimate;
    }
  | { readonly status: "tier_unknown"; readonly role: "author" | "critic" };

/**
 * Prices a run start exactly as the run-start gate does, so the estimate a member reads is the
 * number the gate reserves. The pair that prices the run is an application's own pair (the
 * default one has none), which the application layer also applies whatever the request names;
 * then the request's pair; otherwise the workspace's configured models, matched against the
 * registry. A tier that cannot be determined is reported, never guessed.
 */
export async function priceRun(
  service: Pick<ApplicationService, "getApplication">,
  request: RunPricingRequest,
): Promise<RunPricing> {
  const { applicationId } = request;
  let modelProfiles = request.modelProfiles;
  if (applicationId !== undefined) {
    const application = await service.getApplication({ root: request.root, applicationId });
    if (application?.modelProfiles != null) modelProfiles = application.modelProfiles;
  }
  const tiers = resolveRunCreditTiers({
    ...(modelProfiles === undefined ? {} : { modelProfiles }),
    configured: { author: request.workspace.author, critic: request.workspace.critic },
  });
  if (tiers.status === "unknown") return { status: "tier_unknown", role: tiers.role };
  return {
    status: "priced",
    authorTier: tiers.authorTier,
    criticTier: tiers.criticTier,
    estimate: estimateRunCredits({
      authorTier: tiers.authorTier,
      criticTier: tiers.criticTier,
      authorEffort: tiers.authorEffort,
      criticEffort: tiers.criticEffort,
      maxRounds: request.workspace.maxRounds,
    }),
  };
}
