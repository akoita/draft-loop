import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ContextSnapshot, ScoredEvidenceChunk } from "@draft-loop/domain";
import type { AuthorRequest } from "@draft-loop/orchestrator";
import type {
  JsonObject,
  ModelRequest,
  ModelResponse,
  UserSessionProcessRunner,
} from "@draft-loop/providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authorRevisionInstructions } from "./author-adjudication.js";
import { resetAuthorRevisionMemoryForTests } from "./author-revision-memory.js";
import { createLocalApplicationDriver } from "./local.js";
import { createProviderAuthorAgent } from "./provider-author-agent.js";

const evidence: readonly ScoredEvidenceChunk[] = [
  {
    id: "chunk",
    workspaceId: "workspace",
    sourceId: "source",
    ordinal: 0,
    lineStart: 1,
    lineEnd: 1,
    checksum: "b".repeat(64),
    text: "Built TypeScript tools in 2021.",
    rank: 0,
  },
];

const context = {
  id: "context",
  language: "en",
  evidenceManifest: [{ id: "source", path: "/private/resume.md", checksum: "a".repeat(64) }],
  requirements: [{ id: "requirement", text: "TypeScript tools" }],
  outputConstraints: { requiredSections: [] },
  modelConfiguration: { author: { promptTemplateVersion: "cli-author-v3" } },
} as unknown as ContextSnapshot;

const retryFeedback = {
  failureCode: "invalid-response",
  failureStage: "factual-invariant-rejection",
  diagnostics: [{ code: "factual_invariant_violation", path: "sections.0.blocks.0.claims.0.text" }],
} as const;

function proposal(text: string): JsonObject {
  return {
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
  };
}

const rejectedText = "Built TypeScript tools in 2023.";
const acceptedText = "Built TypeScript tools in 2021.";

/** An author agent over a fake adapter that answers with the queued proposals. */
function agent(outputs: JsonObject[]) {
  const requests: ModelRequest<JsonObject>[] = [];
  const author = createProviderAuthorAgent({
    context,
    promptContext: context,
    dataPolicy: () => ({
      allowTransmission: true,
      allowedCompanies: ["anthropic"],
      sensitiveData: true,
      sensitiveDataAcknowledged: true,
      requestedRetention: "ephemeral-request",
    }),
    createAdapter: async () => ({
      execute: async (request) => {
        requests.push(request);
        const output = outputs.shift();
        if (output === undefined) throw new Error("No queued author output.");
        return {
          output,
          contextSnapshotId: "context",
          provider: "anthropic",
          company: "anthropic",
          modelId: "test-model",
          providerRequestId: "request",
          structuredOutputSha256: "c".repeat(64),
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          cost: { estimatedUsd: null },
        } satisfies ModelResponse<JsonObject>;
      },
    }),
    authorCompany: "anthropic",
    authorModel: "test-model",
    authorProposalCaptureDirectory: undefined,
    userError: (message) => new Error(message),
  });
  return { author, requests };
}

function request(
  runId: string,
  extra: Partial<Pick<AuthorRequest, "retryFeedback">> = {},
): AuthorRequest {
  return {
    executionId: `${runId}-execution`,
    runId,
    round: 1,
    context,
    currentArtifact: null,
    findings: [],
    retrievedEvidence: evidence,
    ...extra,
  };
}

