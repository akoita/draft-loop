import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  AnthropicClient,
  OpenAIClient,
  UserSessionProcessRunner,
} from "@draft-loop/providers";
import { openSqliteStorage } from "@draft-loop/storage";
import { describe, expect, it, vi } from "vitest";

import { createLocalApplicationDriver } from "./local.js";

const silent = { write: () => undefined };

async function providerWorkspace(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(root, "evidence"));
  await writeFile(join(root, "job.md"), "Build reliable TypeScript tools.\n", "utf8");
  await writeFile(join(root, "evidence", "resume.md"), "Built TypeScript tools.\n", "utf8");
  return root;
}

async function initializeWorkspace(
  root: string,
  authorCompany: "anthropic" | "openai",
  criticCompany: "anthropic" | "openai",
): Promise<void> {
  await createLocalApplicationDriver().initialize(
    {
      root,
      jobDescription: "job.md",
      sources: "evidence",
      authorCompany,
      authorModel: authorCompany === "anthropic" ? "claude-sonnet-4-5" : "gpt-5.6-luna",
      criticCompany,
      criticModel: criticCompany === "anthropic" ? "claude-sonnet-4-5" : "gpt-5.6-luna",
    },
    silent,
  );
}

function claudeUnknownCategoryRunner(
  subtype: string,
  terminalReason: string,
): UserSessionProcessRunner {
  return vi.fn(async () => ({
    exitCode: 1,
    stdout: JSON.stringify({
      type: "result",
      is_error: true,
      subtype,
      terminal_reason: terminalReason,
      stop_reason: "stop_sequence",
      api_error_status: 503,
      result: "synthetic-private-result-marker",
      errors: ["synthetic-private-errors-marker"],
      session_id: "synthetic-private-session-marker",
      usage: { private: "synthetic-private-usage-marker" },
      structured_output: { private: "synthetic-private-structured-output-marker" },
      prompt: "synthetic-private-prompt-marker",
      path: "/synthetic/private/path-marker",
      api_key: "synthetic-secret-credential-marker",
    }),
    stderr: "synthetic-private-stderr-marker",
  }));
}

