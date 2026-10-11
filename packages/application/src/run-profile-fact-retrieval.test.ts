import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  CandidateKnowledgeRetrievalSourceVersionReference,
  ContextSnapshot,
  ScoredEvidenceChunk,
} from "@draft-loop/domain";
import { openSqliteStorage } from "@draft-loop/storage";
import { describe, expect, it, vi } from "vitest";

import {
  candidateKnowledgeEvidenceSourceId,
  type candidateKnowledgeRuntimeRetrieval,
} from "./candidate-knowledge-retrieval.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";
import { CliUserError, createLocalApplicationDriver } from "./local.js";
import { profileFactEvidenceIdPrefix } from "./profile-fact-evidence.js";
import {
  runCandidateProfileUnavailableMessage,
  withPinnedProfileFacts,
} from "./run-profile-fact-retrieval.js";

interface JsonRecord {
  readonly [key: string]: unknown;
}

const silent = { write: () => undefined };
const evidenceLine = "Built local-first TypeScript tools with deterministic testing.";
const factText = `TypeScript\n${evidenceLine}`;

function localCompletion(output: JsonRecord, id: string): unknown {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id,
      choices: [{ message: { content: JSON.stringify(output) } }],
      usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
    }),
  };
}

function extractionProposal(sourceId: string): JsonRecord {
  return {
    schemaVersion: 1,
    facts: [
      {
        key: "skill-typescript",
        category: "skill",
        field: "skill",
        value: "TypeScript",
        evidence: [{ sourceId, quote: evidenceLine }],
      },
    ],
    issues: [],
  };
}

function authorProposal(evidenceId: string): JsonRecord {
  const summary = "TypeScript engineer building local-first tools with deterministic testing.";
  const experience = "Built local-first TypeScript tools with deterministic testing.";
  const skills = "TypeScript tools and deterministic testing.";
  const claim = (text: string) => ({ text, substantive: true, evidenceChunkIds: [evidenceId] });
  return {
    sections: [
      {
        title: "Summary",
        kind: "summary",
        blocks: [{ type: "paragraph", text: summary, claims: [claim(summary)] }],
      },
      {
        title: "Experience",
        kind: "experience",
        blocks: [{ type: "bullet", text: experience, claims: [claim(experience)] }],
      },
      {
        title: "Education",
        kind: "education",
        blocks: [{ type: "bullet", text: "Education information unavailable", claims: [] }],
      },
      {
        title: "Skills",
        kind: "skills",
        blocks: [{ type: "bullet", text: skills, claims: [claim(skills)] }],
      },
    ],
  };
}

interface AuthorInput {
  readonly retrievedEvidence: readonly ScoredEvidenceChunk[];
}

