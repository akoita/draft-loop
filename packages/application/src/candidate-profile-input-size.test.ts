import { describe, expect, it, vi } from "vitest";

import {
  type CanonicalCandidateProfileExtractionInput,
  maximumCanonicalCandidateProfileExtractionCharacters,
  processCanonicalCandidateProfileExtraction,
} from "./candidate-profile-extraction.js";

type Material = CanonicalCandidateProfileExtractionInput["sources"][number];

function material(id: string, text: string, checksum = "a".repeat(64)): Material {
  return {
    id,
    mediaType: "text/markdown",
    checksum,
    text,
    reference: {
      storeId: "store-1",
      knowledgeBaseId: "knowledge-1",
      sourceId: `source-${id}`,
      versionId: `version-${id}`,
      kind: "candidate-provided",
    },
  };
}

function emptyPort() {
  return { extract: vi.fn(async () => ({ schemaVersion: 1, facts: [], issues: [] })) };
}

async function run(port: ReturnType<typeof emptyPort>, sources: readonly Material[]) {
  return processCanonicalCandidateProfileExtraction(port, {
    operationId: "profile-operation",
    sources,
    allowProviderData: true,
  });
}

describe("canonical candidate profile extraction input size", () => {
  it("counts identical sources once and sends one representative source", async () => {
    const text = "Synthetic career line.\n".repeat(9_000);
    expect(text.length).toBeGreaterThan(200_000);
    const port = emptyPort();

    const result = await run(port, [
      material("copy-a", text),
      material("copy-b", text),
      material("copy-c", text),
    ]);

    expect(text.length * 3).toBeGreaterThan(maximumCanonicalCandidateProfileExtractionCharacters);
    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(port.extract).toHaveBeenCalledTimes(1);
    const request = (port.extract.mock.calls as unknown as [{ sources: Material[] }][])[0]?.[0];
    expect(request?.sources).toHaveLength(1);
  });

  it("fails distinct sources over the limit with the measured deduplicated size", async () => {
    const first = "a".repeat(300_000);
    const second = "b".repeat(300_000);
    const port = emptyPort();

    const result = await run(port, [
      material("one", first),
      material("two", second, "b".repeat(64)),
      material("three", first),
    ]);

    expect(port.extract).not.toHaveBeenCalled();
    expect(result.facts).toEqual([]);
    expect(result.issues).toHaveLength(1);
    // The desktop hides messages over 240 characters or containing a slash.
    expect(result.issues[0]?.message.length).toBeLessThan(240);
    expect(result.issues[0]?.message).not.toMatch(/[\\/\\\\]/u);
    expect(result.issues[0]?.message).toBe(
      "The selected career evidence is too large for one profile: 600,000 characters after removing duplicates, limit 524,288. Remove or split sources and try again.",
    );
  });

  it("names a single source over the per-source limit", async () => {
    const result = await run(emptyPort(), [material("big", "x".repeat(524_289))]);

    expect(result.issues[0]?.message).toBe(
      "A selected source is longer than the 524,288-character limit for profile derivation. Split it into smaller files and derive again.",
    );
  });

  it("reports a source without extractable text", async () => {
    const result = await run(emptyPort(), [material("blank", " \n\t ")]);

    expect(result.issues[0]?.message).toBe(
      "A selected source has no extractable text. Check that each file contains readable text.",
    );
  });

  it("keeps the generic message for other invalid input", async () => {
    const result = await run(emptyPort(), [{ ...material("bad", "text"), mediaType: "" }]);

    expect(result.issues[0]?.message).toBe(
      "Candidate profile source material could not be prepared. Check the selected source references and try again.",
    );
  });
});
