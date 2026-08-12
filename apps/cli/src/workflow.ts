import { createApplicationService, createLocalApplicationDriver } from "@draft-loop/application";

export * from "@draft-loop/application";

/** CLI is a thin adapter over the shared local application driver. */
export const applicationService = createApplicationService(createLocalApplicationDriver());