/** A workspace with a candidate knowledge base, a local author and a distinct local critic. */
async function profileWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "draft-loop-profile-facts-"));
  await mkdir(join(root, "evidence"), { recursive: true });
  await writeFile(
    join(root, "job.md"),
    "Build TypeScript local-first tools with deterministic testing.\n",
    "utf8",
  );
  await writeFile(join(root, "evidence", "resume.md"), `${evidenceLine}\n`, "utf8");
  const storeRoot = join(root, "candidate-store");
  const candidatePath = join(root, "candidate.md");
  await writeFile(
    candidatePath,
    `Ada Lovelace\n\n${evidenceLine}\n\nMaintained deterministic testing suites for local-first tools.\n`,
    "utf8",
  );
  const ids = ["profile-store", "profile-ckb", "profile-source", "profile-version"];
  const service = createCandidateKnowledgeStoreService({
    generateId: () => ids.shift() ?? "unexpected-id",
    now: () => "2026-10-10T08:00:00.000Z",
  });
  await service.initializeStore({ storeRoot });
  await service.importKnowledgeSourceFile({
    storeRoot,
    knowledgeBaseId: "profile-ckb",
    sourcePath: candidatePath,
  });

  const authorInputs: AuthorInput[] = [];
  const transport = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      readonly model: string;
      readonly messages: readonly { readonly content: string }[];
    };
    if (body.model === "critic-model") return localCompletion({ findings: [] }, "critic");
    const input = JSON.parse(body.messages[1]?.content ?? "{}") as {
      readonly sources?: readonly { readonly id: string }[];
      readonly retrievedEvidence?: readonly ScoredEvidenceChunk[];
    };
    const source = input.sources?.[0];
    if (source !== undefined) return localCompletion(extractionProposal(source.id), "extraction");
    const evidence = input.retrievedEvidence ?? [];
    authorInputs.push({ retrievedEvidence: evidence });
    const cited = evidence.find(({ text }) => text === factText) ?? evidence[0];
    if (cited === undefined) throw new Error("The author received no evidence.");
    return localCompletion(authorProposal(cited.id), "author");
  });
  const driver = createLocalApplicationDriver({
    providerClientFactories: {
      local: (endpoint) => ({
        ...(endpoint === undefined ? {} : { endpoint }),
        fetch: transport as unknown as typeof fetch,
      }),
    },
  });
  await driver.initialize(
    {
      root,
      jobDescription: "job.md",
      sources: "evidence",
      authorCompany: "local",
      authorModel: "author-model",
      criticCompany: "local",
      criticModel: "critic-model",
      localEndpoint: "http://127.0.0.1:8080/v1",
    },
    silent,
  );
  await driver.configureKnowledgeSelection(
    {
      root,
      entries: [{ storeRoot, storeId: "profile-store", knowledgeBaseId: "profile-ckb" }],
    },
    silent,
  );
  const derived = await driver.deriveCanonicalCandidateProfile({
    root,
    profileId: "profile-1",
    allowProviderData: true,
    createdAt: "2026-10-10T08:01:00.000Z",
  });
  let version = derived.profile.version;
  if (derived.profile.issues.length > 0) {
    version = (
      await driver.editCanonicalCandidateProfile({
        root,
        profileId: "profile-1",
        expectedVersion: version,
        patch: { issues: [] },
        updatedAt: "2026-10-10T08:02:00.000Z",
      })
    ).profile.version;
  }
  const reviewed = await driver.reviewCanonicalCandidateProfile({
    root,
    profileId: "profile-1",
    expectedVersion: version,
    reviewedAt: "2026-10-10T08:03:00.000Z",
  });
  return { root, driver, reviewed, authorInputs };
}

/** The author sees short evidence aliases, so a fact item is told apart by its fact-plus-quote text. */
function factItems(input: AuthorInput | undefined): readonly ScoredEvidenceChunk[] {
  return (input?.retrievedEvidence ?? []).filter(({ text }) => text === factText);
}

