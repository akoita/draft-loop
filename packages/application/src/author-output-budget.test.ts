import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ContextSnapshot, ModelSelection } from "@draft-loop/domain";
import {
  buildApplicationReadinessStoppingDecision,
  runFailureStages,
} from "@draft-loop/orchestrator";
import {
  AnthropicClaudeUserSessionAdapter,
  type JsonObject,
  providerFailureStages,
  type UserSessionProcessRunner,
} from "@draft-loop/providers";
import { authorArtifactProposalJsonSchemaForEvidence } from "@draft-loop/schemas";
import { openSqliteStorage } from "@draft-loop/storage";
import { expect, it, vi } from "vitest";
import { createAuthorAdjudicationPrompt, promptTemplateVersion } from "./author-adjudication.js";
import { createLocalApplicationDriver } from "./local.js";

it("keeps provider and orchestrator failure stages identical", () => {
  expect(providerFailureStages).toEqual(runFailureStages);
});

it("classifies Claude's structured-output cap exhaustion and accepts the next separate request", async () => {
  const maxOutputTokens = 32_768;
  const claimText = "Built local-first TypeScript tools.";
  const evidenceId = "resume-evidence";
  const authorPrompt = createAuthorAdjudicationPrompt(promptTemplateVersion("author"), undefined);
  const model: ModelSelection = {
    company: "anthropic",
    modelId: "claude-exact",
    role: "author",
    promptTemplateVersion: promptTemplateVersion("author"),
  };
  const request = {
    contextSnapshotId: "context-v4-budget",
    model,
    systemPrompt: authorPrompt.systemPrompt,
    input: JSON.parse(
      JSON.stringify({
        retrievedEvidence: [{ id: evidenceId, text: claimText }],
        ...authorPrompt.providerInput,
      }),
    ) as JsonObject,
    outputSchema: authorArtifactProposalJsonSchemaForEvidence([
      evidenceId,
    ]) as unknown as JsonObject,
    outputName: "author_artifact_proposal",
    maxOutputTokens: authorPrompt.providerInput.outputBudget.maxOutputTokens,
    dataPolicy: {
      allowTransmission: true,
      allowedCompanies: ["anthropic", "openai"],
      sensitiveData: false,
      sensitiveDataAcknowledged: false,
    },
  };
  expect(request.maxOutputTokens).toBe(maxOutputTokens);
  const proposal = {
    sections: [
      {
        title: "Summary",
        kind: "summary",
        blocks: [
          {
            type: "paragraph",
            text: claimText,
            claims: [{ text: claimText, substantive: true, evidenceChunkIds: [evidenceId] }],
          },
        ],
      },
    ],
  };
  let callCount = 0;
  const runner: UserSessionProcessRunner = vi.fn(async (_command, _args, options) => {
    callCount += 1;
    expect(options.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe(String(maxOutputTokens));
    expect(JSON.parse(options.stdin)).toMatchObject({ outputBudget: { maxOutputTokens } });
    if (callCount === 1) {
      return {
        exitCode: 1,
        stderr: "",
        stdout: JSON.stringify({
          type: "result",
          subtype: "error_max_structured_output_retries",
          is_error: true,
          session_id: "claude-cap-exhausted",
          terminal_reason: "structured_output_retry_exhausted",
          stop_reason: "max_tokens",
          usage: { input_tokens: 100, output_tokens: maxOutputTokens },
          structured_output: proposal,
        }),
      };
    }
    return {
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: "claude-next-request",
        usage: { input_tokens: 100, output_tokens: maxOutputTokens },
        structured_output: proposal,
      }),
    };
  });
  const adapter = new AnthropicClaudeUserSessionAdapter({
    configuredModel: model,
    runner,
  });

  await expect(adapter.execute(request)).rejects.toMatchObject({
    code: "invalid-response",
    retryable: false,
    failureStage: "output-token-budget-exceeded",
    diagnostics: expect.arrayContaining([
      { code: "output_token_budget_exceeded", path: "usage.outputTokens" },
    ]),
  });
  const nextRequest = await adapter.execute(request);
  expect(nextRequest.usage.outputTokens).toBe(maxOutputTokens);
  expect(nextRequest.output).toEqual(proposal);
  expect(runner).toHaveBeenCalledTimes(2);
});

