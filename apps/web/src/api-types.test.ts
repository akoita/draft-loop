import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { apiTypesPath, generateApiTypes } from "./api-types-generator.js";

describe("API types", () => {
  it("match the API's OpenAPI document; regenerate with `pnpm --filter @draft-loop/web api-types`", async () => {
    const committed = await readFile(apiTypesPath, "utf8");

    expect(await generateApiTypes()).toBe(committed);
  });
});