describe("runs with a pinned reviewed profile", () => {
  it("lead with fact items the author can cite, on start and on resume", async () => {
    const { root, driver, reviewed, authorInputs } = await profileWorkspace();
    try {
      const candidateProfile = { profileId: "profile-1", version: reviewed.profile.version };
      const started = await driver.start(
        { root, allowProviderData: true, candidateProfile },
        silent,
      );

      expect(started.state).toBe("awaiting-approval");
      const [fact] = factItems(authorInputs[0]);
      expect(fact).toMatchObject({
        lineStart: 3,
        lineEnd: 3,
        text: factText,
      });
      expect(authorInputs[0]?.retrievedEvidence[0]?.id).toBe(fact?.id);
      if (started.artifact === null) throw new Error("The run produced no artifact.");
      const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
      try {
        const artifact = await storage.getArtifactVersion(started.artifact.id);
        const serialized = JSON.stringify(artifact);
        // The fact item resolves to its source version, quote locator and excerpt.
        expect(serialized).toContain('"locator":"line:3-3"');
        expect(serialized).toContain(JSON.stringify(factText));

        // The origin trace pins the profile version and tells facts from chunks, content-free.
        const traces =
          await storage.candidateKnowledgeRetrievalOriginTrace.listRetrievalOriginTraces(
            reviewed.workspaceId,
          );
        expect(traces.length).toBeGreaterThan(0);
        const [trace] = traces;
        expect(trace).toMatchObject({
          profile: {
            profileId: "profile-1",
            version: reviewed.profile.version,
            checksum: reviewed.checksum,
          },
          factRankingMode: "lexical",
        });
        expect(trace?.selectedItems[0]).toEqual({
          itemId: expect.stringMatching(new RegExp(`^${profileFactEvidenceIdPrefix}`)),
          origin: "profile-fact",
          sourceId: fact?.sourceId,
        });
        expect(trace?.selectedItems.slice(1).map(({ origin }) => origin)).toContain(
          "knowledge-chunk",
        );
        expect(trace?.selectedItems.filter(({ origin }) => origin === "profile-fact")).toHaveLength(
          1,
        );
        const recorded = JSON.stringify(traces);
        for (const content of ["TypeScript", "Lovelace", "deterministic", "skill-typescript"]) {
          expect(recorded).not.toContain(content);
        }
      } finally {
        await storage.close();
      }

      const begun = await driver.begin(
        { root, allowProviderData: false, candidateProfile },
        silent,
      );
      const before = authorInputs.length;
      await driver.resume({ root, runId: begun.runId, allowProviderData: true }, silent);
      expect(authorInputs.length).toBeGreaterThan(before);
      expect(factItems(authorInputs[before]).map(({ id }) => id)).toEqual([fact?.id]);
      expect(authorInputs[before]?.retrievedEvidence[0]?.id).toBe(fact?.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("leave a run without a profile on chunk evidence only", async () => {
    const { root, driver, authorInputs } = await profileWorkspace();
    try {
      await driver.start({ root, allowProviderData: true }, silent);

      expect(authorInputs[0]?.retrievedEvidence.length).toBeGreaterThan(0);
      expect(factItems(authorInputs[0])).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the facts when reserved evidence fills the chunk limit", async () => {
    const { root, reviewed } = await profileWorkspace();
    try {
      const version = {
        storeId: "profile-store",
        knowledgeBaseId: "profile-ckb",
        sourceId: "profile-source",
        versionId: "profile-version",
      } as CandidateKnowledgeRetrievalSourceVersionReference;
      // A long career: contact, priority and one chronology chunk per role take all 20 slots,
      // and the chunk retrieval cannot fit them under a smaller limit.
      const reservedIds = Array.from({ length: 20 }, (_, index) => `reserved-${index}`);
      const queryEvidence = vi.fn(async (_text: string, options?: { limit?: number }) => {
        const limit = options?.limit ?? 20;
        if (limit < reservedIds.length) {
          throw new Error("Chronology evidence could not fit within the provider retrieval limit.");
        }
        return [
          ...reservedIds.map((id) => chunk(id, `Role ${id}`)),
          ...Array.from({ length: limit - reservedIds.length }, (_, index) =>
            chunk(`ranked-${index}`, `Ranked excerpt ${index}`),
          ),
        ];
      });
      const runtime = {
        ...fakeRuntime(queryEvidence),
        reservedEvidenceIds: (_text: string, limit = 20) =>
          limit >= reservedIds.length ? new Set(reservedIds) : new Set(),
        loadPinnedSourceChunks: async () => [
          {
            chunkId: "source-chunk",
            ordinal: 0,
            lineStart: 3,
            lineEnd: 3,
            text: evidenceLine,
            metadata: { provenance: version },
          },
        ],
      } as unknown as Runtime;
      const retrieval = await withPinnedProfileFacts(runtime, {
        storage: { getCanonicalCandidateProfile: async () => reviewed, ...traceStorage },
        workspaceId: reviewed.workspaceId,
        context: {
          ...context,
          candidateProfileReference: {
            profileId: reviewed.profile.id,
            version: reviewed.profile.version,
            checksum: reviewed.checksum,
          },
          evidenceManifest: [{ id: candidateKnowledgeEvidenceSourceId(version) }],
        } as unknown as ContextSnapshot,
      });

      const selected = await retrieval.port.queryEvidence("TypeScript testing", { limit: 20 });

      const ids = selected.map(({ id }) => id);
      expect(ids.filter((id) => id.startsWith(profileFactEvidenceIdPrefix))).toHaveLength(1);
      expect(ids).toEqual(expect.arrayContaining(reservedIds));
      expect(selected).toHaveLength(21);
      // The chunks are queried exactly as a run without a profile queries them.
      expect(queryEvidence).toHaveBeenCalledWith("TypeScript testing", { limit: 20 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

type Runtime = NonNullable<ReturnType<typeof candidateKnowledgeRuntimeRetrieval>>;

function chunk(id: string, text: string): ScoredEvidenceChunk {
  return {
    id,
    workspaceId: "workspace-1",
    sourceId: "ckb-source-unused",
    ordinal: 0,
    lineStart: 1,
    lineEnd: 1,
    checksum: "c".repeat(64),
    text,
    rank: -1,
  };
}

function fakeRuntime(queryEvidence: Runtime["port"]["queryEvidence"]): Runtime {
  return {
    port: { queryEvidence },
    inspect: async () => {
      throw new Error("not used");
    },
    reservedEvidenceIds: () => new Set(),
    loadPinnedSourceChunks: async () => [],
    evidenceModeDecision: async () => ({ effectiveMode: "retrieval" }),
  } as unknown as Runtime;
}

const reference = { profileId: "profile-1", version: 3, checksum: "a".repeat(64) };
const traceStorage = {
  candidateKnowledgeRetrievalOriginTrace: { appendRetrievalOriginTrace: vi.fn() },
};
const context = {
  candidateProfileReference: reference,
  evidenceManifest: [],
} as unknown as ContextSnapshot;

describe("withPinnedProfileFacts", () => {
  it("returns the runtime unchanged when the context pins no profile", async () => {
    const runtime = fakeRuntime(async () => []);
    const storage = { getCanonicalCandidateProfile: vi.fn() };

    await expect(
      withPinnedProfileFacts(runtime, {
        storage,
        workspaceId: "workspace-1",
        context: { evidenceManifest: [] } as unknown as ContextSnapshot,
      }),
    ).resolves.toBe(runtime);
    expect(storage.getCanonicalCandidateProfile).not.toHaveBeenCalled();
  });

  it("fails visibly when the pinned version is missing or its checksum differs", async () => {
    const { root, reviewed } = await profileWorkspace();
    try {
      const runtime = fakeRuntime(async () => []);
      const pinned = {
        ...context,
        candidateProfileReference: {
          profileId: reviewed.profile.id,
          version: reviewed.profile.version,
          checksum: reviewed.checksum,
        },
      } as ContextSnapshot;
      const request = (record: unknown, pinnedContext: ContextSnapshot = pinned) =>
        withPinnedProfileFacts(runtime, {
          storage: { getCanonicalCandidateProfile: async () => record as never, ...traceStorage },
          workspaceId: reviewed.workspaceId,
          context: pinnedContext,
        });

      await expect(request(reviewed)).resolves.not.toBe(runtime);
      await expect(request(undefined)).rejects.toThrow(runCandidateProfileUnavailableMessage);
      await expect(request(reviewed, context)).rejects.toBeInstanceOf(CliUserError);
      // A stored record whose content no longer matches its own checksum.
      await expect(
        request({ ...reviewed, profile: { ...reviewed.profile, reviewedAt: undefined } }),
      ).rejects.toThrow(runCandidateProfileUnavailableMessage);
      await expect(
        withPinnedProfileFacts(runtime, {
          storage: { getCanonicalCandidateProfile: async () => reviewed },
          workspaceId: reviewed.workspaceId,
          context: pinned,
        }),
      ).rejects.toThrow("requires storage with retrieval origin traces");
      await expect(
        withPinnedProfileFacts(runtime, {
          storage: {},
          workspaceId: reviewed.workspaceId,
          context: pinned,
        }),
      ).rejects.toThrow(runCandidateProfileUnavailableMessage);

      const full = vi.fn(async () => [chunk("chunk-1", "Built TypeScript tools")]);
      const fullSource = await withPinnedProfileFacts(
        {
          ...fakeRuntime(full),
          evidenceModeDecision: async () => ({ effectiveMode: "full-source" }),
        } as unknown as Runtime,
        {
          storage: { getCanonicalCandidateProfile: async () => reviewed, ...traceStorage },
          workspaceId: reviewed.workspaceId,
          context: pinned,
        },
      );
      // A full-source run already sends every eligible chunk, so its evidence is unchanged.
      await expect(fullSource.port.queryEvidence("TypeScript", { limit: 20 })).resolves.toEqual([
        chunk("chunk-1", "Built TypeScript tools"),
      ]);
      expect(full).toHaveBeenCalledWith("TypeScript", { limit: 20 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
