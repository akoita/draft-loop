import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type AnthropicClient,
  createApplicationService,
  createLocalApplicationDriver,
  type OpenAIClient,
  type ProviderClientFactories,
} from "@draft-loop/application";
import { describe, expect, it, vi } from "vitest";

import type { DesktopReviewState } from "../model.js";
import { createNativeHost, type NativeHost, type NativeHostDialogs } from "./host.js";

type AnthropicParameters = Parameters<AnthropicClient["messages"]["create"]>[0];
type OpenAIParameters = Parameters<OpenAIClient["responses"]["create"]>[0];

interface JsonRecord {
  readonly [key: string]: unknown;
}

interface SerializedModelInput extends JsonRecord {
  readonly retrievedEvidence?: readonly JsonRecord[];
  readonly round?: number;
  readonly artifact?: JsonRecord;
}

function parseSerializedInput(serialized: string): SerializedModelInput {
  const value: unknown = JSON.parse(serialized);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The fake transport received a non-object JSON input.");
  }
  return value as SerializedModelInput;
}

function evidenceChunkId(input: SerializedModelInput): string {
  const retrievedEvidence = input.retrievedEvidence;
  const first = retrievedEvidence?.[0];
  if (first === undefined || typeof first.id !== "string" || first.id.trim() === "") {
    throw new Error("The fake author transport received no serialized evidence chunk.");
  }
  return first.id;
}

function anthropicInput(parameters: AnthropicParameters): SerializedModelInput {
  const firstMessage = parameters.messages[0];
  if (firstMessage === undefined || typeof firstMessage.content !== "string") {
    throw new Error("The fake author transport received no serialized user message.");
  }
  return parseSerializedInput(firstMessage.content);
}

function openAiInput(parameters: OpenAIParameters): SerializedModelInput {
  if (!Array.isArray(parameters.input)) {
    throw new Error("The fake critic transport received no input array.");
  }
  const firstInput = parameters.input[0];
  if (
    typeof firstInput !== "object" ||
    firstInput === null ||
    !("content" in firstInput) ||
    !Array.isArray(firstInput.content)
  ) {
    throw new Error("The fake critic transport received no structured user input.");
  }
  const firstContent = firstInput.content[0];
  if (
    typeof firstContent !== "object" ||
    firstContent === null ||
    !("text" in firstContent) ||
    typeof firstContent.text !== "string"
  ) {
    throw new Error("The fake critic transport received no serialized user text.");
  }
  return parseSerializedInput(firstContent.text);
}

function authorProposal(version: number, chunkId: string): JsonRecord {
  const summary =
    version === 1
      ? "TypeScript engineer building local-first tools with deterministic testing."
      : "TypeScript engineer improving local-first tools with deterministic testing after review.";
  const experience =
    version === 1
      ? "Built local-first TypeScript tools with deterministic testing."
      : "Improved local-first TypeScript tools with deterministic testing through a reviewed revision.";
  return {
    sections: [
      {
        title: "Summary",
        kind: "summary",
        blocks: [
          {
            type: "paragraph",
            text: summary,
            claims: [{ text: summary, substantive: true, evidenceChunkIds: [chunkId] }],
          },
        ],
      },
      {
        title: "Experience",
        kind: "experience",
        blocks: [
          {
            type: "bullet",
            text: experience,
            claims: [{ text: experience, substantive: true, evidenceChunkIds: [chunkId] }],
          },
        ],
      },
      {
        title: "Education",
        kind: "education",
        blocks: [
          {
            type: "bullet",
            text: "Studied software engineering with a focus on testing and accessibility.",
            claims: [],
          },
        ],
      },
      {
        title: "Skills",
        kind: "skills",
        blocks: [
          {
            type: "bullet",
            text: "TypeScript, Node.js, automated testing, accessibility, technical writing.",
            claims: [],
          },
        ],
      },
    ],
  };
}

function anthropicResponse(
  output: JsonRecord,
  requestId: string,
): ReturnType<AnthropicClient["messages"]["create"]> {
  const response = {
    id: requestId,
    content: [{ type: "text", text: JSON.stringify(output) }],
    model: "claude-sonnet-4-5",
    stop_reason: "end_turn",
    usage: { input_tokens: 101, output_tokens: 41 },
  };
  return Object.assign(Promise.resolve(response), {
    withResponse: async () => ({ data: response, request_id: requestId }),
  }) as ReturnType<AnthropicClient["messages"]["create"]>;
}

