import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ContextSnapshot } from "@draft-loop/domain";
import { buildApplicationReadinessStoppingDecision } from "@draft-loop/orchestrator";
import type { UserSessionProcessRunner } from "@draft-loop/providers";
import { openSqliteStorage } from "@draft-loop/storage";
import { expect, it, vi } from "vitest";

import { createAuthorAdjudicationPrompt } from "./author-adjudication.js";
import { createLocalApplicationDriver } from "./local.js";

// Lets one test record a run exactly as a build that predates cli-author-v2
// did, then resume it with the current build.
const recordedAuthorVersion = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("./author-adjudication.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./author-adjudication.js")>();
  return {
    ...actual,
    promptTemplateVersion: (role: "author" | "critic") =>
      role === "author" && recordedAuthorVersion.value !== undefined
        ? recordedAuthorVersion.value
        : actual.promptTemplateVersion(role),
  };
});

const structuredFieldInstruction = "For heading lines (role, organisation, location, dates)";
const claimText = "Built local-first TypeScript tools with deterministic testing.";

async function contextModels(root: string, contextSnapshotId: string) {
  const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
  try {
    const context = await storage.getContextSnapshot(contextSnapshotId);
    if (!context) throw new Error("Missing context");
    return context.payload as unknown as ContextSnapshot;
  } finally {
    await storage.close();
  }
}

it("resumes a cli-author-v1 run with its v1 prompt while new runs record cli-author-v2", async () => {
  const root = await mkdtemp(join(tmpdir(), "author-prompt-version-"));
  const output: string[] = [];
  const io = { write: (line: string) => void output.push(line) };
  const systemPrompts: string[] = [];
  const author: UserSessionProcessRunner = vi.fn(async (_command, args, options) => {
    systemPrompts.push(args[args.indexOf("--system-prompt") + 1] ?? "");
    const input = JSON.parse(options.stdin) as {
      retrievedEvidence: { id: string; text: string }[];
    };
    const id = input.retrievedEvidence.find((chunk) =>
      chunk.text.includes("Built local-first"),
    )?.id;
    if (!id) throw new Error("Missing selected evidence");
    return {
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: `author-${systemPrompts.length}`,
        usage: { input_tokens: 100, output_tokens: 200 },
        structured_output: {
          sections: [
            {
              title: "Summary",
              kind: "summary",
              blocks: [
                {
                  type: "paragraph",
                  text: claimText,
                  claims: [{ text: claimText, substantive: true, evidenceChunkIds: [id] }],
                },
              ],
            },
          ],
        },
      }),
    };
  });
  const critic = vi.fn<UserSessionProcessRunner>(async (_command, args) => {
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
  });
  try {
    await mkdir(join(root, "evidence"));
    await writeFile(join(root, "job.md"), "TypeScript tools");
    await writeFile(
      join(root, "evidence", "resume.md"),
      `## Transition - June 2005 to December 2006\n\n${claimText}`,
    );
    await driver.initialize(
      { root, jobDescription: "job.md", sources: "evidence", maxRounds: 2 },
      io,
    );

    recordedAuthorVersion.value = "cli-author-v1";
    const initial = await driver.start({ root, allowProviderData: true }, io);
    recordedAuthorVersion.value = undefined;
    expect(initial.state, JSON.stringify(initial.lastError)).toBe("awaiting-approval");
    if (!initial.artifact) throw new Error("Missing first artifact");
    const legacy = await contextModels(root, initial.contextSnapshotId);
    expect(legacy.modelConfiguration.author.promptTemplateVersion).toBe("cli-author-v1");
    expect(legacy.modelConfiguration.critic.promptTemplateVersion).toBe("cli-critic-v1");

    const report = buildApplicationReadinessStoppingDecision({
      artifact: initial.artifact,
      context: legacy,
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
        decisions: report.findings.map((finding) => ({
          findingId: finding.id,
          disposition: finding.code === "concise" ? "accept" : "nuance",
          rationale: "Shorten wording; preserve supported facts and evidence.",
        })),
      },
      io,
    );

    const resumed = await driver.resume(
      { root, runId: initial.runId, allowProviderData: true },
      io,
    );

    expect(resumed.state, JSON.stringify(resumed.lastError)).toBe("awaiting-approval");
    expect(resumed.lastError ?? null).toBeNull();
    expect(resumed.artifact?.version).toBe(2);
    expect(output.join("\n")).not.toContain("provider.failed");
    expect(output.join("\n")).not.toContain("provider-error");
    expect(systemPrompts).toHaveLength(2);
    // The system prompt depends only on the version and which carriers are present.
    const pending = {} as Parameters<typeof createAuthorAdjudicationPrompt>[1];
    expect(systemPrompts[0]).toBe(
      createAuthorAdjudicationPrompt("cli-author-v1", undefined).systemPrompt,
    );
    expect(systemPrompts[1]).toBe(
      createAuthorAdjudicationPrompt("cli-author-v1", pending).systemPrompt,
    );
    expect(systemPrompts[1]).toContain("This is an adjudicated revision.");
    expect(systemPrompts.join("\n")).not.toContain(structuredFieldInstruction);

    const fresh = await driver.start({ root, allowProviderData: true }, io);
    expect(fresh.state, JSON.stringify(fresh.lastError)).toBe("awaiting-approval");
    const current = await contextModels(root, fresh.contextSnapshotId);
    expect(current.modelConfiguration.author.promptTemplateVersion).toBe("cli-author-v2");
    expect(current.modelConfiguration.critic.promptTemplateVersion).toBe("cli-critic-v1");
    expect(systemPrompts).toHaveLength(3);
    expect(systemPrompts[2]).toBe(
      createAuthorAdjudicationPrompt("cli-author-v2", undefined).systemPrompt,
    );
    expect(systemPrompts[2]).toContain(structuredFieldInstruction);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
