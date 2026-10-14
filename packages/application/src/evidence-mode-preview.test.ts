import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createApplicationService } from "./index.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";
import { createLocalApplicationDriver, type LocalApplicationDriverOptions } from "./local.js";
import { createModelProfileRegistry } from "./model-profiles.js";
import { writeWorkspaceEvidenceMode } from "./workspace-evidence-mode.js";

const candidateMarkdown = [
  "# Fictional Candidate",
  "",
  ...Array.from(
    { length: 25 },
    (_, index) => `Synthetic delivery ${index} for an invented client.\n`,
  ),
].join("\n");

/** A pair whose smaller context window leaves a 2,000-character evidence budget. */
function smallWindowProfiles() {
  const author = {
    id: "small-window-author",
    version: 1,
    provider: "anthropic",
    modelId: "claude-sonnet-4-5",
    tier: "standard" as const,
    roles: ["author"] as const,
    runtime: {
      effort: "provider-default" as const,
      maxOutputTokens: 600,
      thinking: { mode: "provider-default" as const },
    },
    knownLimits: { maxOutputTokens: 600, contextWindowTokens: 1_000 },
  };
  const critic = {
    id: "small-window-critic",
    version: 1,
    provider: "openai",
    modelId: "gpt-5.6-luna",
    tier: "economy" as const,
    roles: ["critic"] as const,
    runtime: {
      effort: "provider-default" as const,
      maxOutputTokens: 600,
      thinking: { mode: "provider-default" as const },
    },
    knownLimits: { maxOutputTokens: 600, contextWindowTokens: 200_000 },
  };
  return {
    registry: createModelProfileRegistry([author, critic]),
    modelProfiles: {
      author: { id: author.id, version: author.version },
      critic: { id: critic.id, version: critic.version },
    },
  };
}

/** The preview is the decision a started run records, made without starting one. */
describe("evidence-mode preview", () => {
  const roots: string[] = [];
  const silent = { write: () => undefined };

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  async function workspace(
    options: { readonly driver?: LocalApplicationDriverOptions; readonly select?: boolean } = {},
  ) {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-evidence-preview-"));
    roots.push(root);
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, "job.md"), "Deliver synthetic platform work.\n", "utf8");
    await writeFile(join(root, "evidence", "resume.md"), "Delivered synthetic work.\n", "utf8");
    const driver = createLocalApplicationDriver(options.driver);
    await driver.initialize(
      { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
      silent,
    );
    if (options.select !== false) {
      const storeRoot = join(root, "candidate-store");
      const candidatePath = join(root, "candidate.md");
      await writeFile(candidatePath, candidateMarkdown, "utf8");
      const ids = ["ep-store", "ep-ckb", "ep-source", "ep-version"];
      const knowledge = createCandidateKnowledgeStoreService({
        generateId: () => ids.shift() ?? "unexpected-id",
        now: () => "2026-08-23T10:00:00.000Z",
      });
      await knowledge.initializeStore({ storeRoot });
      await knowledge.importKnowledgeSourceFile({
        storeRoot,
        knowledgeBaseId: "ep-ckb",
        sourcePath: candidatePath,
      });
      await driver.configureKnowledgeSelection(
        { root, entries: [{ storeRoot, storeId: "ep-store", knowledgeBaseId: "ep-ckb" }] },
        silent,
      );
    }
    return { root, service: createApplicationService(driver) };
  }

  it("matches the recorded decision when the full source fits", async () => {
    const { root, service } = await workspace();
    const preview = await service.previewEvidenceMode?.({ root });
    expect(preview).toEqual({
      requestedMode: "full-source",
      effectiveMode: "full-source",
      chunkCount: 26,
      sourceCount: 1,
    });
    // The preview starts nothing.
    expect((await service.readWorkspace(root)).latestRunId).toBeUndefined();

    const begun = await service.begin({ root, allowProviderData: false }, silent);
    await expect(service.readRunEvidenceMode?.({ root, runId: begun.runId })).resolves.toEqual(
      preview,
    );
  });

  it("matches the recorded fallback when the pair's budget is too small", async () => {
    const { registry, modelProfiles } = smallWindowProfiles();
    const { root, service } = await workspace({ driver: { modelProfileRegistry: registry } });
    const preview = await service.previewEvidenceMode?.({ root, modelProfiles });
    expect(preview).toEqual({
      requestedMode: "full-source",
      effectiveMode: "retrieval",
      chunkCount: 26,
      sourceCount: 1,
      fallbackReason: "budget-exceeded",
    });
    // Without the pair the default budget applies, so the same source fits.
    await expect(service.previewEvidenceMode?.({ root })).resolves.toMatchObject({
      effectiveMode: "full-source",
    });

    const begun = await service.begin({ root, allowProviderData: false, modelProfiles }, silent);
    await expect(service.readRunEvidenceMode?.({ root, runId: begun.runId })).resolves.toEqual(
      preview,
    );
  });

  it("reports retrieval when the workspace chose it, as a run records nothing", async () => {
    const { root, service } = await workspace();
    await writeWorkspaceEvidenceMode(root, "retrieval");
    await expect(service.previewEvidenceMode?.({ root })).resolves.toEqual({
      requestedMode: "retrieval",
      effectiveMode: "retrieval",
      chunkCount: 0,
    });
    const begun = await service.begin({ root, allowProviderData: false }, silent);
    await expect(
      service.readRunEvidenceMode?.({ root, runId: begun.runId }),
    ).resolves.toBeUndefined();
  });

  it("has no preview without a candidate knowledge selection", async () => {
    const { root, service } = await workspace({ select: false });
    await expect(service.previewEvidenceMode?.({ root })).resolves.toBeUndefined();
  });
});
