import { createHash } from "node:crypto";
import type {
  BlobReference,
  BlobStoragePort,
  CandidateKnowledgeBaseRecord,
  CandidateKnowledgeSourceRecord,
  CandidateKnowledgeSourceVersionRecord,
} from "@draft-loop/storage";
import type { CandidateKnowledgeStoreDescriptor } from "@draft-loop/storage/knowledge-store";
import { describe, expect, it } from "vitest";

import {
  createHostedKnowledgeIntake,
  HostedKnowledgeIntakeError,
  type HostedKnowledgeIntakeRecords,
} from "./hosted-knowledge-intake.js";

const at = "2026-10-22T10:00:00.000Z";
const markdown = new TextEncoder().encode("# Experience\n\nBuilt TypeScript services.\n");
const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const docx = new Uint8Array([
  ...[0x50, 0x4b, 0x03, 0x04],
  ...new TextEncoder().encode("....[Content_Types].xml....word/document.xml...."),
]);

interface Managed {
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly versionId: string;
  readonly location: string;
}

/** The tenant's records in memory, with the writes intake made, in order. */
function memoryRecords() {
  const stores = new Map<string, CandidateKnowledgeStoreDescriptor>();
  const bases = new Map<string, CandidateKnowledgeBaseRecord>();
  const sources: CandidateKnowledgeSourceRecord[] = [];
  const versions: CandidateKnowledgeSourceVersionRecord[] = [];
  const managed: Managed[] = [];
  const writes: string[] = [];
  const records: HostedKnowledgeIntakeRecords = {
    getCandidateKnowledgeStore: async (id) => stores.get(id),
    createCandidateKnowledgeStore: async (descriptor) => {
      if (stores.has(descriptor.id)) throw new Error("store exists");
      stores.set(descriptor.id, descriptor);
      writes.push("store");
      return descriptor;
    },
    createCandidateKnowledgeBase: async (input) => {
      const record: CandidateKnowledgeBaseRecord = {
        id: input.id,
        displayName: input.displayName,
        description: input.description ?? "",
        state: "active",
        isDefault: input.isDefault,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        archivedAt: null,
      };
      bases.set(record.id, record);
      writes.push("base");
      return record;
    },
    getCandidateKnowledgeBase: async (id) => bases.get(id),
    listCandidateKnowledgeBases: async () => [...bases.values()],
    createCandidateKnowledgeSource: async (source, initial) => {
      const version: CandidateKnowledgeSourceVersionRecord = {
        ...initial,
        sourceId: source.id,
        version: 1,
        parentVersionId: null,
      };
      sources.push(source);
      versions.push(version);
      writes.push("source");
      return { source, version, created: true };
    },
    listCandidateKnowledgeSources: async (knowledgeBaseId) =>
      sources.filter((source) => source.knowledgeBaseId === knowledgeBaseId),
    listCandidateKnowledgeSourceVersions: async (_knowledgeBaseId, sourceId) =>
      versions.filter((version) => version.sourceId === sourceId),
    recordManagedCandidateKnowledgeSourceVersion: async (input) => {
      managed.push(input);
      writes.push("managed");
    },
  };
  return { records, stores, managed, writes };
}

function memoryBlobs(writes: string[]) {
  const objects = new Map<string, Uint8Array>();
  const blobs: BlobStoragePort = {
    put: async (location, content) => {
      objects.set(location, content);
      writes.push("blob");
      return {
        location,
        checksum: createHash("sha256").update(content).digest("hex"),
        sizeBytes: content.byteLength,
      };
    },
    get: async (reference: BlobReference) => objects.get(reference.location),
    exists: async (reference) => objects.has(reference.location),
    delete: async (reference) => objects.delete(reference.location),
  };
  return { blobs, objects };
}

function setup(maxSourceBytes?: number) {
  const memory = memoryRecords();
  const { blobs, objects } = memoryBlobs(memory.writes);
  let next = 0;
  const intake = createHostedKnowledgeIntake({
    records: memory.records,
    blobs,
    storeId: "knowledge",
    locate: (versionId) => `tenants/owner/knowledge/knowledge/${versionId}`,
    now: () => at,
    generateId: () => `id-${++next}`,
    ...(maxSourceBytes === undefined ? {} : { maxSourceBytes }),
  });
  return { ...memory, objects, intake };
}