function openAiResponse(
  output: JsonRecord,
  requestId: string,
): ReturnType<OpenAIClient["responses"]["create"]> {
  const outputText = JSON.stringify(output);
  const response = {
    id: requestId,
    model: "gpt-5.6-luna",
    output_text: outputText,
    output: [
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: outputText, annotations: [] }],
      },
    ],
    status: "completed",
    usage: {
      input_tokens: 73,
      output_tokens: 19,
      total_tokens: 92,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
    _request_id: requestId,
  };
  return Promise.resolve(
    response as unknown as Awaited<ReturnType<OpenAIClient["responses"]["create"]>>,
  );
}

function resultValue<T>(result: unknown): T {
  if (
    typeof result !== "object" ||
    result === null ||
    !("ok" in result) ||
    result.ok !== true ||
    !("value" in result)
  ) {
    throw new Error(`Expected a successful bridge result: ${JSON.stringify(result)}`);
  }
  return result.value as T;
}

function reviewValue(result: unknown): DesktopReviewState {
  return resultValue<DesktopReviewState>(result);
}

async function waitForReview(
  host: NativeHost,
  workspaceId: string,
  predicate: (state: DesktopReviewState) => boolean,
): Promise<DesktopReviewState> {
  let latest: DesktopReviewState | undefined;
  await vi.waitFor(
    async () => {
      latest = reviewValue(await host.invoke({ type: "review.load", input: { workspaceId } }));
      expect(latest.setup.fixtureMode).toBe(false);
      expect(predicate(latest)).toBe(true);
    },
    { timeout: 5_000, interval: 10 },
  );
  if (latest === undefined) throw new Error("The review did not produce a state.");
  return latest;
}