describe("provider author agent revision", () => {
  beforeEach(() => resetAuthorRevisionMemoryForTests());

  it("sends the rejected proposal and a specific report to the next retry", async () => {
    const { author, requests } = agent([proposal(rejectedText), proposal(acceptedText)]);

    await expect(author.execute(request("run-1"))).rejects.toMatchObject({
      code: "invalid-response",
    });
    await expect(author.execute(request("run-1", { retryFeedback }))).resolves.toMatchObject({
      output: { version: 1 },
    });

    expect(requests[0]?.input).not.toHaveProperty("revision");
    expect(requests[0]?.systemPrompt).not.toContain(authorRevisionInstructions);
    expect(requests[1]?.systemPrompt).toContain(authorRevisionInstructions);
    expect(requests[1]?.input).toMatchObject({
      retryFeedback,
      revision: {
        rejectedProposal: proposal(rejectedText),
        report: [
          {
            path: "sections.0.blocks.0.claims.0.text",
            code: "factual_invariant_violation",
            text: rejectedText,
            problems: ['protected value "2023" is not stated in cited evidence'],
          },
        ],
      },
    });
  });

  it("sends no revision when nothing was remembered for the run and round", async () => {
    const { author, requests } = agent([proposal(rejectedText), proposal(acceptedText)]);

    await expect(author.execute(request("run-1"))).rejects.toThrow();
    await author.execute(request("run-2", { retryFeedback }));

    expect(requests[1]?.input).toHaveProperty("retryFeedback");
    expect(requests[1]?.input).not.toHaveProperty("revision");
    expect(requests[1]?.systemPrompt).not.toContain(authorRevisionInstructions);
  });

  it("sends a remembered revision once and replaces it after a further rejection", async () => {
    const secondRejection = "Built TypeScript tools in 2024.";
    const { author, requests } = agent([
      proposal(rejectedText),
      proposal(secondRejection),
      proposal(acceptedText),
      proposal(acceptedText),
    ]);

    await expect(author.execute(request("run-1"))).rejects.toThrow();
    await expect(author.execute(request("run-1", { retryFeedback }))).rejects.toThrow();
    await author.execute(request("run-1", { retryFeedback }));
    await author.execute(request("run-1", { retryFeedback }));

    expect(requests[2]?.input).toMatchObject({
      revision: { rejectedProposal: proposal(secondRejection) },
    });
    expect(requests[3]?.input).not.toHaveProperty("revision");
  });

  it("clears a remembered revision when a proposal is accepted", async () => {
    const { author, requests } = agent([
      proposal(rejectedText),
      proposal(acceptedText),
      proposal(acceptedText),
    ]);

    await expect(author.execute(request("run-1"))).rejects.toThrow();
    await author.execute(request("run-1"));
    await author.execute(request("run-1", { retryFeedback }));

    expect(requests[2]?.input).not.toHaveProperty("revision");
  });
});

