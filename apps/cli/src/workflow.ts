import {
  createApplicationService,
  createCandidateKnowledgeStoreService,
  createLocalApplicationDriver,
} from "@draft-loop/application";

export * from "@draft-loop/application";

/** CLI is a thin adapter over the shared local application driver. */
export const applicationService = createApplicationService(createLocalApplicationDriver());

/** The path-explicit knowledge controls use the same application boundary as the desktop. */
export const knowledgeService = createCandidateKnowledgeStoreService();
