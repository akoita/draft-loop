import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type AnthropicClient,
  createLocalModelAdapter,
  type UserSessionProcessRunner,
} from "@draft-loop/providers";
import { openSqliteStorage } from "@draft-loop/storage";
import { describe, expect, it, vi } from "vitest";
import {
  CliUserError,
  createLocalApplicationDriver,
  defaultRequiredSections,
  type ProviderClientFactories,
  resolveProviderAuthModes,
  SourceIngestionUserError,
} from "./local.js";
import { defaultLocalModelEndpoint } from "./local-endpoint.js";

interface JsonRecord {
  readonly [key: string]: unknown;
}

/** Reads the evidence chunk the author must cite out of a serialized request. */
function evidenceChunkId(serialized: string): string {
  const input = JSON.parse(serialized) as {
    readonly retrievedEvidence?: readonly { readonly id?: unknown }[];
  };
  const first = input.retrievedEvidence?.[0];
  if (first === undefined || typeof first.id !== "string" || first.id.trim() === "") {
    throw new Error("The fake local transport received no serialized evidence chunk.");
  }
  return first.id;
}

function authorProposal(chunkId: string): JsonRecord {
  const summary = "TypeScript engineer building local-first tools with deterministic testing.";
  const experience = "Built local-first TypeScript tools with deterministic testing.";
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
        blocks: [{ type: "bullet", text: "Studied software engineering.", claims: [] }],
      },
      {
        title: "Skills",
        kind: "skills",
        blocks: [{ type: "bullet", text: "TypeScript, Node.js, automated testing.", claims: [] }],
      },
    ],
  };
}

/** An OpenAI-compatible chat completion, as a local llama.cpp or Ollama server returns it. */
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

function anthropicCritiqueClient(findings: readonly JsonRecord[]): AnthropicClient {
  return {
    messages: {
      create: () => {
        const response = {
          id: "anthropic-critic-1",
          content: [{ type: "text", text: JSON.stringify({ findings }) }],
          model: "claude-sonnet-4-5",
          stop_reason: "end_turn",
          usage: { input_tokens: 90, output_tokens: 20 },
        };
        return Object.assign(Promise.resolve(response), {
          withResponse: async () => ({ data: response, request_id: "anthropic-critic-1" }),
        }) as ReturnType<AnthropicClient["messages"]["create"]>;
      },
    },
  };
}

function anthropicAuthorClient(): AnthropicClient {
  return {
    messages: {
      create: (input) => {
        const content = (input as { readonly messages?: readonly { readonly content?: unknown }[] })
          .messages?.[0]?.content;
        if (typeof content !== "string") throw new Error("missing Anthropic author input");
        const response = {
          id: "anthropic-author-1",
          content: [
            {
              type: "text",
              text: JSON.stringify(authorProposal(evidenceChunkId(content))),
            },
          ],
          model: "claude-haiku-4-5",
          stop_reason: "end_turn",
          usage: { input_tokens: 90, output_tokens: 20 },
        };
        return Object.assign(Promise.resolve(response), {
          withResponse: async () => ({ data: response, request_id: "anthropic-author-1" }),
        }) as ReturnType<AnthropicClient["messages"]["create"]>;
      },
    },
  };
}

async function providerWorkspace(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(root, "evidence"), { recursive: true });
  await writeFile(
    join(root, "job.md"),
    "Build TypeScript local-first tools with deterministic testing.\n",
    "utf8",
  );
  await writeFile(
    join(root, "evidence", "resume.md"),
    "Built local-first TypeScript tools with deterministic testing.\n",
    "utf8",
  );
  return root;
}

/** Reads the independence a run recorded on its context snapshot. */
async function recordedIndependentReview(
  root: string,
  contextSnapshotId: string,
): Promise<unknown> {
  const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
  try {
    const record = await storage.getContextSnapshot(contextSnapshotId);
    const payload = record?.payload as
      | { readonly modelConfiguration?: { readonly independentReview?: unknown } }
      | undefined;
    return payload?.modelConfiguration?.independentReview;
  } finally {
    await storage.close();
  }
}

async function workspaceConfig(root: string): Promise<JsonRecord> {
  return JSON.parse(
    await readFile(join(root, ".draft-loop", "workspace.json"), "utf8"),
  ) as JsonRecord;
}

/** The author and critic a run wrote into its own context snapshot. */
async function recordedModelConfiguration(
  root: string,
  contextSnapshotId: string,
): Promise<unknown> {
  const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
  try {
    const record = await storage.getContextSnapshot(contextSnapshotId);
    const payload = record?.payload as
      | { readonly modelConfiguration?: Record<string, unknown> }
      | undefined;
    return payload?.modelConfiguration;
  } finally {
    await storage.close();
  }
}

/** A workspace whose author and critic are two distinct local models. */
async function localPairingWorkspace(prefix: string): Promise<string> {
  const root = await providerWorkspace(prefix);
  await createLocalApplicationDriver().initialize(
    {
      root,
      jobDescription: "job.md",
      sources: "evidence",
      authorCompany: "local",
      authorModel: "qwen3-coder-30b",
      criticCompany: "local",
      criticModel: "gpt-oss-20b",
      localEndpoint: "http://127.0.0.1:8080/v1",
    },
    { write: () => undefined },
  );
  return root;
}

