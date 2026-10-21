import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { generateOpenApiDocument, openApiDocumentPath } from "./openapi-document.js";

describe("OpenAPI document", () => {
  it("matches the route schemas; regenerate with `pnpm --filter @draft-loop/api openapi`", async () => {
    const committed = await readFile(openApiDocumentPath, "utf8");

    expect(await generateOpenApiDocument()).toBe(committed);
  });
});