describe("local Claude category capture routing", () => {
  it("routes only unknown Anthropic user-session categories to the configured local parent", async () => {
    const root = await providerWorkspace("draft-loop-app-claude-capture-");
    const captureParent = await mkdtemp(join(tmpdir(), "draft-loop-app-claude-capture-parent-"));
    const subtype = "future_application_error_category";
    const terminalReason = "future_application_terminal_reason";
    const runner = claudeUnknownCategoryRunner(subtype, terminalReason);
    const output: string[] = [];
    const io = { write: (line: string) => output.push(line) };
    const driver = createLocalApplicationDriver({
      localClaudeCategoryCaptureParent: captureParent,
      providerAuthModeConfiguration: { anthropic: "user-session", openai: "api-key" },
      userSessionRunners: { anthropic: runner },
      resolveCredential: async () => "synthetic-secret-credential-marker",
    });

    try {
      await initializeWorkspace(root, "anthropic", "openai");
      const snapshot = await driver.start({ root, allowProviderData: true }, io);

      expect(snapshot).toMatchObject({
        state: "provider-error",
        lastError: {
          code: "transient",
          message: "The provider request failed. You can retry safely.",
          provider: "anthropic",
          step: "author",
          retryable: true,
        },
      });
      expect(snapshot.lastError?.diagnostics).toContainEqual({
        code: "local_claude_category_capture_saved",
        path: "local_claude_category_capture",
      });
      expect(runner).toHaveBeenCalledOnce();

      const directories = await readdir(captureParent);
      expect(directories).toHaveLength(1);
      const directoryName = directories[0];
      if (directoryName === undefined) throw new Error("Expected a category capture directory.");
      const captureDirectory = join(captureParent, directoryName);
      const captureText = await readFile(join(captureDirectory, "categories.json"), "utf8");
      expect(JSON.parse(captureText)).toEqual({ subtype, terminal_reason: terminalReason });

      const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
      try {
        const history = {
          run: await storage.getRun(snapshot.runId),
          events: await storage.listAuditEvents(snapshot.workspaceId),
        };
        const durableText = JSON.stringify({ snapshot, history, output });
        for (const marker of [
          subtype,
          terminalReason,
          captureParent,
          directoryName,
          "synthetic-private-result-marker",
          "synthetic-private-errors-marker",
          "synthetic-private-session-marker",
          "synthetic-private-usage-marker",
          "synthetic-private-structured-output-marker",
          "synthetic-private-prompt-marker",
          "/synthetic/private/path-marker",
          "synthetic-secret-credential-marker",
          "synthetic-private-stderr-marker",
        ]) {
          expect(durableText).not.toContain(marker);
        }
      } finally {
        await storage.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(captureParent, { recursive: true, force: true });
    }
  });

  it("leaves capture disabled by default for an Anthropic user session", async () => {
    const root = await providerWorkspace("draft-loop-app-claude-capture-default-");
    const subtype = "future_default_category_marker";
    const runner = claudeUnknownCategoryRunner(subtype, "future_default_terminal");
    const output: string[] = [];

    try {
      await initializeWorkspace(root, "anthropic", "openai");
      const snapshot = await createLocalApplicationDriver({
        providerAuthModeConfiguration: { anthropic: "user-session", openai: "api-key" },
        userSessionRunners: { anthropic: runner },
      }).start({ root, allowProviderData: true }, { write: (line) => output.push(line) });

      expect(snapshot).toMatchObject({
        state: "provider-error",
        lastError: {
          code: "transient",
          step: "author",
          retryable: true,
        },
      });
      expect(snapshot.lastError?.diagnostics).toContainEqual({
        code: "claude_error_subtype_unrecognized",
        path: "subtype",
      });
      expect(snapshot.lastError?.diagnostics).not.toContainEqual(
        expect.objectContaining({
          code: expect.stringMatching(/^local_claude_category_capture_/u),
        }),
      );
      expect(runner).toHaveBeenCalledOnce();
      expect(JSON.stringify({ snapshot, output })).not.toContain(subtype);
      expect(JSON.stringify({ snapshot, output })).not.toContain("future_default_terminal");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not create capture output for Anthropic API-key authentication", async () => {
    const root = await providerWorkspace("draft-loop-app-anthropic-api-key-capture-");
    const captureParent = await mkdtemp(join(tmpdir(), "draft-loop-app-anthropic-api-key-parent-"));
    const output: string[] = [];
    const create = vi.fn(async () => {
      throw new Error("synthetic Anthropic API-key failure");
    });
    const credentials = vi.fn(async () => "synthetic-anthropic-api-key");
    const driver = createLocalApplicationDriver({
      localClaudeCategoryCaptureParent: captureParent,
      providerAuthModeConfiguration: { anthropic: "api-key", openai: "api-key" },
      resolveCredential: credentials,
      providerClientFactories: {
        anthropic: () => ({ messages: { create } }) as unknown as AnthropicClient,
      },
    });

    try {
      await initializeWorkspace(root, "anthropic", "openai");
      const snapshot = await driver.start(
        { root, allowProviderData: true },
        { write: (line) => output.push(line) },
      );

      expect(snapshot).toMatchObject({
        state: "provider-error",
        lastError: { provider: "anthropic", step: "author" },
      });
      expect(credentials).toHaveBeenCalledOnce();
      expect(credentials).toHaveBeenCalledWith("anthropic");
      expect(create).toHaveBeenCalledOnce();
      expect(await readdir(captureParent)).toEqual([]);
      expect(JSON.stringify({ snapshot, output })).not.toContain(captureParent);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(captureParent, { recursive: true, force: true });
    }
  });

  it.each(["user-session", "api-key"] as const)(
    "does not route capture through the OpenAI %s adapter",
    async (authMode) => {
      const root = await providerWorkspace(`draft-loop-app-openai-capture-${authMode}-`);
      const captureParent = await mkdtemp(join(tmpdir(), "draft-loop-app-openai-capture-parent-"));
      const output: string[] = [];
      const driver = createLocalApplicationDriver({
        localClaudeCategoryCaptureParent: captureParent,
        providerAuthModeConfiguration: { anthropic: "api-key", openai: authMode },
        resolveCredential: async () => "synthetic-openai-api-key",
        ...(authMode === "user-session"
          ? {
              userSessionRunners: {
                openai: vi.fn<UserSessionProcessRunner>(async () => ({
                  exitCode: 1,
                  stdout: "synthetic OpenAI user-session failure",
                  stderr: "",
                })),
              },
            }
          : {
              providerClientFactories: {
                openai: () =>
                  ({
                    responses: {
                      create: async () => {
                        throw new Error("synthetic OpenAI API-key failure");
                      },
                    },
                  }) as OpenAIClient,
              },
            }),
      });

      try {
        await initializeWorkspace(root, "openai", "anthropic");
        const snapshot = await driver.start(
          { root, allowProviderData: true },
          {
            write: (line) => output.push(line),
          },
        );

        expect(snapshot).toMatchObject({
          state: "provider-error",
          lastError: { provider: "openai", step: "author" },
        });
        expect(await readdir(captureParent)).toEqual([]);
        expect(JSON.stringify({ snapshot, output })).not.toContain(captureParent);
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(captureParent, { recursive: true, force: true });
      }
    },
  );
});
