import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { findMemoryKind, memoryKinds, memoryLifetimes, memoryWriters } from "./memory-model.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** The rows between the memory-kinds markers of docs/architecture/memory.md. */
function documentedKinds(): string[][] {
  const page = readFileSync(resolve(root, "docs/architecture/memory.md"), "utf8");
  const table = page.split("<!-- memory-kinds:start -->")[1]?.split("<!-- memory-kinds:end -->")[0];
  if (table === undefined) throw new Error("memory.md has no memory-kinds table");
  return table
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim().replace(/^`|`$/gu, "")),
    );
}

describe("memory model catalog", () => {
  it("has unique ids and known lifetimes and writers", () => {
    const ids = memoryKinds.map((kind) => kind.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const kind of memoryKinds) {
      expect(memoryLifetimes).toContain(kind.lifetime);
      expect(memoryWriters).toContain(kind.writer);
    }
  });

  it("matches the table in docs/architecture/memory.md", () => {
    const rows = documentedKinds().map(([id, lifetime, writer, content, owner]) => ({
      id,
      lifetime,
      writer,
      mayHoldCandidateContent: content === "yes",
      owningModule: owner,
    }));
    expect(rows).toEqual(memoryKinds.map((kind) => ({ ...kind })));
  });

  it("names owning modules that exist and point back to the catalog", () => {
    for (const kind of memoryKinds) {
      const path = resolve(root, kind.owningModule);
      expect(existsSync(path), kind.owningModule).toBe(true);
      expect(readFileSync(path, "utf8"), kind.owningModule).toContain(`memory kind \`${kind.id}\``);
    }
  });

  it("finds a kind by id", () => {
    expect(findMemoryKind("writing-policy")?.writer).toBe("person");
    expect(findMemoryKind("unknown")).toBeUndefined();
  });
});
