import {
  createApplicationService,
  createCandidateKnowledgeStoreService,
  createLocalApplicationDriver,
  providerAuthModesFromEnvironment,
  withDefaultWritingPolicy,
  withSavedModelProfiles,
} from "@draft-loop/application";

export * from "@draft-loop/application";

/**
 * CLI is a thin adapter over the shared local application driver. Each provider signs in with an
 * API key or the signed-in CLI, per DRAFT_LOOP_ANTHROPIC_AUTH_MODE and DRAFT_LOOP_OPENAI_AUTH_MODE.
 */
export const applicationService = withSavedModelProfiles(
  withDefaultWritingPolicy(
    createApplicationService(
      createLocalApplicationDriver({
        providerAuthModeConfiguration: providerAuthModesFromEnvironment(process.env),
      }),
    ),
  ),
);

/** The path-explicit knowledge controls use the same application boundary as the desktop. */
export const knowledgeService = createCandidateKnowledgeStoreService();