describe("full real-mode native host draft workflow", () => {
  it("runs sanitized author, revision, critic, persistence, approval, and Markdown export", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-full-draft-"));
    const workspaceRoot = join(parent, "sanitized-workspace");
    const jobPath = join(parent, "sanitized-job.md");
    const candidatePath = join(parent, "sanitized-candidate.md");
    const exportPath = join(workspaceRoot, "exports", "approved-cv.md");
    await writeFile(
      jobPath,
      "Build TypeScript local-first tools with deterministic testing.\n",
      "utf8",
    );
    await writeFile(
      candidatePath,
      "Sanitized candidate evidence: Built TypeScript local-first tools with deterministic testing.\n",
      "utf8",
    );

    const authorRequests: Array<{
      readonly model: string;
      readonly maxTokens: number;
      readonly round: number;
      readonly evidenceChunkId: string;
    }> = [];
    const criticRequests: Array<{
      readonly model: string;
      readonly maxOutputTokens: number;
      readonly store: boolean;
      readonly strict: boolean;
      readonly round: number;
      readonly artifactVersion: number;
    }> = [];
    const credentialCalls: string[] = [];
    const factoryCredentials: string[] = [];

    const anthropicClient: AnthropicClient = {
      messages: {
        create: (parameters) => {
          const input = anthropicInput(parameters);
          const chunkId = evidenceChunkId(input);
          expect(parameters.model).toBe("claude-sonnet-4-5");
          expect(parameters.max_tokens).toBe(8192);
          expect(parameters.output_config).toEqual(
            expect.objectContaining({
              format: expect.objectContaining({
                type: "json_schema",
                schema: expect.objectContaining({
                  type: "object",
                  additionalProperties: false,
                }),
              }),
            }),
          );
          authorRequests.push({
            model: parameters.model,
            maxTokens: parameters.max_tokens,
            round: input.round ?? 0,
            evidenceChunkId: chunkId,
          });
          const version = authorRequests.length;
          return anthropicResponse(authorProposal(version, chunkId), `anthropic-e2e-${version}`);
        },
      },
    };

    const openAiClient: OpenAIClient = {
      responses: {
        create: async (parameters) => {
          const input = openAiInput(parameters);
          const artifact = input.artifact;
          const artifactVersion =
            artifact !== undefined && typeof artifact.version === "number" ? artifact.version : 0;
          if (typeof parameters.model !== "string") {
            throw new Error("The fake critic transport received no model.");
          }
          if (parameters.max_output_tokens !== 16_384) {
            throw new Error("The fake critic transport received an unexpected output budget.");
          }
          if (parameters.store !== false) {
            throw new Error("The fake critic transport must not store responses.");
          }
          expect(parameters.model).toBe("gpt-5.6-luna");
          expect(parameters.max_output_tokens).toBe(16_384);
          expect(parameters.store).toBe(false);
          expect(parameters.text).toEqual(
            expect.objectContaining({
              format: expect.objectContaining({
                type: "json_schema",
                strict: true,
                schema: expect.objectContaining({
                  type: "object",
                  additionalProperties: false,
                }),
              }),
            }),
          );
          criticRequests.push({
            model: parameters.model,
            maxOutputTokens: parameters.max_output_tokens,
            store: parameters.store,
            strict: true,
            round: input.round ?? 0,
            artifactVersion,
          });
          const findings =
            criticRequests.length === 1
              ? {
                  findings: [
                    {
                      id: "sanitized-review-warning",
                      code: "review-warning",
                      category: "quality",
                      severity: "warning",
                      message: "Review the tailored claims before approval.",
                    },
                  ],
                }
              : { findings: [] };
          return openAiResponse(findings, `openai-e2e-${criticRequests.length}`);
        },
      },
    };

    const providerClientFactories: ProviderClientFactories = {
      anthropic: (apiKey) => {
        factoryCredentials.push(`anthropic:${apiKey}`);
        return anthropicClient;
      },
      openai: (apiKey) => {
        factoryCredentials.push(`openai:${apiKey}`);
        return openAiClient;
      },
    };
    const applicationService = createApplicationService(
      createLocalApplicationDriver({
        resolveCredential: async (provider) => {
          credentialCalls.push(provider);
          return provider === "anthropic" ? "fake-anthropic-key" : "fake-openai-key";
        },
        providerClientFactories,
      }),
    );
    const dialogs: NativeHostDialogs = {
      chooseDirectory: async (mode) => (mode === "create" ? parent : workspaceRoot),
      chooseFiles: async (input) =>
        input.target === "job-description" ? [jobPath] : [candidatePath],
      chooseMarkdownExportPath: async () => exportPath,
    };
    const createHost = () =>
      createNativeHost({
        applicationService,
        dialogs,
        requireProviderPreflight: true,
      });

    try {
      const host = createHost();
      const created = resultValue<{ readonly workspace: { readonly id: string } }>(
        await host.invoke({
          type: "workspace.create",
          input: { name: "sanitized-workspace", mode: "real" },
        }),
      );
      const workspaceId = created.workspace.id;
      expect((await applicationService.readWorkspace(workspaceRoot)).fixtureMode).toBe(false);

      expect(
        resultValue(
          await host.invoke({
            type: "file.select",
            input: {
              workspaceId,
              target: "job-description",
              extensions: [".md"],
              multiple: false,
            },
          }),
        ),
      ).toMatchObject({ files: [{ relativePath: "job.md", mediaType: "text/markdown" }] });
      expect(
        resultValue(
          await host.invoke({
            type: "file.select",
            input: {
              workspaceId,
              target: "evidence",
              extensions: [".md"],
              multiple: false,
            },
          }),
        ),
      ).toMatchObject({ files: [{ relativePath: "evidence/imported/sanitized-candidate.md" }] });

      const beforeAcknowledgement = reviewValue(
        await host.invoke({ type: "review.load", input: { workspaceId } }),
      );
      expect(beforeAcknowledgement.setup.fixtureMode).toBe(false);
      expect(beforeAcknowledgement.providerTransmissionPreflight).toMatchObject({
        required: true,
        acknowledged: false,
      });
      const fingerprint = beforeAcknowledgement.providerTransmissionPreflight.fingerprint;
      const acknowledged = reviewValue(
        await host.invoke({
          type: "review.dispatch",
          input: {
            workspaceId,
            runId: "pending",
            action: { type: "acknowledge-provider-transmission", fingerprint },
          },
        }),
      );
      expect(acknowledged.providerTransmissionPreflight).toMatchObject({
        required: true,
        acknowledged: true,
      });

      const started = reviewValue(
        await host.invoke({
          type: "review.dispatch",
          input: { workspaceId, runId: "pending", action: { type: "start" } },
        }),
      );
      expect(started.setup.fixtureMode).toBe(false);
      const firstReview = await waitForReview(
        host,
        workspaceId,
        (state) => state.state === "awaiting-approval" && state.artifact.version === 1,
      );
      expect(firstReview).toMatchObject({
        state: "awaiting-approval",
        approval: "pending",
        reviewComplete: true,
        artifact: { version: 1 },
        findings: [
          {
            severity: "warning",
            message: "Review the tailored claims before approval.",
          },
        ],
      });
      expect(firstReview.artifact.sections.map((section) => section.title)).toEqual([
        "Summary",
        "Experience",
        "Education",
        "Skills",
      ]);
      expect(firstReview.artifact.claims.every((claim) => claim.evidence.length > 0)).toBe(true);

      const revisionRequested = reviewValue(
        await host.invoke({
          type: "review.dispatch",
          input: {
            workspaceId,
            runId: firstReview.runId,
            action: { type: "request-revision" },
          },
        }),
      );
      expect(revisionRequested).toMatchObject({ state: "revising", approval: "rejected" });
      const resumed = reviewValue(
        await host.invoke({
          type: "review.dispatch",
          input: {
            workspaceId,
            runId: firstReview.runId,
            action: { type: "resume" },
          },
        }),
      );
      expect(resumed.setup.fixtureMode).toBe(false);
      const finalReview = await waitForReview(
        host,
        workspaceId,
        (state) =>
          state.state === "awaiting-approval" &&
          state.artifact.version === 2 &&
          state.reviewComplete &&
          state.findings.length === 0,
      );
      expect(finalReview).toMatchObject({
        state: "awaiting-approval",
        approval: "pending",
        reviewComplete: true,
        artifact: { version: 2 },
        findings: [],
        setup: { fixtureMode: false },
      });
      expect(finalReview.artifact.sections.map((section) => section.title)).toEqual([
        "Summary",
        "Experience",
        "Education",
        "Skills",
      ]);
      expect(finalReview.artifact.claims.every((claim) => claim.evidence.length > 0)).toBe(true);

      const finalSnapshot = await applicationService.status({
        root: workspaceRoot,
        runId: firstReview.runId,
      });
      expect(
        finalSnapshot?.executionHistory.map(({ step, round, provider, modelId }) => ({
          step,
          round,
          provider,
          modelId,
        })),
      ).toEqual([
        { step: "author", round: 1, provider: "anthropic", modelId: "claude-sonnet-4-5" },
        { step: "critic", round: 1, provider: "openai", modelId: "gpt-5.6-luna" },
        { step: "revision", round: 2, provider: "anthropic", modelId: "claude-sonnet-4-5" },
        { step: "critic", round: 2, provider: "openai", modelId: "gpt-5.6-luna" },
      ]);
      expect(authorRequests).toMatchObject([
        { model: "claude-sonnet-4-5", maxTokens: 8192, round: 1 },
        { model: "claude-sonnet-4-5", maxTokens: 8192, round: 2 },
      ]);
      expect(authorRequests[0]?.evidenceChunkId).toBe(authorRequests[1]?.evidenceChunkId);
      expect(criticRequests).toEqual([
        {
          model: "gpt-5.6-luna",
          maxOutputTokens: 16_384,
          store: false,
          strict: true,
          round: 1,
          artifactVersion: 1,
        },
        {
          model: "gpt-5.6-luna",
          maxOutputTokens: 16_384,
          store: false,
          strict: true,
          round: 2,
          artifactVersion: 2,
        },
      ]);
      expect(credentialCalls).toEqual(["anthropic", "openai", "anthropic", "openai"]);
      expect(factoryCredentials).toEqual([
        "anthropic:fake-anthropic-key",
        "openai:fake-openai-key",
        "anthropic:fake-anthropic-key",
        "openai:fake-openai-key",
      ]);

      const restartedHost = createHost();
      expect(
        resultValue(await restartedHost.invoke({ type: "workspace.open", input: {} })),
      ).toMatchObject({ workspace: { id: workspaceId } });
      const persistedReview = reviewValue(
        await restartedHost.invoke({
          type: "review.load",
          input: { workspaceId, runId: firstReview.runId },
        }),
      );
      expect(persistedReview).toMatchObject({
        state: "awaiting-approval",
        approval: "pending",
        reviewComplete: true,
        artifact: { version: 2 },
        findings: [],
        setup: { fixtureMode: false },
      });

      const approved = reviewValue(
        await restartedHost.invoke({
          type: "review.dispatch",
          input: {
            workspaceId,
            runId: firstReview.runId,
            action: { type: "approve" },
          },
        }),
      );
      expect(approved).toMatchObject({ state: "approved", approval: "approved" });
      const exported = reviewValue(
        await restartedHost.invoke({
          type: "review.dispatch",
          input: {
            workspaceId,
            runId: firstReview.runId,
            action: { type: "export" },
          },
        }),
      );
      expect(exported).toMatchObject({ state: "exported", approval: "approved" });
      expect(exported.exportPath).toBe(exportPath);
      const exportedContent = await readFile(exportPath, "utf8");
      expect(exportedContent).toContain("## Summary");
      expect(exportedContent).toContain("## Experience");
      expect(exportedContent).toContain("improving local-first tools");

      const finalRestart = createHost();
      await finalRestart.invoke({ type: "workspace.open", input: {} });
      const persistedTerminalState = reviewValue(
        await finalRestart.invoke({
          type: "review.load",
          input: { workspaceId, runId: firstReview.runId },
        }),
      );
      expect(persistedTerminalState).toMatchObject({
        state: "exported",
        approval: "approved",
        reviewComplete: true,
        artifact: { version: 2 },
        setup: { fixtureMode: false },
      });
      expect(JSON.stringify(persistedTerminalState)).not.toContain("fake-anthropic-key");
      expect(JSON.stringify(persistedTerminalState)).not.toContain("fake-openai-key");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
