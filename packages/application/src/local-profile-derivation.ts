/**
 * The local driver's career profile derivation and its estimate (#3182), over a workspace's
 * configured knowledge selection. Both read the same selection, consent and history; only the
 * derivation calls the extraction model.
 */

import { resolve } from "node:path";

import type { WorkspaceHistoryStorage } from "@draft-loop/storage";

import {
  type CanonicalCandidateProfileDerivationResult,
  type CanonicalCandidateProfileDerivationService,
  canonicalCandidateProfileDerivationApprovalErrorMessage,
  canonicalCandidateProfileDerivationErrorMessage,
  canonicalProfileDerivationOptions,
  createCanonicalCandidateProfileDerivationService,
} from "./candidate-profile-derivation.js";
import type { CanonicalCandidateProfileDerivationEstimate } from "./candidate-profile-derivation-estimate.js";
import {
  canonicalProfileExtractionIdentity,
  canonicalProfileExtractionModel,
} from "./candidate-profile-extraction-identity.js";
import { createCanonicalCandidateProfilePersistenceService } from "./candidate-profile-persistence.js";
import { CliUserError } from "./cli-user-error.js";
import type { DeriveCanonicalCandidateProfileCommand } from "./index.js";
import type { WorkspaceConfig } from "./local.js";
import {
  canonicalProfileExtractionBudgetFor,
  canonicalProfileExtractionPortFor,
  type ProviderCanonicalCandidateProfileExtractionOptions,
} from "./local-extraction-ports.js";
import { ensureWorkspaceRecord } from "./local-history-records.js";
import { timestamp } from "./response-execution.js";
import { excludedSensitivityTiersForWorkspace } from "./sensitive-knowledge-consent.js";

export interface LocalProfileDerivationDependencies {
  readonly readWorkspace: (root: string) => Promise<WorkspaceConfig>;
  readonly openStorage: (root: string) => Promise<WorkspaceHistoryStorage>;
  readonly validateSelection: (
    binding: WorkspaceConfig["candidateKnowledgeSelection"],
  ) => Promise<unknown>;
  readonly providerOptions: ProviderCanonicalCandidateProfileExtractionOptions;
}

export type EstimateLocalCanonicalProfileDerivationCommand = Pick<
  DeriveCanonicalCandidateProfileCommand,
  "root" | "profileId" | "fullExtraction"
>;

type Base = Parameters<
  CanonicalCandidateProfileDerivationService["estimateCanonicalCandidateProfileDerivation"]
>[0];

async function withDerivation<Result>(
  command: EstimateLocalCanonicalProfileDerivationCommand,
  dependencies: LocalProfileDerivationDependencies,
  use: (
    derivation: CanonicalCandidateProfileDerivationService,
    base: Base,
    binding: NonNullable<WorkspaceConfig["candidateKnowledgeSelection"]>,
  ) => Promise<Result>,
): Promise<Result> {
  const root = resolve(command.root);
  const config = await dependencies.readWorkspace(root);
  const binding = config.candidateKnowledgeSelection;
  const validatedSelection = await dependencies.validateSelection(binding);
  if (binding === undefined || validatedSelection === undefined) {
    throw new CliUserError(canonicalCandidateProfileDerivationErrorMessage);
  }
  // Read before any provider work: an invalid consent file stops the derivation here.
  const excludedSensitivityTiers = await excludedSensitivityTiersForWorkspace(root);
  const storage = await dependencies.openStorage(root);
  try {
    await ensureWorkspaceRecord(storage, config.id);
    const derivation = createCanonicalCandidateProfileDerivationService({
      persistence: createCanonicalCandidateProfilePersistenceService(storage),
      extractor: canonicalProfileExtractionPortFor(config, {
        ...dependencies.providerOptions,
        allowProviderData: true,
      }),
      extractionIdentity: canonicalProfileExtractionIdentity(
        canonicalProfileExtractionModel(config.authorCompany, config.authorModel),
      ),
      extractionBudget: canonicalProfileExtractionBudgetFor(config, dependencies.providerOptions),
      now: timestamp,
    });
    const base: Base = {
      workspaceId: config.id,
      profileId: command.profileId,
      selections: binding.entries.map(({ storeRoot, knowledgeBaseId }) => ({
        storeRoot,
        knowledgeBaseId,
      })),
      excludedSensitivityTiers,
      ...(binding.combinationApproved === undefined
        ? {}
        : { combinationApproved: binding.combinationApproved }),
      ...(command.fullExtraction === undefined ? {} : { fullExtraction: command.fullExtraction }),
    };
    return await use(derivation, base, binding);
  } finally {
    await storage.close();
  }
}

/** Derives the workspace's career profile once the person allowed provider data. */
export async function deriveLocalCanonicalProfile(
  command: DeriveCanonicalCandidateProfileCommand,
  dependencies: LocalProfileDerivationDependencies,
): Promise<CanonicalCandidateProfileDerivationResult> {
  if (command.allowProviderData !== true) {
    throw new CliUserError(canonicalCandidateProfileDerivationApprovalErrorMessage);
  }
  return withDerivation(command, dependencies, (derivation, base, binding) =>
    derivation.deriveCanonicalCandidateProfile({
      ...base,
      allowProviderData: true,
      ...canonicalProfileDerivationOptions(binding, command),
    }),
  );
}

/** What deriving the workspace's career profile would send now; calls no model. */
export async function estimateLocalCanonicalProfileDerivation(
  command: EstimateLocalCanonicalProfileDerivationCommand,
  dependencies: LocalProfileDerivationDependencies,
): Promise<CanonicalCandidateProfileDerivationEstimate> {
  return withDerivation(command, dependencies, (derivation, base) =>
    derivation.estimateCanonicalCandidateProfileDerivation(base),
  );
}