it("retains the exact per-generation cap and adjudication through a factuality retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "author-output-budget-"));
  const silent = { write: () => undefined };
  const inputs: Record<string, unknown>[] = [];
  const author: UserSessionProcessRunner = vi.fn(async (_command, args, options) => {
    const input = JSON.parse(options.stdin) as Record<string, unknown>;
    inputs.push(input);
    const cap = Number(options.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS);
    // New runs record cli-author-v4, whose budget is 32,768 tokens.
    expect(cap).toBe(32768);
    expect(input.outputBudget).toEqual({ maxOutputTokens: cap });
    const system = args[args.indexOf("--system-prompt") + 1] ?? "";
    expect(system).toContain(`maximum generated output for this request is ${cap} tokens`);
    expect(system).toContain("one compact JSON proposal");
    expect(system).toContain("including factuality corrections");
    expect(system).toContain("required sections, chronology, and evidence citations");
    expect(system).toContain("never invent facts absent from supplied material");
    const evidence = input.retrievedEvidence as { id: string; text: string }[];
    expect(evidence.some((chunk) => chunk.text.includes("June 2005 to December 2006"))).toBe(true);
    const id = evidence.find((chunk) => chunk.text.includes("Built local-first"))?.id;
    if (!id) throw new Error("Missing selected evidence");
    const text =
      inputs.length === 2
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
        usage: { input_tokens: 100, output_tokens: inputs.length === 2 ? cap + 1 : 200 },
        ...(inputs.length === 2 ? { num_turns: 3, stop_reason: "tool_use" } : {}),
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
  const critic = vi.fn<UserSessionProcessRunner>(async (_command, args, options) => {
    expect(options.stdin).not.toContain('"outputBudget"');
    expect(options.stdin).toContain("June 2005 to December 2006");
    const outputPath = args[args.indexOf("--output-last-message") + 1];
    if (!outputPath) throw new Error("Missing output path");
    await writeFile(outputPath, JSON.stringify({ findings: [] }));
    return {
      exitCode: 0,
      stderr: "",
      stdout: [
        JSON.stringify({ type: "thread.started", thread_id: "critic-thread" }),
        JSON.stringify({ type: "turn.completed", usage: { input_tokens: 100, output_tokens: 10 } }),
      ].join("\n"),
    };
  });
  const driver = createLocalApplicationDriver({
    providerAuthModeConfiguration: { anthropic: "user-session", openai: "user-session" },
    userSessionRunners: { anthropic: author, openai: critic },
    authorProposalCaptureDirectory: join(root, "captures"),
  });
  try {
    await mkdir(join(root, "evidence"));
    await mkdir(join(root, "captures"));
    await writeFile(join(root, "job.md"), "TypeScript tools");
    await writeFile(
      join(root, "evidence", "resume.md"),
      "## Transition - June 2005 to December 2006\n\nBuilt local-first TypeScript tools with deterministic testing.",
    );
    await driver.initialize(
      { root, jobDescription: "job.md", sources: "evidence", maxRounds: 2 },
      silent,
    );
    const initial = await driver.start({ root, allowProviderData: true }, silent);
    expect(initial.state, JSON.stringify(initial.lastError)).toBe("awaiting-approval");
    if (!initial.artifact) throw new Error("Missing first artifact");
    const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
    const context = await storage.getContextSnapshot(initial.contextSnapshotId);
    await storage.close();
    if (!context) throw new Error("Missing context");
    const report = buildApplicationReadinessStoppingDecision({
      artifact: initial.artifact,
      context: context.payload as unknown as ContextSnapshot,
      critiqueFindings: [
        {
          id: "concise",
          code: "concise",
          category: "quality",
          severity: "warning",
          message: "Shorten redundant wording without losing the supported achievement.",
        },
      ],
      round: initial.round,
      budget: initial.budget,
      priorScoreHistory: initial.scoreHistory,
      createdAt: initial.updatedAt,
    }).report;
    if (!driver.requestAdjudicatedRevision) throw new Error("Missing staging contract");
    await driver.requestAdjudicatedRevision(
      {
        root,
        runId: initial.runId,
        report,
        decisions: report.findings.map((f) => ({
          findingId: f.id,
          disposition: f.code === "concise" ? "accept" : "nuance",
          rationale: "Shorten wording; preserve supported facts and evidence.",
        })),
      },
      silent,
    );
    const resume = () =>
      driver.resume({ root, runId: initial.runId, allowProviderData: true }, silent);
    const factual = await resume();
    expect(factual.lastError).toMatchObject({
      attempt: 1,
      failureStage: "factual-invariant-rejection",
      failureReason: "factual-invariant-rejection",
    });
    expect(factual.artifact).toEqual(initial.artifact);
    const captures = await readdir(join(root, "captures"));
    expect(captures).toHaveLength(1);
    const capture = JSON.parse(
      await readFile(join(root, "captures", captures[0] ?? "missing", "replay.json"), "utf8"),
    );
    expect(capture.validationInputs.proposal.sections[0].blocks[0].text).toContain("999");
    expect(JSON.stringify(factual)).not.toContain("Built 999");
    expect(JSON.stringify(factual)).not.toContain(join(root, "captures"));
    const completed = await resume();
    expect(completed.state, JSON.stringify(completed.lastError)).toBe("awaiting-approval");
    expect(completed.artifact?.version).toBe(2);
    expect(inputs).toHaveLength(3);
    expect(inputs[0]).not.toHaveProperty("pendingAdjudication");
    for (const input of inputs.slice(1))
      expect(input.pendingAdjudication).toEqual(inputs[1]?.pendingAdjudication);
    expect(inputs[2]?.retryFeedback).toMatchObject({ failureStage: "factual-invariant-rejection" });
    expect(critic).toHaveBeenCalledTimes(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
