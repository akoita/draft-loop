import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CliUserError,
  initWorkspace,
  readWorkspace,
  reconfigureWorkspaceModels,
  type WorkspaceConfig,
} from "./local.js";
import {
  assertModelCompaniesMatch,
  assertWorkspaceModelPairing,
  modelCompanyMismatch,
} from "./workspace-model-pairing.js";

const directories: string[] = [];
const silent = { write: () => undefined };

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "draft-loop-model-pairing-"));
  directories.push(root);
  await mkdir(join(root, "evidence"));
  await writeFile(join(root, "job.md"), "TypeScript systems engineer\n", "utf8");
  await writeFile(join(root, "evidence", "resume.md"), "Synthetic candidate evidence.", "utf8");
  return root;
}

function pairing(
  authorCompany: string,
  authorModel: string,
  criticCompany: string,
  criticModel: string,
): WorkspaceConfig {
  return { authorCompany, authorModel, criticCompany, criticModel } as WorkspaceConfig;
}

describe("modelCompanyMismatch", () => {
  it.each([
    ["openai", "claude-sonnet-5", "Anthropic"],
    ["anthropic", "gpt-6-sol", "OpenAI"],
    ["anthropic", "o3-mini", "OpenAI"],
    ["anthropic", "o1-preview", "OpenAI"],
    ["anthropic", "o4-mini", "OpenAI"],
    ["anthropic", "codex-mini", "OpenAI"],
    [" OpenAI ", " Claude-Opus-5 ", "Anthropic"],
  ])("names the other company for %s with %s", (company, modelId, other) => {
    expect(modelCompanyMismatch(company, modelId)).toBe(other);
  });

  it.each([
    ["anthropic", "claude-sonnet-5"],
    ["openai", "gpt-6-sol"],
    ["openai", "o3-mini"],
    ["anthropic", "sonnet-next"],
    ["openai", "mystery-model"],
    ["local", "claude-sonnet-5"],
    ["local", "gpt-6-sol"],
  ])("accepts %s with %s", (company, modelId) => {
    expect(modelCompanyMismatch(company, modelId)).toBeNull();
  });
});

describe("assertModelCompaniesMatch", () => {
  it("refuses a critic model from the other company with an exact message", () => {
    const config = pairing("anthropic", "claude-sonnet-5", "openai", "claude-sonnet-5");
    expect(() => assertModelCompaniesMatch(config)).toThrow(CliUserError);
    expect(() => assertModelCompaniesMatch(config)).toThrow(
      "`claude-sonnet-5` looks like an Anthropic model, but the critic company is OpenAI. Choose a matching model ID.",
    );
  });

  it("refuses an author model from the other company with an exact message", () => {
    const config = pairing("anthropic", "gpt-6-sol", "openai", "gpt-6-sol");
    expect(() => assertModelCompaniesMatch(config)).toThrow(
      "`gpt-6-sol` looks like an OpenAI model, but the author company is Anthropic. Choose a matching model ID.",
    );
  });

  it("returns a matching pairing unchanged", () => {
    const config = pairing("anthropic", "claude-sonnet-5", "openai", "gpt-6-sol");
    expect(assertModelCompaniesMatch(config)).toBe(config);
    expect(assertWorkspaceModelPairing(config)).toBe(config);
  });
});

describe("workspace model pairing at the application boundary", () => {
  it("refuses to initialize a workspace whose critic model belongs to another company", async () => {
    const root = await fixtureRoot();
    await expect(
      initWorkspace(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          criticCompany: "openai",
          criticModel: "claude-sonnet-5",
          fixtureMode: true,
        },
        silent,
      ),
    ).rejects.toThrow(
      "`claude-sonnet-5` looks like an Anthropic model, but the critic company is OpenAI. Choose a matching model ID.",
    );
    await expect(access(join(root, ".draft-loop"))).rejects.toThrow();
  });

  it("refuses to reconfigure a workspace to a mismatched author model", async () => {
    const root = await fixtureRoot();
    const created = await initWorkspace(
      { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
      silent,
    );
    await expect(
      reconfigureWorkspaceModels(
        root,
        {
          authorCompany: "anthropic",
          authorModel: "gpt-6-sol",
          criticCompany: "openai",
          criticModel: "gpt-6-sol",
        },
        silent,
      ),
    ).rejects.toThrow(CliUserError);
    expect(await readWorkspace(root)).toEqual(created);
  });
});
