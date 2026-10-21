import type { ApplicationService } from "@draft-loop/application";

import { buildApi } from "./app.js";

/** The committed OpenAPI document, which the drift test keeps equal to the generated one. */
export const openApiDocumentPath = new URL("../openapi.json", import.meta.url);

/**
 * Generates the OpenAPI document of every route. Routes are registered but never called, so the
 * service is a stand-in.
 */
export async function generateOpenApiDocument(): Promise<string> {
  const app = await buildApi({
    ownerToken: "openapi-generation-token-0123456789abcdef",
    application: {
      service: {} as ApplicationService,
      workspaceRoot: (workspaceId) => workspaceId,
    },
  });
  try {
    await app.ready();
    return `${JSON.stringify(app.swagger(), null, 2)}\n`;
  } finally {
    await app.close();
  }
}
