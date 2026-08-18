import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type AnthropicClient, createLocalModelAdapter } from "@draft-loop/providers";
import { openSqliteStorage } from "@draft-loop/storage";
import { describe, expect, it, vi } from "vitest";
import {
  CliUserError,
  createLocalApplicationDriver,
  defaultRequiredSections,
  type ProviderClientFactories,
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

describe("local application driver", () => {
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