describe("local driver author revision", () => {
  const roots: string[] = [];
  beforeEach(() => resetAuthorRevisionMemoryForTests());
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function workspaceFiles(directory: string): Promise<string> {
    const entries = await readdir(directory, { recursive: true, withFileTypes: true });
    const contents = await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map((entry) => readFile(join(entry.parentPath, entry.name), "latin1")),
    );
    return contents.join("\n");
  }

  async function run(options: { readonly restartBeforeRetry: boolean }) {
    const root = await mkdtemp(join(tmpdir(), "author-revision-"));
    roots.push(root);
    const silent = { write: () => undefined };
    const inputs: Record<string, unknown>[] = [];
    const systemPrompts: string[] = [];
    const author: UserSessionProcessRunner = vi.fn(async (_command, args, runOptions) => {
      const input = JSON.parse(runOptions.stdin) as Record<string, unknown>;
      inputs.push(input);
      systemPrompts.push(args[args.indexOf("--system-prompt") + 1] ?? "");
      const chunks = input.retrievedEvidence as { id: string; text: string }[];
      const id = chunks.find((chunk) => chunk.text.includes("Built local-first"))?.id;
      if (!id) throw new Error("Missing selected evidence");
      const text =
        inputs.length === 1
          ? "Built 999 TypeScript tools with deterministic testing."
          : "Built local-first TypeScript tools with deterministic testing.";
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          session_id: `author-${inputs.length}`,
          usage: { input_tokens: 100, output_tokens: 200 },
          structured_output: {
            sections: [
              {
                title: "Summary",
                kind: "summary",
                blocks: [
                  {
                    type: "paragraph",
                    text,
                    claims: [{ text, substantive: true, evidenceChunkIds: [id] }],
                  },
                ],
              },
            ],
          },
        }),
      };
    });
    const critic: UserSessionProcessRunner = vi.fn(async (_command, args) => {
      const outputPath = args[args.indexOf("--output-last-message") + 1];
      if (!outputPath) throw new Error("Missing output path");
      await writeFile(outputPath, JSON.stringify({ findings: [] }));
      return {
        exitCode: 0,
        stderr: "",
        stdout: [
          JSON.stringify({ type: "thread.started", thread_id: "critic-thread" }),
          JSON.stringify({
            type: "turn.completed",
            usage: { input_tokens: 100, output_tokens: 10 },
          }),
        ].join("\n"),
      };
    });
    const driver = createLocalApplicationDriver({
      providerAuthModeConfiguration: { anthropic: "user-session", openai: "user-session" },
      userSessionRunners: { anthropic: author, openai: critic },
    });
    await mkdir(join(root, "evidence"));
    await writeFile(join(root, "job.md"), "TypeScript tools");
    await writeFile(
      join(root, "evidence", "resume.md"),
      "Built local-first TypeScript tools with deterministic testing.",
    );
    await driver.initialize({ root, jobDescription: "job.md", sources: "evidence" }, silent);
    const failed = await driver.start({ root, allowProviderData: true }, silent);
    if (options.restartBeforeRetry) resetAuthorRevisionMemoryForTests();
    const recovered = await driver.resume(
      { root, runId: failed.runId, allowProviderData: true },
      silent,
    );
    return { root, failed, recovered, inputs, systemPrompts };
  }

  it("revises the rejected proposal in process and keeps run history content-free", async () => {
    const { root, failed, recovered, inputs, systemPrompts } = await run({
      restartBeforeRetry: false,
    });

    expect(failed).toMatchObject({
      state: "provider-error",
      lastError: { failureStage: "factual-invariant-rejection" },
    });
    expect(recovered.state, JSON.stringify(recovered.lastError)).toBe("awaiting-approval");
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).not.toHaveProperty("revision");
    expect(inputs[1]).toMatchObject({
      retryFeedback: { failureStage: "factual-invariant-rejection" },
      revision: {
        rejectedProposal: {
          sections: [
            { blocks: [{ text: "Built 999 TypeScript tools with deterministic testing." }] },
          ],
        },
        report: expect.arrayContaining([
          expect.objectContaining({
            code: "factual_invariant_violation",
            problems: ['protected value "999" is not stated in cited evidence'],
          }),
        ]),
      },
    });
    expect(JSON.stringify(inputs[1]?.retryFeedback)).not.toContain("999");
    expect(systemPrompts[0]).not.toContain(authorRevisionInstructions);
    expect(systemPrompts[1]).toContain(authorRevisionInstructions);
    for (const snapshot of [failed, recovered]) {
      expect(JSON.stringify(snapshot)).not.toContain("Built 999");
      expect(JSON.stringify(snapshot)).not.toContain("is not stated in cited evidence");
    }
    const persisted = await workspaceFiles(join(root, ".draft-loop"));
    // The scan sees stored content: the accepted artifact text is persisted.
    expect(persisted).toContain("Built local-first TypeScript tools");
    expect(persisted).not.toContain("Built 999");
    expect(persisted).not.toContain("is not stated in cited evidence");
  });

  it("falls back to content-free retry feedback after a restart", async () => {
    const { recovered, inputs, systemPrompts } = await run({ restartBeforeRetry: true });

    expect(recovered.state, JSON.stringify(recovered.lastError)).toBe("awaiting-approval");
    expect(inputs[1]).toHaveProperty("retryFeedback");
    expect(inputs[1]).not.toHaveProperty("revision");
    expect(systemPrompts[1]).not.toContain(authorRevisionInstructions);
  });
});
