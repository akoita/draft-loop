import type { ApplicationService } from "@draft-loop/application";
import {
  listModelProfileCatalog,
  listModelProfilePresets,
} from "@draft-loop/application/model-profile-catalog";
import { describe, expect, it, vi } from "vitest";

import { createCli } from "./index.js";
import type { ApplicationIo } from "./workflow.js";

function createHarness() {
  const lines: string[] = [];
  const io: ApplicationIo = { write: (line) => lines.push(line) };
  const startCommands: Parameters<ApplicationService["start"]>[0][] = [];
  const start = vi.fn(async (command: Parameters<ApplicationService["start"]>[0]) => {
    startCommands.push(command);
    return {} as Awaited<ReturnType<ApplicationService["start"]>>;
  });
  const resume = vi.fn(async () => ({}) as Awaited<ReturnType<ApplicationService["resume"]>>);
  const service = { start, resume } as unknown as ApplicationService;
  const create = () => createCli({ service, io });
  const invoke = async (...arguments_: readonly string[]) =>
    create().parseAsync(["node", "draft-loop", ...arguments_]);

  return { create, invoke, lines, resume, service, start, startCommands };
}

describe("model profile CLI commands", () => {
  it("prints the profile catalog and presets as content-free JSON without calling the service", async () => {
    const harness = createHarness();

    await harness.invoke("model-profiles");

    expect(harness.lines).toHaveLength(1);
    expect(JSON.parse(harness.lines[0] ?? "null")).toEqual({
      profiles: listModelProfileCatalog(),
      presets: listModelProfilePresets(),
    });
    expect(harness.start).not.toHaveBeenCalled();
    expect(harness.resume).not.toHaveBeenCalled();
  });

  it.each([
    {
      modelPreset: "economy",
      author: { id: "economy-anthropic-author", version: 2 },
      critic: { id: "economy-openai-critic", version: 1 },
    },
    {
      modelPreset: "standard",
      author: { id: "standard-anthropic-author", version: 1 },
      critic: { id: "standard-openai-critic", version: 2 },
    },
    {
      modelPreset: "development-glm",
      author: { id: "dev-deepinfra-glm-author", version: 1 },
      critic: { id: "economy-openai-critic", version: 1 },
    },
    {
      modelPreset: "development-gemini",
      author: { id: "dev-google-gemini-author", version: 2 },
      critic: { id: "economy-openai-critic", version: 1 },
    },
    {
      modelPreset: "development-mistral",
      author: { id: "dev-mistral-author", version: 1 },
      critic: { id: "economy-openai-critic", version: 1 },
    },
  ] as const)(
    "forwards only the exact $modelPreset preset references to start",
    async ({ modelPreset, author, critic }) => {
      const harness = createHarness();

      await harness.invoke("start", "workspace", "--model-preset", modelPreset);

      expect(harness.startCommands).toEqual([
        {
          root: expect.stringContaining("workspace"),
          modelProfiles: { author, critic },
          allowProviderData: false,
        },
      ]);
    },
  );

  it("forwards an exact explicit pair alongside existing start controls", async () => {
    const harness = createHarness();

    await harness.invoke(
      "start",
      "workspace",
      "--author-profile",
      "legacy-anthropic-author@1",
      "--critic-profile",
      "legacy-openai-critic@1",
      "--opportunity-brief-id",
      "role-brief",
      "--opportunity-version",
      "3",
      "--candidate-profile-id",
      "candidate-default",
      "--candidate-profile-version",
      "4",
      "--writing-policy-override",
      "a".repeat(64),
      "--allow-provider-data",
    );

    expect(harness.startCommands).toEqual([
      {
        root: expect.stringContaining("workspace"),
        modelProfiles: {
          author: { id: "legacy-anthropic-author", version: 1 },
          critic: { id: "legacy-openai-critic", version: 1 },
        },
        opportunityBrief: { briefId: "role-brief", version: 3 },
        candidateProfile: { profileId: "candidate-default", version: 4 },
        writingPolicyOverrideChecksum: "a".repeat(64),
        allowProviderData: true,
      },
    ]);
  });

  it("forwards the exact development Mistral author profile with the Luna critic", async () => {
    const harness = createHarness();

    await harness.invoke(
      "start",
      "workspace",
      "--author-profile",
      "dev-mistral-author@1",
      "--critic-profile",
      "economy-openai-critic@1",
      "--allow-provider-data",
    );

    expect(harness.startCommands).toEqual([
      {
        root: expect.stringContaining("workspace"),
        modelProfiles: {
          author: { id: "dev-mistral-author", version: 1 },
          critic: { id: "economy-openai-critic", version: 1 },
        },
        allowProviderData: true,
      },
    ]);
  });

  it("keeps the legacy start command shape when no profile selection is supplied", async () => {
    const harness = createHarness();

    await harness.invoke("start", "workspace");

    expect(harness.startCommands).toEqual([
      { root: expect.stringContaining("workspace"), allowProviderData: false },
    ]);
    expect(harness.startCommands[0]).not.toHaveProperty("modelProfiles");
  });

  it.each([
    ["--model-preset", "economy", "--author-profile", "legacy-anthropic-author@1"],
    ["--author-profile", "legacy-anthropic-author@1"],
    ["--critic-profile", "legacy-openai-critic@1"],
    ["--author-profile", "@1", "--critic-profile", "legacy-openai-critic@1"],
    ["--author-profile", "legacy-anthropic-author@0", "--critic-profile", "legacy-openai-critic@1"],
    [
      "--author-profile",
      "legacy-anthropic-author@9007199254740992",
      "--critic-profile",
      "legacy-openai-critic@1",
    ],
    ["--author-profile", "legacy-anthropic-author@2", "--critic-profile", "legacy-openai-critic@1"],
    ["--author-profile", "legacy-openai-critic@1", "--critic-profile", "legacy-openai-critic@1"],
    ["--model-preset", "unknown-secret-preset"],
    ["--model-preset", "premium"],
  ] as const)("rejects invalid profile selection %j before calling start", async (...options) => {
    const harness = createHarness();

    await expect(harness.invoke("start", "workspace", ...options)).rejects.toThrow();
    expect(harness.start).not.toHaveBeenCalled();
  });

  it("documents unvalidated status and exact run-only selection in help", () => {
    const harness = createHarness();
    const cli = harness.create();
    const startHelp = cli.commands.find((command) => command.name() === "start")?.helpInformation();
    const modelProfilesHelp = cli.commands
      .find((command) => command.name() === "model-profiles")
      ?.helpInformation();
    const resumeHelp = cli.commands
      .find((command) => command.name() === "resume")
      ?.helpInformation();

    expect(startHelp).toContain("--model-preset <id>");
    expect(startHelp).toContain("--author-profile <id@version>");
    expect(startHelp).toContain("--critic-profile <id@version>");
    expect(startHelp).toContain("unvalidated");
    expect(startHelp).toContain("development-glm");
    expect(startHelp).toContain("DEEPINFRA_API_KEY");
    expect(startHelp).toContain("development-gemini");
    expect(startHelp).toContain("GEMINI_API_KEY");
    expect(startHelp).toContain("GEMINI_API_KEY");
    expect(startHelp).toContain("dev-google-gemini-author@2");
    expect(startHelp?.replace(/\s+/g, " ")).toContain(
      "dev-google-gemini-author@1, Gemini 3.7 Flash, remains accepted for existing runs",
    );
    expect(startHelp).toContain("development-mistral");
    expect(startHelp).toContain("MISTRAL_API_KEY");
    expect(startHelp).toContain("dev-mistral-author@1");
    expect(startHelp).toContain("pinned to this run");
    expect(modelProfilesHelp).toContain("unvalidated");
    expect(modelProfilesHelp).toContain("availability has not been checked");
    expect(resumeHelp).not.toContain("--model-preset");
    expect(resumeHelp).not.toContain("--author-profile");
  });

  it("does not add model selection options to resume", async () => {
    const harness = createHarness();
    const cli = harness.create();
    cli.exitOverride();

    await expect(
      cli.parseAsync(["node", "draft-loop", "resume", "workspace", "--model-preset", "economy"]),
    ).rejects.toThrow();
    expect(harness.resume).not.toHaveBeenCalled();
  });
});
