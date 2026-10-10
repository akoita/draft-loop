import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCli } from "./index.js";
import {
  type ApplicationService,
  CliUserError,
  createCandidateKnowledgeStoreService,
  createSourceEvidenceKindService,
} from "./workflow.js";

const transcript = [
  "Interviewer: Tell me about your last role.",
  "Candidate: I led the payments team for three years.",
  "Interviewer: What did you ship?",
  "Candidate: We rebuilt the settlement pipeline.",
].join("\n");

async function withStore(
  test: (context: {
    readonly storeRoot: string;
    readonly knowledgeBaseId: string;
    readonly sourceId: string;
    readonly run: (...args: string[]) => Promise<string[]>;
  }) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "draft-loop-cli-evidence-kind-"));
  try {
    const storeRoot = join(directory, "store");
    const knowledge = createCandidateKnowledgeStoreService();
    const view = await knowledge.initializeStore({ storeRoot });
    const knowledgeBaseId = view.knowledgeBases[0]?.id ?? "";
    const sourcePath = join(directory, "interview.txt");
    await writeFile(sourcePath, transcript, "utf8");
    const written = await knowledge.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId,
      sourcePath,
    });
    const run = async (...args: string[]): Promise<string[]> => {
      const lines: string[] = [];
      await createCli({
        service: {} as ApplicationService,
        knowledgeService: knowledge,
        evidenceKindService: createSourceEvidenceKindService(),
        io: { write: (line: string) => lines.push(line) },
      }).parseAsync(["node", "draft-loop", "knowledge", "source", ...args]);
      return lines;
    };
    await test({ storeRoot, knowledgeBaseId, sourceId: written.source.id, run });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("knowledge source evidence kind commands", () => {
  it("lists each source's detected kind, then the kind set by the user", async () => {
    await withStore(async ({ storeRoot, knowledgeBaseId, sourceId, run }) => {
      const [before] = await run("list", storeRoot, knowledgeBaseId);
      expect(JSON.parse(before ?? "").sources).toEqual([
        expect.objectContaining({
          sourceId,
          kind: "file",
          evidenceKind: "transcript",
          evidenceKindOrigin: "detected",
        }),
      ]);

      expect(await run("kind", storeRoot, knowledgeBaseId, sourceId, "notes")).toEqual([
        `source ${sourceId} evidence kind: notes (set by you)`,
      ]);
      const [after] = await run("list", storeRoot, knowledgeBaseId);
      expect(JSON.parse(after ?? "").sources[0]).toMatchObject({
        evidenceKind: "notes",
        evidenceKindOrigin: "user",
      });
    });
  });

  it("shows the current kind and clears an override back to the detected kind", async () => {
    await withStore(async ({ storeRoot, knowledgeBaseId, sourceId, run }) => {
      const [shown] = await run("kind", storeRoot, knowledgeBaseId, sourceId);
      expect(shown).toMatch(
        new RegExp(
          `^source ${sourceId} evidence kind: transcript \\(detected, confidence \\d\\.\\d\\d\\)$`,
        ),
      );

      await run("kind", storeRoot, knowledgeBaseId, sourceId, "cv");
      const [cleared] = await run(
        "kind",
        storeRoot,
        knowledgeBaseId,
        sourceId,
        "--clear",
        "--json",
      );
      expect(JSON.parse(cleared ?? "")).toMatchObject({
        sourceId,
        kind: "transcript",
        origin: "detected",
      });
    });
  });

  it("rejects an unknown kind and a kind given together with --clear", async () => {
    await withStore(async ({ storeRoot, knowledgeBaseId, sourceId, run }) => {
      await expect(run("kind", storeRoot, knowledgeBaseId, sourceId, "resume")).rejects.toThrow(
        new CliUserError(
          "Evidence kind must be one of: cv, linkedin-export, performance-review, notes, transcript, other.",
        ),
      );
      await expect(
        run("kind", storeRoot, knowledgeBaseId, sourceId, "cv", "--clear"),
      ).rejects.toThrow("Give either a kind or --clear, not both.");
      await expect(run("kind", storeRoot, knowledgeBaseId, "missing-source")).rejects.toThrow(
        "Source missing-source is not a current source of this knowledge base.",
      );
      const [listed] = await run("list", storeRoot, knowledgeBaseId);
      expect(JSON.parse(listed ?? "").sources[0]).toMatchObject({ evidenceKindOrigin: "detected" });
    });
  });
});
