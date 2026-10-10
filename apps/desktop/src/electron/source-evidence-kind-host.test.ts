import type { SourceEvidenceKindService } from "@draft-loop/application";
import { describe, expect, it, vi } from "vitest";

import { maximumSourceEvidenceKindEntries } from "../source-evidence-kind-contract.js";
import { createSourceEvidenceKindHost } from "./source-evidence-kind-host.js";

const entry = {
  sourceId: "source-1",
  displayName: "resume.pdf",
  versionId: "version-1",
  kind: "cv" as const,
  origin: "detected" as const,
  confidence: 0.8,
  signals: ["experience-heading"],
};

function host(service: Partial<SourceEvidenceKindService>) {
  const knowledgeBaseRoot = vi.fn(async () => "/private/store");
  return {
    knowledgeBaseRoot,
    host: createSourceEvidenceKindHost({
      service: service as SourceEvidenceKindService,
      knowledgeBaseRoot,
    }),
  };
}

describe("source evidence kind host", () => {
  it("lists kinds with ids, name, kind and origin only, bounded and path-free", async () => {
    const listSourceEvidenceKinds = vi.fn(async () =>
      Array.from({ length: maximumSourceEvidenceKindEntries + 1 }, (_, index) => ({
        ...entry,
        sourceId: `source-${index}`,
        displayName: index === 0 ? "line one\nline two" : `${"x".repeat(250)}`,
      })),
    );
    const { host: kinds, knowledgeBaseRoot } = host({ listSourceEvidenceKinds });

    const result = await kinds.list({ storeId: "store-1", knowledgeBaseId: "kb-1" });

    expect(knowledgeBaseRoot).toHaveBeenCalledWith("store-1", "kb-1");
    expect(listSourceEvidenceKinds).toHaveBeenCalledWith({
      storeRoot: "/private/store",
      knowledgeBaseId: "kb-1",
    });
    expect(result.truncated).toBe(true);
    expect(result.sources).toHaveLength(maximumSourceEvidenceKindEntries);
    expect(result.sources[0]).toEqual({
      sourceId: "source-0",
      displayName: "line one line two",
      kind: "cv",
      origin: "detected",
    });
    expect([...(result.sources[1]?.displayName ?? "")]).toHaveLength(200);
    expect(JSON.stringify(result)).not.toContain("/private/store");
    expect(JSON.stringify(result)).not.toContain("experience-heading");
  });

  it("sets and clears an override through the application service", async () => {
    const setSourceEvidenceKind = vi.fn(async ({ kind }: { kind: string | null }) => ({
      ...entry,
      kind: (kind ?? "cv") as "cv",
      origin: kind === null ? ("detected" as const) : ("user" as const),
    }));
    const { host: kinds } = host({ setSourceEvidenceKind });

    await expect(
      kinds.set({
        storeId: "store-1",
        knowledgeBaseId: "kb-1",
        sourceId: "source-1",
        kind: "notes",
      }),
    ).resolves.toEqual({
      storeId: "store-1",
      knowledgeBaseId: "kb-1",
      source: { sourceId: "source-1", displayName: "resume.pdf", kind: "notes", origin: "user" },
    });
    await kinds.set({
      storeId: "store-1",
      knowledgeBaseId: "kb-1",
      sourceId: "source-1",
      kind: null,
    });
    expect(setSourceEvidenceKind).toHaveBeenLastCalledWith({
      storeRoot: "/private/store",
      knowledgeBaseId: "kb-1",
      sourceId: "source-1",
      kind: null,
    });
  });
});
