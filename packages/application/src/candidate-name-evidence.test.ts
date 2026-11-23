import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CandidateKnowledgeRetrievalTrace,
  CandidateKnowledgeRetrievalTraceInput,
  ContextSnapshot,
} from "@draft-loop/domain";
import { createCandidateKnowledgeLexicalHit } from "@draft-loop/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { candidateKnowledgeRuntimeRetrieval } from "./candidate-knowledge-retrieval.js";
import {
  candidateNameFromHeading,
  selectCandidateNameEvidence,
} from "./candidate-name-evidence.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";

const provenance = {
  storeId: "store-a",
  knowledgeBaseId: "knowledge-a",
  sourceId: "source-a",
  versionId: "version-a",
};

function chunk(chunkId: string, ordinal: number, text: string) {
  return {
    chunkId,
    ordinal,
    lineStart: ordinal + 1,
    lineEnd: ordinal + 1,
    text,
    metadata: { provenance },
  };
}

describe("candidate name evidence (#3296)", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it("reads a person's name from a top-level heading, never a document title", () => {
    expect(candidateNameFromHeading("# Fictional Okoro")).toBe("Fictional Okoro");
    expect(candidateNameFromHeading("# Candidate profile: Nila Ardent")).toBe("Nila Ardent");
    expect(candidateNameFromHeading("# CV — Jean-Luc O'Brien")).toBe("Jean-Luc O'Brien");
    expect(candidateNameFromHeading("# Curriculum vitae")).toBeUndefined();
    expect(candidateNameFromHeading("# Curriculum Vitae")).toBeUndefined();
    expect(candidateNameFromHeading("# Candidate profile")).toBeUndefined();
    expect(candidateNameFromHeading("## Fictional Okoro")).toBeUndefined();
    expect(candidateNameFromHeading("# Fictional Okoro\nNurse since 2015.")).toBeUndefined();
    expect(candidateNameFromHeading("# senior registered nurse")).toBeUndefined();
  });

  it("selects only the contact source's first chunk, and only when it names a person", () => {
    const contact = createCandidateKnowledgeLexicalHit({
      ...chunk("contact", 1, "**Contact**: `f.okoro@profile.test` · Leeds"),
      bm25Rank: -3,
    });
    const heading = chunk("heading", 0, "# Fictional Okoro");
    const contactChunk = chunk("contact", 1, contact.text);
    const named = [heading, contactChunk];
    expect(selectCandidateNameEvidence(contact, named)).toMatchObject({
      chunkId: "heading",
      text: "# Fictional Okoro",
      bm25Rank: 0,
    });
    expect(
      selectCandidateNameEvidence(contact, [
        chunk("heading", 0, "# Curriculum vitae"),
        contactChunk,
      ]),
    ).toBeUndefined();
    expect(selectCandidateNameEvidence(undefined, named)).toBeUndefined();
    expect(
      selectCandidateNameEvidence(contact, [
        { ...heading, metadata: { provenance: { ...provenance, sourceId: "other" } } },
        contactChunk,
      ]),
    ).toBeUndefined();
  });

  it("retrieves the name heading beside a contact record that has no phone", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-name-evidence-"));
    temporaryRoots.push(parent);
    const storeRoot = join(parent, "candidate-knowledge");
    const sourcePath = join(parent, "fictional-nurse.md");
    await writeFile(
      sourcePath,
      [
        "# Fictional Okoro",
        "",
        "<!-- evidence-id: n-contact -->",
        "**Contact**: `f.okoro@profile.test` · Leeds, fictional record",
        "",
        "## Profile",
        "",
        "Registered nurse with eight years on acute medical wards.",
        "",
        "## Experience",
        "",
        "### Fictional General Hospital — Staff Nurse — March 2017 to present",
        "",
        "Led medication rounds on a 28-bed acute medical ward.",
      ].join("\n"),
      "utf8",
    );
    const ids = ["name-store", "name-ckb", "name-source", "name-version"];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? "unexpected-id",
    });
    await service.initializeStore({ storeRoot });
    await service.importKnowledgeSourceFile({ storeRoot, knowledgeBaseId: "name-ckb", sourcePath });
    const selection = await service.createKnowledgeSelectionSnapshot({
      selections: [{ storeRoot, knowledgeBaseId: "name-ckb" }],
    });
    const appendTrace = vi.fn(
      async (
        input: CandidateKnowledgeRetrievalTraceInput,
      ): Promise<CandidateKnowledgeRetrievalTrace> =>
        input as unknown as CandidateKnowledgeRetrievalTrace,
    );
    const runtime = candidateKnowledgeRuntimeRetrieval(
      { appendCandidateKnowledgeRetrievalTrace: appendTrace },
      {
        id: "workspace-name-evidence",
        requiredSections: ["Summary", "Experience"],
        candidateKnowledgeSelection: { entries: [{ storeRoot, knowledgeBaseId: "name-ckb" }] },
      },
      { candidateKnowledgeSelection: selection } as ContextSnapshot,
    );
    if (runtime === undefined) throw new Error("Expected candidate knowledge retrieval.");

    const query = "medication safety on acute wards";
    const result = await runtime.inspect(query);
    const heading = result.hits.find(({ text }) => text === "# Fictional Okoro");
    const contact = result.hits.find(({ text }) => text.includes("f.okoro@profile.test"));
    expect(heading).toBeDefined();
    expect(contact).toBeDefined();
    expect(result.hits.some(({ text }) => /phone/iu.test(text))).toBe(false);

    const reserved = runtime.reservedEvidenceIds(query);
    expect(reserved.has(heading?.chunkId ?? "")).toBe(true);
    expect(reserved.has(contact?.chunkId ?? "")).toBe(true);
  });
});
