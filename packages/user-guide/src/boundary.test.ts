import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));

describe("the user guide package boundary (#2881)", () => {
  it("imports only its own modules, so the browser and the server can both load it", () => {
    const offenders = readdirSync(sourceDirectory)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .flatMap((file) =>
        [...readFileSync(join(sourceDirectory, file), "utf8").matchAll(/from\s+"([^"]+)"/gu)]
          .map((match) => match[1] as string)
          .filter((specifier) => !/^\.\/[a-z0-9-]+\.js$/u.test(specifier))
          .map((specifier) => `${file}: ${specifier}`),
      );

    expect(offenders).toEqual([]);
  });
});