describe("local application driver", () => {
  it("resolves explicit per-provider auth overrides over the global mode", () => {
    expect(resolveProviderAuthModes("user-session", "api-key", undefined)).toEqual({
      anthropic: "api-key",
      openai: "user-session",
    });
  });

  it("fails closed before indexing when PDF extraction is unreliable", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-invalid-pdf-"));
    try {
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "TypeScript systems engineer\n", "utf8");
      await writeFile(
        join(root, "evidence", "resume.pdf"),
        "%PDF-1.4\n1 0 obj\n<< /Length 64 >>\nstream\nBT\n(Caf\\303\\251) Tj\nET\nendstream\nendobj\n%%EOF",
        "utf8",
      );
      const driver = createLocalApplicationDriver();
      await driver.initialize(
        { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
        { write: () => undefined },
      );

      const start = driver.start({ root, allowProviderData: false }, { write: () => undefined });
      await expect(start).rejects.toBeInstanceOf(SourceIngestionUserError);
      await expect(start).rejects.toMatchObject({
        name: "SourceIngestionUserError",
        message:
          'The source file "resume.pdf" could not be used. Try another supported text-bearing file or export.',
      });
      await expect(stat(join(root, ".draft-loop", "history.sqlite"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the low-cost cross-provider validation pair for new workspaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-default-models-"));
    try {
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "TypeScript systems engineer\n", "utf8");
      const driver = createLocalApplicationDriver();

      const workspace = await driver.initialize(
        { root, jobDescription: "job.md", sources: "evidence" },
        { write: () => undefined },
      );

      expect(workspace.author).toEqual({ company: "anthropic", model: "claude-sonnet-4-5" });
      expect(workspace.critic).toEqual({ company: "openai", model: "gpt-5.6-luna" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("lets the candidate widen the required sections explicitly", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-required-sections-"));
    try {
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "TypeScript systems engineer\n", "utf8");
      const driver = createLocalApplicationDriver();

      const workspace = await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          requiredSections: ["Summary", "Experience", "Education", "Skills"],
        },
        { write: () => undefined },
      );

      expect(workspace.requiredSections).toEqual(["Summary", "Experience", "Education", "Skills"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the documented default when the candidate does not choose", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-narrow-sections-"));
    try {
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "TypeScript systems engineer\n", "utf8");
      const driver = createLocalApplicationDriver();

      const workspace = await driver.initialize(
        { root, jobDescription: "job.md", sources: "evidence" },
        { write: () => undefined },
      );

      expect(workspace.requiredSections).toEqual([...defaultRequiredSections]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns the newest completed existing export for the requested format", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-latest-export-"));
    const io = { write: () => undefined };
    try {
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "TypeScript systems engineer\n", "utf8");
      await writeFile(join(root, "evidence", "resume.md"), "Candidate evidence\n", "utf8");
      const driver = createLocalApplicationDriver();
      const workspace = await driver.initialize(
        { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
        io,
      );
      const snapshot = await driver.start({ root, allowProviderData: false }, io);
      if (snapshot.artifact === null) throw new Error("The fixture did not produce an artifact.");

      const olderPath = join(root, "exports", "older.md");
      const newestPath = join(root, "exports", "newest.md");
      await mkdir(join(root, "exports"), { recursive: true });
      await writeFile(olderPath, "older export\n", "utf8");
      const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
      try {
        await storage.saveExport({
          id: "export-older",
          workspaceId: workspace.id,
          runId: snapshot.runId,
          artifactId: snapshot.artifact.id,
          format: "markdown",
          status: "completed",
          outputPath: olderPath,
          outputChecksum: "a".repeat(64),
          createdAt: "2026-08-15T10:00:00.000Z",
          payload: { format: "markdown" },
        });
        await storage.saveExport({
          id: "export-newest-missing",
          workspaceId: workspace.id,
          runId: snapshot.runId,
          artifactId: snapshot.artifact.id,
          format: "markdown",
          status: "completed",
          outputPath: newestPath,
          outputChecksum: "b".repeat(64),
          createdAt: "2026-08-15T10:01:00.000Z",
          payload: { format: "markdown" },
        });
      } finally {
        await storage.close();
      }

      await expect(
        driver.latestExportPath({ root, runId: snapshot.runId, format: "markdown" }),
      ).resolves.toBe(olderPath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("drafts through a local model server without resolving any credential", async () => {
    const root = await providerWorkspace("draft-loop-local-provider-");
    const io = { write: () => undefined };
    const credentialCalls: string[] = [];
    const requestedEndpoints: (string | undefined)[] = [];
    const fetchCalls: string[] = [];
    const localFetch = vi.fn(async (url: string, init: RequestInit) => {
      fetchCalls.push(url);
      const body = JSON.parse(String(init.body)) as {
        readonly model: string;
        readonly messages: readonly { readonly content: string }[];
      };
      expect(body.model).toBe("qwen3-coder-30b");
      const serialized = body.messages[1]?.content ?? "";
      return localCompletion(authorProposal(evidenceChunkId(serialized)), "local-1");
    });
    const providerClientFactories: ProviderClientFactories = {
      anthropic: () => anthropicCritiqueClient([]),
      local: (endpoint) => {
        requestedEndpoints.push(endpoint);
        return {
          ...(endpoint === undefined ? {} : { endpoint }),
          fetch: localFetch as unknown as typeof fetch,
        };
      },
    };
    const driver = createLocalApplicationDriver({
      resolveCredential: async (provider) => {
        credentialCalls.push(provider);
        return "fake-anthropic-key";
      },
      providerClientFactories,
    });

    try {
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "local",
          authorModel: "qwen3-coder-30b",
          localEndpoint: "http://127.0.0.1:8080/v1",
          criticCompany: "anthropic",
          criticModel: "claude-sonnet-4-5",
        },
        io,
      );

      const snapshot = await driver.start({ root, allowProviderData: true }, io);

      expect(snapshot.state).toBe("awaiting-approval");
      // The workspace endpoint reached the transport; the Ollama default did not.
      expect(requestedEndpoints).toEqual(["http://127.0.0.1:8080/v1"]);
      expect(fetchCalls).toEqual(["http://127.0.0.1:8080/v1/chat/completions"]);
      // A local server has no account, so the local author asked for no key.
      expect(credentialCalls).toEqual(["anthropic"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records an explicitly selected writing policy and applies it to both model roles", async () => {
    const root = await providerWorkspace("draft-loop-writing-policy-");
    const sourcePath = join(root, "AGENTS.md");
    const policyText = "Use plain ASCII punctuation. Never round candidate metrics upward.";
    await writeFile(sourcePath, policyText, "utf8");
    const authorInputs: string[] = [];
    const criticInputs: string[] = [];
    const localFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        readonly messages: readonly { readonly content: string }[];
      };
      authorInputs.push(body.messages[1]?.content ?? "");
      return localCompletion(
        authorProposal(evidenceChunkId(body.messages[1]?.content ?? "")),
        "local-policy",
      );
    });
    const criticClient: AnthropicClient = {
      messages: {
        create: (input) => {
          const content = (
            input as { readonly messages?: readonly { readonly content?: unknown }[] }
          ).messages?.[0]?.content;
          if (typeof content !== "string") throw new Error("missing critic input");
          criticInputs.push(content);
          const response = {
            id: "anthropic-policy-critic",
            content: [{ type: "text", text: JSON.stringify({ findings: [] }) }],
            model: "claude-sonnet-4-5",
            stop_reason: "end_turn",
            usage: { input_tokens: 90, output_tokens: 20 },
          };
          return Object.assign(Promise.resolve(response), {
            withResponse: async () => ({ data: response, request_id: response.id }),
          }) as ReturnType<AnthropicClient["messages"]["create"]>;
        },
      },
    };
    const driver = createLocalApplicationDriver({
      resolveCredential: async () => "fake-anthropic-key",
      providerClientFactories: {
        local: () => ({ fetch: localFetch as unknown as typeof fetch }),
        anthropic: () => criticClient,
      },
    });

    try {
      await driver.initialize({
        root,
        jobDescription: "job.md",
        sources: "evidence",
        authorCompany: "local",
        authorModel: "qwen-policy",
        criticCompany: "anthropic",
        criticModel: "claude-sonnet-4-5",
      });
      const configured = await driver.configureWritingPolicy({ root, sourcePath });
      expect(configured.writingPolicyPath).toBe(".draft-loop/writing-policy.md");

      const snapshot = await driver.start({ root, allowProviderData: true });
      expect(snapshot.state).toBe("awaiting-approval");
      expect(authorInputs).toHaveLength(1);
      expect(criticInputs).toHaveLength(1);
      for (const serialized of [...authorInputs, ...criticInputs]) {
        expect(JSON.parse(serialized)).toMatchObject({
          context: {
            writingPolicy: {
              content: policyText,
              checksum: expect.stringMatching(/^[a-f0-9]{64}$/u),
              version: expect.stringMatching(/^sha256:[a-f0-9]{12}$/u),
            },
            evidenceManifest: [{ path: join(root, "evidence", "resume.md") }],
          },
        });
      }

      const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
      try {
        const record = await storage.getContextSnapshot(snapshot.contextSnapshotId);
        expect(record?.payload).toMatchObject({
          writingPolicy: {
            content: policyText,
            checksum: expect.any(String),
            version: expect.any(String),
          },
          evidenceManifest: [{ path: join(root, "evidence", "resume.md") }],
        });
      } finally {
        await storage.close();
      }

      const tampered = await workspaceConfig(root);
      await writeFile(
        join(root, ".draft-loop", "workspace.json"),
        `${JSON.stringify({ ...tampered, writingPolicyPath: "../outside-policy.md" })}\n`,
        "utf8",
      );
      await expect(driver.readWorkspace(root)).rejects.toThrow(/managed policy file/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("leaves the endpoint to the adapter when the workspace configures none", async () => {
    const root = await providerWorkspace("draft-loop-local-default-endpoint-");
    const io = { write: () => undefined };
    const requestedEndpoints: (string | undefined)[] = [];
    const driver = createLocalApplicationDriver({
      resolveCredential: async () => "fake-anthropic-key",
      providerClientFactories: {
        anthropic: () => anthropicCritiqueClient([]),
        local: (endpoint) => {
          requestedEndpoints.push(endpoint);
          return { fetch: (async () => localCompletion({}, "local-1")) as unknown as typeof fetch };
        },
      },
    });

    try {
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "local",
          authorModel: "qwen3-coder-30b",
          criticCompany: "anthropic",
          criticModel: "claude-sonnet-4-5",
        },
        io,
      );
      await driver.start({ root, allowProviderData: true }, io);

      expect(requestedEndpoints).toEqual([undefined]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the advertised default endpoint identical to the adapter's own", async () => {
    // The desktop preflight names this address before a request is made, so a
    // change to the adapter default must not leave that promise stale.
    const calls: string[] = [];
    const adapter = createLocalModelAdapter(
      {
        fetch: (async (url: string) => {
          calls.push(url);
          return localCompletion({ findings: [] }, "local-default");
        }) as unknown as typeof fetch,
      },
      {
        configuredModel: {
          company: "local",
          modelId: "qwen3-coder-30b",
          role: "critic",
          promptTemplateVersion: "cli-critic-v1",
        },
      },
    );

    await adapter.execute({
      contextSnapshotId: "context-1",
      model: {
        company: "local",
        modelId: "qwen3-coder-30b",
        role: "critic",
        promptTemplateVersion: "cli-critic-v1",
      },
      systemPrompt: "",
      input: {},
      outputSchema: {},
      outputName: "critique",
      dataPolicy: {
        allowTransmission: true,
        allowedCompanies: ["local"],
        sensitiveData: false,
        sensitiveDataAcknowledged: false,
      },
    });

    expect(calls).toEqual([`${defaultLocalModelEndpoint}/chat/completions`]);
  });

  it("routes both hosted providers through user sessions without resolving API keys", async () => {
    const root = await providerWorkspace("draft-loop-user-session-");
    const io = { write: () => undefined };
    const resolveCredential = vi.fn(async () => {
      throw new Error("API-key resolution must not run in user-session mode.");
    });
    const anthropicRunner = vi.fn<UserSessionProcessRunner>(async (_command, _args, options) => {
      const input = JSON.parse(options.stdin) as {
        readonly retrievedEvidence?: readonly { readonly id?: string }[];
      };
      const chunkId = input.retrievedEvidence?.[0]?.id;
      if (chunkId === undefined) throw new Error("missing evidence chunk");
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          session_id: "claude-session",
          structured_output: authorProposal(chunkId),
          usage: { input_tokens: 90, output_tokens: 20 },
          permission_denials: [],
        }),
        stderr: "",
      };
    });
    const openaiRunner = vi.fn<UserSessionProcessRunner>(async (_command, args, options) => {
      expect(options.stdin).toContain("Do not repeat deterministicFindings");
      expect(options.stdin).toContain("Return no more than 16 findings");
      expect(options.stdin).toContain("keep each message to 400 characters or fewer");
      const outputIndex = args.indexOf("--output-last-message");
      const outputPath = args[outputIndex + 1];
      if (outputPath === undefined) throw new Error("missing output path");
      await writeFile(outputPath, JSON.stringify({ findings: [] }), { mode: 0o600 });
      return {
        exitCode: 0,
        stdout: [
          JSON.stringify({ type: "thread.started", thread_id: "codex-session" }),
          JSON.stringify({
            type: "turn.completed",
            usage: { input_tokens: 80, output_tokens: 10 },
          }),
        ].join("\n"),
        stderr: "",
      };
    });
    const driver = createLocalApplicationDriver({
      providerAuthMode: "user-session",
      resolveCredential,
      providerClientFactories: {
        anthropic: () => {
          throw new Error("Anthropic SDK factory must not run in user-session mode.");
        },
        openai: () => {
          throw new Error("OpenAI SDK factory must not run in user-session mode.");
        },
      },
      userSessionRunners: { anthropic: anthropicRunner, openai: openaiRunner },
    });

    try {
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "anthropic",
          authorModel: "claude-sonnet-4-5",
          criticCompany: "openai",
          criticModel: "gpt-5.6-luna",
        },
        io,
      );
      const snapshot = await driver.start({ root, allowProviderData: true }, io);

      expect(snapshot.state).toBe("awaiting-approval");
      expect(resolveCredential).not.toHaveBeenCalled();
      expect(anthropicRunner).toHaveBeenCalledOnce();
      expect(openaiRunner).toHaveBeenCalledOnce();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an oversized user-session critique as a retryable provider response", async () => {
    const root = await providerWorkspace("draft-loop-bounded-user-session-critique-");
    const openaiRunner = vi.fn<UserSessionProcessRunner>(async (_command, args) => {
      const outputPath = args[args.indexOf("--output-last-message") + 1];
      if (outputPath === undefined) throw new Error("missing output path");
      const findings = Array.from({ length: 17 }, (_, index) => ({
        id: `finding-${index + 1}`,
        code: "quality",
        category: "quality",
        severity: "warning",
        message: "Keep the finding concise.",
      }));
      await writeFile(outputPath, JSON.stringify({ findings }), { mode: 0o600 });
      return {
        exitCode: 0,
        stdout: [
          JSON.stringify({ type: "thread.started", thread_id: "codex-session" }),
          JSON.stringify({
            type: "turn.completed",
            usage: { input_tokens: 80, output_tokens: 100 },
          }),
        ].join("\n"),
        stderr: "",
      };
    });
    const driver = createLocalApplicationDriver({
      providerAuthModeConfiguration: { anthropic: "api-key", openai: "user-session" },
      resolveCredential: async () => "fake-anthropic-key",
      providerClientFactories: { anthropic: () => anthropicAuthorClient() },
      userSessionRunners: { openai: openaiRunner },
    });

    try {
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "anthropic",
          authorModel: "claude-haiku-4-5",
          criticCompany: "openai",
          criticModel: "gpt-5.6-luna",
        },
        { write: () => undefined },
      );

      const snapshot = await driver.start(
        { root, allowProviderData: true },
        { write: () => undefined },
      );

      expect(snapshot).toMatchObject({
        state: "provider-error",
        lastError: { code: "invalid-response", step: "critic", retryable: true },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("routes Anthropic through its API key and OpenAI through its user session", async () => {
    const root = await providerWorkspace("draft-loop-mixed-provider-auth-");
    const io = { write: () => undefined };
    const resolveCredential = vi.fn(async (provider: "anthropic" | "openai") => {
      if (provider === "openai") throw new Error("OpenAI API key must not be resolved.");
      return "fake-anthropic-key";
    });
    const openaiRunner = vi.fn<UserSessionProcessRunner>(async (_command, args) => {
      const outputPath = args[args.indexOf("--output-last-message") + 1];
      if (outputPath === undefined) throw new Error("missing output path");
      await writeFile(outputPath, JSON.stringify({ findings: [] }), { mode: 0o600 });
      return {
        exitCode: 0,
        stdout: [
          JSON.stringify({ type: "thread.started", thread_id: "codex-session" }),
          JSON.stringify({
            type: "turn.completed",
            usage: { input_tokens: 80, output_tokens: 10 },
          }),
        ].join("\n"),
        stderr: "",
      };
    });
    const driver = createLocalApplicationDriver({
      providerAuthModeConfiguration: { anthropic: "api-key", openai: "user-session" },
      resolveCredential,
      providerClientFactories: {
        anthropic: () => anthropicAuthorClient(),
        openai: () => {
          throw new Error("OpenAI SDK factory must not run in user-session mode.");
        },
      },
      userSessionRunners: { openai: openaiRunner },
    });

    try {
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "anthropic",
          authorModel: "claude-haiku-4-5",
          criticCompany: "openai",
          criticModel: "gpt-5.6-luna",
        },
        io,
      );
      const snapshot = await driver.start({ root, allowProviderData: true }, io);

      expect(snapshot.state).toBe("awaiting-approval");
      expect(resolveCredential).toHaveBeenCalledOnce();
      expect(resolveCredential).toHaveBeenCalledWith("anthropic");
      expect(openaiRunner).toHaveBeenCalledOnce();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a local endpoint that would send candidate material off this machine", async () => {
    const root = await providerWorkspace("draft-loop-local-remote-endpoint-");
    const driver = createLocalApplicationDriver();

    try {
      const initialize = driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "local",
          authorModel: "qwen3-coder-30b",
          localEndpoint: "https://models.evil.test/v1",
          criticCompany: "anthropic",
          criticModel: "claude-sonnet-4-5",
        },
        { write: () => undefined },
      );

      await expect(initialize).rejects.toBeInstanceOf(CliUserError);
      await expect(initialize).rejects.toThrow(/localhost, ::1, or 127\.0\.0\.0\/8/u);
      // The rejected value is attacker-chosen text, so it is not echoed back.
      await expect(initialize).rejects.not.toThrow(/evil\.test/u);
      await expect(stat(join(root, ".draft-loop", "workspace.json"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a stored local endpoint that is no longer loopback", async () => {
    const root = await providerWorkspace("draft-loop-local-tampered-endpoint-");
    const driver = createLocalApplicationDriver();

    try {
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "local",
          authorModel: "qwen3-coder-30b",
          localEndpoint: "http://127.0.0.1:8080/v1",
          criticCompany: "anthropic",
          criticModel: "claude-sonnet-4-5",
        },
        { write: () => undefined },
      );
      const configPath = join(root, ".draft-loop", "workspace.json");
      const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
      await writeFile(
        configPath,
        JSON.stringify({ ...config, localEndpoint: "http://127.0.0.1@evil.test/v1" }, null, 2),
        "utf8",
      );

      await expect(driver.readWorkspace(root)).rejects.toBeInstanceOf(CliUserError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs two different local models as author and critic", async () => {
    // The concrete outcome of moving independence onto lineage: a workspace
    // with no hosted provider credit can still get an independent critique.
    const root = await providerWorkspace("draft-loop-local-pairing-");
    const io = { write: () => undefined };
    const credentialCalls: string[] = [];
    const localFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        readonly model: string;
        readonly messages: readonly { readonly content: string }[];
      };
      const serialized = body.messages[1]?.content ?? "";
      return body.model === "qwen3-coder-30b"
        ? localCompletion(authorProposal(evidenceChunkId(serialized)), "local-author-1")
        : localCompletion({ findings: [] }, "local-critic-1");
    });
    const driver = createLocalApplicationDriver({
      resolveCredential: async (provider) => {
        credentialCalls.push(provider);
        return "unused";
      },
      providerClientFactories: {
        local: (endpoint) => ({
          ...(endpoint === undefined ? {} : { endpoint }),
          fetch: localFetch as unknown as typeof fetch,
        }),
      },
    });

    try {
      const workspace = await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "local",
          authorModel: "qwen3-coder-30b",
          criticCompany: "local",
          criticModel: "gpt-oss-20b",
          localEndpoint: "http://127.0.0.1:8080/v1",
        },
        io,
      );

      expect(workspace.author).toEqual({ company: "local", model: "qwen3-coder-30b" });
      expect(workspace.critic).toEqual({ company: "local", model: "gpt-oss-20b" });

      const snapshot = await driver.start({ root, allowProviderData: true }, io);

      expect(snapshot.state).toBe("awaiting-approval");
      expect(credentialCalls).toEqual([]);
      expect(await recordedIndependentReview(root, snapshot.contextSnapshotId)).toEqual({
        authorLineage: "local:qwen3-coder-30b",
        criticLineage: "local:gpt-oss-20b",
        lineagesDistinct: true,
        required: true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports no recorded independence rather than failing when there is no run", async () => {
    // An approval surface asks this question before a run exists and after a
    // run id it cannot resolve. Both are honest "nothing recorded" answers,
    // not errors: failing here would take the whole review view down with it.
    const root = await providerWorkspace("draft-loop-independence-missing-");
    const driver = createLocalApplicationDriver();

    try {
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "local",
          authorModel: "qwen3-coder-30b",
          criticCompany: "local",
          criticModel: "gpt-oss-20b",
          localEndpoint: "http://127.0.0.1:8080/v1",
        },
        { write: () => undefined },
      );

      expect(await driver.readIndependentReview({ root })).toBeUndefined();
      expect(
        await driver.readIndependentReview({ root, runId: "run-does-not-exist" }),
      ).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses one local model reviewing itself", async () => {
    const root = await providerWorkspace("draft-loop-shared-lineage-");
    const driver = createLocalApplicationDriver({
      providerClientFactories: {
        local: () => ({ fetch: (async () => localCompletion({}, "x")) as unknown as typeof fetch }),
      },
    });

    try {
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "local",
          authorModel: "qwen3-coder-30b",
          criticCompany: "local",
          criticModel: "qwen3-coder-30b",
          localEndpoint: "http://127.0.0.1:8080/v1",
        },
        { write: () => undefined },
      );

      await expect(
        driver.start({ root, allowProviderData: true }, { write: () => undefined }),
      ).rejects.toThrow(/different model lineages/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses two vendors the candidate declared as one lineage", async () => {
    const root = await providerWorkspace("draft-loop-declared-lineage-");
    const driver = createLocalApplicationDriver({
      resolveCredential: async () => "fake-key",
      providerClientFactories: { anthropic: () => anthropicCritiqueClient([]) },
    });

    try {
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "anthropic",
          authorModel: "claude-sonnet-4-5",
          authorLineage: "gpt-oss-20b",
          criticCompany: "openai",
          criticModel: "gpt-5.6-luna",
          criticLineage: "GPT-OSS-20B",
        },
        { write: () => undefined },
      );

      await expect(
        driver.start({ root, allowProviderData: true }, { write: () => undefined }),
      ).rejects.toThrow(/different model lineages/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records the rationale that let one lineage review itself, and never sends it", async () => {
    const root = await providerWorkspace("draft-loop-override-rationale-");
    const io = { write: () => undefined };
    const rationale = "One model, two prompt templates: a deliberate self-review experiment.";
    const sentBodies: string[] = [];
    const localFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = String(init.body);
      sentBodies.push(body);
      const parsed = JSON.parse(body) as {
        readonly messages: readonly { readonly content: string }[];
      };
      const serialized = parsed.messages[1]?.content ?? "";
      return sentBodies.length === 1
        ? localCompletion(authorProposal(evidenceChunkId(serialized)), "local-author-1")
        : localCompletion({ findings: [] }, "local-critic-1");
    });
    const driver = createLocalApplicationDriver({
      providerClientFactories: {
        local: (endpoint) => ({
          ...(endpoint === undefined ? {} : { endpoint }),
          fetch: localFetch as unknown as typeof fetch,
        }),
      },
    });

    try {
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "local",
          authorModel: "qwen3-coder-30b",
          criticCompany: "local",
          criticModel: "qwen3-coder-30b",
          localEndpoint: "http://127.0.0.1:8080/v1",
          independenceOverrideRationale: rationale,
        },
        io,
      );

      const config = JSON.parse(
        await readFile(join(root, ".draft-loop", "workspace.json"), "utf8"),
      ) as JsonRecord;
      expect(config.independenceOverrideRationale).toBe(rationale);

      const snapshot = await driver.start({ root, allowProviderData: true }, io);

      expect(snapshot.state).toBe("awaiting-approval");
      expect(await recordedIndependentReview(root, snapshot.contextSnapshotId)).toEqual({
        authorLineage: "local:qwen3-coder-30b",
        criticLineage: "local:qwen3-coder-30b",
        lineagesDistinct: false,
        required: true,
        overrideRationale: rationale,
      });
      // The same record, through the boundary an approval surface reads it by.
      expect(await driver.readIndependentReview({ root })).toEqual({
        authorLineage: "local:qwen3-coder-30b",
        criticLineage: "local:qwen3-coder-30b",
        lineagesDistinct: false,
        required: true,
        overrideRationale: rationale,
      });
      expect(await driver.readIndependentReview({ root, runId: snapshot.runId })).toEqual(
        await driver.readIndependentReview({ root }),
      );
      // Operator prose about model choice is an auditor's field, not model input.
      expect(sentBodies.length).toBeGreaterThan(0);
      for (const body of sentBodies) {
        expect(body).not.toContain("independentReview");
        expect(body).not.toContain("self-review experiment");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses an unusable override rationale without echoing it", async () => {
    const root = await providerWorkspace("draft-loop-bad-rationale-");
    const driver = createLocalApplicationDriver();

    try {
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "local",
          authorModel: "qwen3-coder-30b",
          criticCompany: "local",
          criticModel: "qwen3-coder-30b",
          localEndpoint: "http://127.0.0.1:8080/v1",
        },
        { write: () => undefined },
      );
      const configPath = join(root, ".draft-loop", "workspace.json");
      const config = JSON.parse(await readFile(configPath, "utf8")) as JsonRecord;
      const secret = "s".repeat(501);
      await writeFile(
        configPath,
        JSON.stringify({ ...config, independenceOverrideRationale: secret }, null, 2),
        "utf8",
      );

      const failure = driver.readWorkspace(root);
      await expect(failure).rejects.toBeInstanceOf(CliUserError);
      await expect(failure).rejects.toThrow(/independenceOverrideRationale/u);
      await expect(failure).rejects.not.toThrow(new RegExp(secret, "u"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("workspace model reconfiguration", () => {
  const silent = { write: () => undefined };

  it("replaces every part of the pairing an existing workspace uses next", async () => {
    const root = await providerWorkspace("draft-loop-reconfigure-fields-");
    const driver = createLocalApplicationDriver();

    try {
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "anthropic",
          authorModel: "claude-sonnet-4-5",
          criticCompany: "openai",
          criticModel: "gpt-5.6-luna",
        },
        silent,
      );

      const descriptor = await driver.reconfigureModels(
        {
          root,
          authorCompany: "local",
          authorModel: "qwen3-coder-30b",
          criticCompany: "anthropic",
          criticModel: "claude-opus-4-1",
          authorLineage: "qwen:qwen3-coder",
          criticLineage: "anthropic:claude-opus",
          localEndpoint: "http://127.0.0.1:8080/v1",
        },
        silent,
      );

      expect(descriptor.author).toEqual({ company: "local", model: "qwen3-coder-30b" });
      expect(descriptor.critic).toEqual({ company: "anthropic", model: "claude-opus-4-1" });
      expect(descriptor.localEndpoint).toBe("http://127.0.0.1:8080/v1");
      expect(await workspaceConfig(root)).toMatchObject({
        authorCompany: "local",
        authorModel: "qwen3-coder-30b",
        criticCompany: "anthropic",
        criticModel: "claude-opus-4-1",
        authorLineage: "qwen:qwen3-coder",
        criticLineage: "anthropic:claude-opus",
        localEndpoint: "http://127.0.0.1:8080/v1",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a company no adapter exists for, without echoing it", async () => {
    const root = await localPairingWorkspace("draft-loop-reconfigure-company-");
    const driver = createLocalApplicationDriver();

    try {
      const failure = driver.reconfigureModels(
        {
          root,
          authorCompany: "bedrock",
          authorModel: "claude-sonnet-4-5",
          criticCompany: "openai",
          criticModel: "gpt-5.6-luna",
        },
        silent,
      );
      await expect(failure).rejects.toBeInstanceOf(CliUserError);
      await expect(failure).rejects.toThrow(/authorCompany/u);
      await expect(failure).rejects.not.toThrow(/bedrock/u);
      // The refusal left the configuration it already had in place.
      expect(await workspaceConfig(root)).toMatchObject({
        authorCompany: "local",
        authorModel: "qwen3-coder-30b",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses an endpoint that would send candidate material off this machine", async () => {
    const root = await localPairingWorkspace("draft-loop-reconfigure-endpoint-");
    const driver = createLocalApplicationDriver();

    try {
      const failure = driver.reconfigureModels(
        {
          root,
          authorCompany: "local",
          authorModel: "qwen3-coder-30b",
          criticCompany: "local",
          criticModel: "gpt-oss-20b",
          localEndpoint: "http://10.0.0.4:11434/v1",
        },
        silent,
      );
      await expect(failure).rejects.toBeInstanceOf(CliUserError);
      await expect(failure).rejects.toThrow(/localEndpoint/u);
      await expect(failure).rejects.not.toThrow(/10\.0\.0\.4/u);
      expect(await workspaceConfig(root)).toMatchObject({
        localEndpoint: "http://127.0.0.1:8080/v1",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a lineage longer than the domain keeps, without echoing it", async () => {
    const root = await localPairingWorkspace("draft-loop-reconfigure-lineage-");
    const driver = createLocalApplicationDriver();
    const overlong = "l".repeat(201);

    try {
      const failure = driver.reconfigureModels(
        {
          root,
          authorCompany: "local",
          authorModel: "qwen3-coder-30b",
          criticCompany: "local",
          criticModel: "gpt-oss-20b",
          authorLineage: overlong,
        },
        silent,
      );
      await expect(failure).rejects.toBeInstanceOf(CliUserError);
      await expect(failure).rejects.toThrow(/authorLineage/u);
      await expect(failure).rejects.not.toThrow(new RegExp(overlong, "u"));
      expect(await workspaceConfig(root)).not.toHaveProperty("authorLineage");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses an empty override rationale rather than recording a blank claim", async () => {
    const root = await localPairingWorkspace("draft-loop-reconfigure-blank-rationale-");
    const driver = createLocalApplicationDriver();

    try {
      const failure = driver.reconfigureModels(
        {
          root,
          authorCompany: "local",
          authorModel: "qwen3-coder-30b",
          criticCompany: "local",
          criticModel: "qwen3-coder-30b",
          independenceOverrideRationale: "   ",
        },
        silent,
      );
      await expect(failure).rejects.toBeInstanceOf(CliUserError);
      await expect(failure).rejects.toThrow(/independenceOverrideRationale/u);
      expect(await workspaceConfig(root)).toMatchObject({ criticModel: "gpt-oss-20b" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses one lineage on both sides unless a rationale is supplied with it", async () => {
    const root = await localPairingWorkspace("draft-loop-reconfigure-independence-");
    const driver = createLocalApplicationDriver();
    const rationale = "Offline machine with one usable model; the critic prompt differs.";

    try {
      const refused = driver.reconfigureModels(
        {
          root,
          authorCompany: "local",
          authorModel: "qwen3-coder-30b",
          criticCompany: "local",
          criticModel: "qwen3-coder-30b",
        },
        silent,
      );
      await expect(refused).rejects.toBeInstanceOf(CliUserError);
      await expect(refused).rejects.toThrow(/lineage/u);
      expect(await workspaceConfig(root)).toMatchObject({ criticModel: "gpt-oss-20b" });

      await driver.reconfigureModels(
        {
          root,
          authorCompany: "local",
          authorModel: "qwen3-coder-30b",
          criticCompany: "local",
          criticModel: "qwen3-coder-30b",
          independenceOverrideRationale: rationale,
        },
        silent,
      );

      expect(await workspaceConfig(root)).toMatchObject({
        criticModel: "qwen3-coder-30b",
        independenceOverrideRationale: rationale,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not let a rationale written for one pairing survive into another", async () => {
    // The rationale justifies one specific pairing. Carrying it forward would
    // record a justification nobody gave for the pair actually configured.
    const root = await localPairingWorkspace("draft-loop-reconfigure-stale-rationale-");
    const driver = createLocalApplicationDriver();

    try {
      await driver.reconfigureModels(
        {
          root,
          authorCompany: "local",
          authorModel: "qwen3-coder-30b",
          criticCompany: "local",
          criticModel: "qwen3-coder-30b",
          independenceOverrideRationale: "One model on an offline machine.",
        },
        silent,
      );
      expect(await workspaceConfig(root)).toHaveProperty("independenceOverrideRationale");

      await driver.reconfigureModels(
        {
          root,
          authorCompany: "local",
          authorModel: "qwen3-coder-30b",
          criticCompany: "anthropic",
          criticModel: "claude-sonnet-4-5",
        },
        silent,
      );

      const config = await workspaceConfig(root);
      expect(config).not.toHaveProperty("independenceOverrideRationale");
      // The rest of the replaced configuration goes with it.
      expect(config).not.toHaveProperty("localEndpoint");
      expect(config).toMatchObject({ criticCompany: "anthropic" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to change the models under a run that is executing", async () => {
    const root = await providerWorkspace("draft-loop-reconfigure-in-flight-");
    let releaseAuthor: () => void = () => undefined;
    const authorReached = Promise.withResolvers<void>();
    const authorReleased = new Promise<void>((resolve) => {
      releaseAuthor = resolve;
    });
    const localFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        readonly model: string;
        readonly messages: readonly { readonly content: string }[];
      };
      const serialized = body.messages[1]?.content ?? "";
      if (body.model === "qwen3-coder-30b") {
        authorReached.resolve();
        await authorReleased;
        return localCompletion(authorProposal(evidenceChunkId(serialized)), "local-author-1");
      }
      return localCompletion({ findings: [] }, "local-critic-1");
    });
    const driver = createLocalApplicationDriver({
      providerClientFactories: {
        local: (endpoint) => ({
          ...(endpoint === undefined ? {} : { endpoint }),
          fetch: localFetch as unknown as typeof fetch,
        }),
      },
    });

    try {
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "local",
          authorModel: "qwen3-coder-30b",
          criticCompany: "local",
          criticModel: "gpt-oss-20b",
          localEndpoint: "http://127.0.0.1:8080/v1",
        },
        silent,
      );
      const running = driver.start({ root, allowProviderData: true }, silent);
      await authorReached.promise;

      const refused = driver.reconfigureModels(
        {
          root,
          authorCompany: "anthropic",
          authorModel: "claude-sonnet-4-5",
          criticCompany: "openai",
          criticModel: "gpt-5.6-luna",
        },
        silent,
      );
      await expect(refused).rejects.toBeInstanceOf(CliUserError);
      await expect(refused).rejects.toThrow(/executing/u);

      releaseAuthor();
      const snapshot = await running;
      expect(snapshot.state).toBe("awaiting-approval");
      expect(await workspaceConfig(root)).toMatchObject({ authorCompany: "local" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("leaves an existing run recording the pair it actually used", async () => {
    // The run that stopped because a critic's credit ran out must keep naming
    // that critic; only the next run reads the workspace configuration.
    const root = await providerWorkspace("draft-loop-reconfigure-run-history-");
    const localFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        readonly model: string;
        readonly messages: readonly { readonly content: string }[];
      };
      const serialized = body.messages[1]?.content ?? "";
      return body.model === "qwen3-coder-30b"
        ? localCompletion(authorProposal(evidenceChunkId(serialized)), "local-author-1")
        : localCompletion({ findings: [] }, "local-critic-1");
    });
    const driver = createLocalApplicationDriver({
      providerClientFactories: {
        local: (endpoint) => ({
          ...(endpoint === undefined ? {} : { endpoint }),
          fetch: localFetch as unknown as typeof fetch,
        }),
      },
    });

    try {
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "local",
          authorModel: "qwen3-coder-30b",
          criticCompany: "local",
          criticModel: "gpt-oss-20b",
          localEndpoint: "http://127.0.0.1:8080/v1",
        },
        silent,
      );
      const first = await driver.start({ root, allowProviderData: true }, silent);
      const beforeConfiguration = await recordedModelConfiguration(root, first.contextSnapshotId);
      const beforeIndependence = await driver.readIndependentReview({ root, runId: first.runId });

      const descriptor = await driver.reconfigureModels(
        {
          root,
          authorCompany: "local",
          authorModel: "gpt-oss-20b",
          criticCompany: "local",
          criticModel: "qwen3-coder-30b",
          localEndpoint: "http://127.0.0.1:8080/v1",
        },
        silent,
      );

      expect(descriptor.author).toEqual({ company: "local", model: "gpt-oss-20b" });
      // The run that already happened is untouched, byte for byte.
      expect(await recordedModelConfiguration(root, first.contextSnapshotId)).toEqual(
        beforeConfiguration,
      );
      expect(await driver.readIndependentReview({ root, runId: first.runId })).toEqual(
        beforeIndependence,
      );
      // It still names the pair that ran it, not the pair configured since.
      expect(beforeConfiguration).toMatchObject({
        author: { company: "local", modelId: "qwen3-coder-30b" },
        critic: { company: "local", modelId: "gpt-oss-20b" },
      });
      expect(first.state).toBe("awaiting-approval");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("builds the next run's context from the models configured by then", async () => {
    // Run creation reads the workspace afresh, so the pairing a run records is
    // whatever was configured at the moment it was created -- which is what
    // makes retrying with a different critic possible at all.
    const root = await providerWorkspace("draft-loop-reconfigure-next-run-");
    const localFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        readonly model: string;
        readonly messages: readonly { readonly content: string }[];
      };
      const serialized = body.messages[1]?.content ?? "";
      return body.model === "gpt-oss-20b"
        ? localCompletion(authorProposal(evidenceChunkId(serialized)), "local-author-1")
        : localCompletion({ findings: [] }, "local-critic-1");
    });
    const driver = createLocalApplicationDriver({
      providerClientFactories: {
        local: (endpoint) => ({
          ...(endpoint === undefined ? {} : { endpoint }),
          fetch: localFetch as unknown as typeof fetch,
        }),
      },
    });

    try {
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "local",
          authorModel: "qwen3-coder-30b",
          criticCompany: "local",
          criticModel: "gpt-oss-20b",
          localEndpoint: "http://127.0.0.1:8080/v1",
        },
        silent,
      );
      await driver.reconfigureModels(
        {
          root,
          authorCompany: "local",
          authorModel: "gpt-oss-20b",
          criticCompany: "local",
          criticModel: "qwen3-coder-30b",
          localEndpoint: "http://127.0.0.1:8080/v1",
        },
        silent,
      );

      const snapshot = await driver.start({ root, allowProviderData: true }, silent);

      expect(snapshot.state).toBe("awaiting-approval");
      expect(await recordedModelConfiguration(root, snapshot.contextSnapshotId)).toMatchObject({
        author: { company: "local", modelId: "gpt-oss-20b", role: "author" },
        critic: { company: "local", modelId: "qwen3-coder-30b", role: "critic" },
      });
      expect(await driver.readIndependentReview({ root })).toEqual({
        authorLineage: "local:gpt-oss-20b",
        criticLineage: "local:qwen3-coder-30b",
        lineagesDistinct: true,
        required: true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