describe("hosted knowledge intake", () => {
  it("creates the tenant's store once, with its first knowledge base", async () => {
    const { intake, stores, writes } = setup();

    const base = await intake.createKnowledgeBase({ displayName: "Career" });
    await intake.createKnowledgeBase({ displayName: "Projects" });

    expect(base).toMatchObject({ id: "id-1", displayName: "Career", isDefault: false });
    expect([...stores.keys()]).toEqual(["knowledge"]);
    expect(writes).toEqual(["store", "base", "base"]);
    expect((await intake.listKnowledgeBases()).map(({ displayName }) => displayName)).toEqual([
      "Career",
      "Projects",
    ]);
  });

  it("stores the bytes before it records the source and its managed version", async () => {
    const { intake, objects, managed, writes } = setup();
    const base = await intake.createKnowledgeBase({ displayName: "Career" });

    const added = await intake.addFileSource({
      knowledgeBaseId: base.id,
      displayName: "career.md",
      mediaType: "text/markdown",
      bytes: markdown,
    });

    expect(added.created).toBe(true);
    expect(added.source).toMatchObject({ knowledgeBaseId: base.id, kind: "file" });
    expect(added.latestVersion).toMatchObject({
      mediaType: "text/markdown",
      sizeBytes: markdown.byteLength,
      checksum: createHash("sha256").update(markdown).digest("hex"),
    });
    expect(writes.slice(-3)).toEqual(["blob", "source", "managed"]);
    const location = `tenants/owner/knowledge/knowledge/${added.latestVersion.id}`;
    expect(objects.get(location)).toEqual(markdown);
    expect(managed).toEqual([
      {
        knowledgeBaseId: base.id,
        sourceId: added.source.id,
        versionId: added.latestVersion.id,
        location,
        recordedAt: at,
      },
    ]);
    expect(await intake.listSources(base.id)).toEqual([
      { source: added.source, latestVersion: added.latestVersion },
    ]);
  });

  it("returns the existing source for the same bytes in the same base", async () => {
    const { intake, writes } = setup();
    const base = await intake.createKnowledgeBase({ displayName: "Career" });
    const command = {
      knowledgeBaseId: base.id,
      displayName: "career.md",
      mediaType: "text/markdown",
      bytes: markdown,
    };

    const first = await intake.addFileSource(command);
    const writesAfterFirst = writes.length;
    const again = await intake.addFileSource({ ...command, displayName: "copy.md" });

    expect(again).toEqual({ ...first, created: false });
    expect(writes).toHaveLength(writesAfterFirst);
  });

  it.each([
    ["a PDF", "application/pdf", pdf],
    ["a DOCX", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx],
    ["plain text", "text/plain", markdown],
  ])("takes %s by its signature", async (_name, mediaType, bytes) => {
    const { intake } = setup();
    const base = await intake.createKnowledgeBase({ displayName: "Career" });

    const added = await intake.addFileSource({
      knowledgeBaseId: base.id,
      displayName: "source",
      mediaType,
      bytes,
    });

    expect(added.latestVersion.mediaType).toBe(mediaType);
  });

  it.each([
    ["an unsupported media type", "text/html", markdown, "unsupported_media_type"],
    ["a text file named a PDF", "application/pdf", markdown, "unsupported_media_type"],
    [
      "a PDF named a DOCX",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pdf,
      "unsupported_media_type",
    ],
    [
      "binary bytes named text",
      "text/plain",
      Uint8Array.of(0x00, 0xff, 0x10),
      "unsupported_media_type",
    ],
    [
      "invalid UTF-8 named Markdown",
      "text/markdown",
      Uint8Array.of(0xc3, 0x28),
      "unsupported_media_type",
    ],
    ["an empty file", "text/plain", new Uint8Array(), "source_empty"],
  ])("refuses %s before writing anything", async (_name, mediaType, bytes, code) => {
    const { intake, writes } = setup();
    const base = await intake.createKnowledgeBase({ displayName: "Career" });
    const before = writes.length;

    const refusal = intake.addFileSource({
      knowledgeBaseId: base.id,
      displayName: "source",
      mediaType,
      bytes,
    });

    await expect(refusal).rejects.toBeInstanceOf(HostedKnowledgeIntakeError);
    await expect(refusal).rejects.toMatchObject({ code });
    expect(writes).toHaveLength(before);
  });

  it("refuses a file over the size limit", async () => {
    const { intake } = setup(16);
    const base = await intake.createKnowledgeBase({ displayName: "Career" });

    await expect(
      intake.addFileSource({
        knowledgeBaseId: base.id,
        displayName: "career.md",
        mediaType: "text/markdown",
        bytes: markdown,
      }),
    ).rejects.toMatchObject({ code: "source_too_large" });
  });

  it("refuses a knowledge base that does not exist", async () => {
    const { intake, writes } = setup();

    await expect(
      intake.addFileSource({
        knowledgeBaseId: "missing",
        displayName: "career.md",
        mediaType: "text/markdown",
        bytes: markdown,
      }),
    ).rejects.toMatchObject({ code: "knowledge_base_not_found" });
    await expect(intake.listSources("missing")).rejects.toMatchObject({
      code: "knowledge_base_not_found",
    });
    expect(writes).not.toContain("blob");
  });
});
