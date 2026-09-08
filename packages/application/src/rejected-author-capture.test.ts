import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { JsonObject, ModelResponse } from "@draft-loop/providers";
import { afterEach, expect, it } from "vitest";

import { type BuildAuthorArtifactOptions, buildAuthorArtifact } from "./author-output.js";
import { buildAuthorArtifactWithCapture } from "./rejected-author-capture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "rejected-author-test-"));
  roots.push(root);
  return root;
}
const inputs = {
  executionId: "execution-private",
  context: {
    language: "en",
    evidenceManifest: [{ id: "source", path: "/private/resume.md", checksum: "a".repeat(64) }],
  },
  retrievedEvidence: [
    {
      id: "chunk",
      sourceId: "source",
      workspaceId: "workspace",
      ordinal: 0,
      lineStart: 1,
      lineEnd: 1,
      checksum: "b".repeat(64),
      text: "Built TypeScript tools.",
      rank: 0,
    },
  ],
};
function response(text: string): ModelResponse<JsonObject> {
  return {
    output: {
      sections: [
        {
          title: "Summary",
          kind: "summary",
          blocks: [
            {
              type: "paragraph",
              text,
              claims: [{ text, substantive: true, evidenceChunkIds: ["chunk"] }],
            },
          ],
        },
      ],
    },
    contextSnapshotId: "context",
    provider: "anthropic",
    company: "anthropic",
    modelId: "test-model",
    providerRequestId: "request",
    structuredOutputSha256: "c".repeat(64),
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    cost: { estimatedUsd: null },
  };
}

it("captures replay inputs privately and preserves the factual rejection without leaking content", async () => {
  const root = await directory();
  const rejected = response("Built 999 TypeScript tools.");
  const error = await buildAuthorArtifactWithCapture(rejected, inputs, root).catch(
    (value: unknown) => value,
  );
  expect(error).toMatchObject({
    code: "invalid-response",
    retryable: true,
    failureStage: "factual-invariant-rejection",
    diagnostics: expect.arrayContaining([{ code: "local_author_capture_saved", path: "" }]),
  });
  expect(JSON.stringify(error)).not.toContain("999");
  expect(JSON.stringify(error)).not.toContain(root);
  const entries = await readdir(root);
  expect(entries).toHaveLength(1);
  const captureDir = join(root, entries[0] ?? "missing");
  const file = join(captureDir, "replay.json");
  const original = await readFile(file, "utf8");
  const capture = JSON.parse(original) as {
    validationInputs: BuildAuthorArtifactOptions;
  };
  expect(capture.validationInputs).toEqual({ ...inputs, proposal: rejected.output });
  expect(() => buildAuthorArtifact(capture.validationInputs)).toThrow();
  if (process.platform !== "win32") {
    expect((await stat(captureDir)).mode & 0o777).toBe(0o700);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  }
  await expect(buildAuthorArtifactWithCapture(rejected, inputs, root)).rejects.toThrow();
  expect(await readdir(root)).toHaveLength(2);
  expect(await readFile(file, "utf8")).toBe(original);
});

it("leaves capture disabled by default and does not capture accepted output", async () => {
  const root = await directory();
  await expect(
    buildAuthorArtifactWithCapture(response("Built 999 TypeScript tools."), inputs),
  ).rejects.toMatchObject({
    diagnostics: expect.not.arrayContaining([
      expect.objectContaining({ code: "local_author_capture_saved" }),
    ]),
  });
  await expect(
    buildAuthorArtifactWithCapture(response("Built TypeScript tools."), inputs, root),
  ).resolves.toHaveProperty("version", 1);
  expect(await readdir(root)).toEqual([]);
});

it("reports capture failure without replacing the original validation failure or exposing its path", async () => {
  const root = await directory();
  const error = await buildAuthorArtifactWithCapture(
    response("Built 999 TypeScript tools."),
    inputs,
    join(root, "missing"),
  ).catch((value: unknown) => value);
  expect(error).toMatchObject({
    code: "invalid-response",
    retryable: true,
    failureStage: "factual-invariant-rejection",
    diagnostics: expect.arrayContaining([{ code: "local_author_capture_failed", path: "" }]),
  });
  expect(JSON.stringify(error)).not.toContain(root);
  expect(await readdir(root)).toEqual([]);
});

it("does not treat an empty capture directory as the current directory", async () => {
  await expect(
    buildAuthorArtifactWithCapture(response("Built 999 TypeScript tools."), inputs, ""),
  ).rejects.toMatchObject({
    diagnostics: expect.arrayContaining([{ code: "local_author_capture_failed", path: "" }]),
  });
});
