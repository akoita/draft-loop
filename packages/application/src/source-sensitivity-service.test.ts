import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultSourceSensitivityRuleSuggestions } from "@draft-loop/domain/source-sensitivity";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliUserError } from "./cli-user-error.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";
import { createSourceSensitivityService } from "./source-sensitivity-service.js";

const markdown = [
  "Intro line.",
  "",
  "# Experience",
  "Built synthetic widgets.",
  "",
  "## Compensation",
  "Synthetic pay band.",
  "",
  "# Contact",
  "nobody@example.invalid",
  "",
].join("\n");

describe("source sensitivity service", () => {
  let directory: string;
  let storeRoot: string;
  let knowledgeBaseId: string;
  let sourceId: string;
  let versionId: string;
  let plainSourceId: string;
  const knowledge = createCandidateKnowledgeStoreService();
  let tick = 0;
  const service = createSourceSensitivityService({
    now: () => new Date(Date.UTC(2030, 0, 1, 0, 0, tick++)).toISOString(),
  });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "draft-loop-sensitivity-"));
    storeRoot = join(directory, "store");
    tick = 0;
    const view = await knowledge.initializeStore({ storeRoot });
    const base = view.knowledgeBases[0];
    if (base === undefined) throw new Error("expected a default knowledge base");
    knowledgeBaseId = base.id;
    const markdownPath = join(directory, "history.md");
    await writeFile(markdownPath, markdown, "utf8");
    const imported = await knowledge.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId,
      sourcePath: markdownPath,
    });
    sourceId = imported.source.id;
    versionId = imported.versions[0]?.id ?? "";
    const plainPath = join(directory, "notes.txt");
    await writeFile(plainPath, "# not a heading in plain text\nSynthetic notes.\n", "utf8");
    plainSourceId = (
      await knowledge.importKnowledgeSourceFile({
        storeRoot,
        knowledgeBaseId,
        sourcePath: plainPath,
      })
    ).source.id;
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const base = () => ({ storeRoot, knowledgeBaseId });

  it("reports version 0 and no rules before any are saved", async () => {
    expect(await service.listSensitivityRules(base())).toEqual({
      knowledgeBaseId,
      version: 0,
      checksum: null,
      createdAt: null,
      rules: [],
    });
  });

  it("rejects an unknown knowledge base", async () => {
    await expect(
      service.listSensitivityRules({ storeRoot, knowledgeBaseId: "missing" }),
    ).rejects.toThrow(CliUserError);
  });

  it("appends a new version on each add and remove", async () => {
    const first = await service.addSensitivityRule({
      ...base(),
      id: "pay",
      rule: { tier: "never-share", match: { kind: "heading-contains", text: "Compensation" } },
    });
    expect(first.version).toBe(1);
    expect(first.rules.map((rule) => rule.id)).toEqual(["pay"]);

    const second = await service.addSensitivityRule({
      ...base(),
      rule: { tier: "sensitive", match: { kind: "heading-path", path: ["Contact"] } },
    });
    expect(second.version).toBe(2);
    expect(second.rules).toHaveLength(2);
    expect(second.rules[1]?.id).toMatch(/^rule-[0-9a-f]{8}$/u);
    expect(second.checksum).not.toBe(first.checksum);

    const third = await service.removeSensitivityRule({ ...base(), ruleId: "pay" });
    expect(third.version).toBe(3);
    expect(third.rules.map((rule) => rule.id)).toEqual([second.rules[1]?.id]);
    expect(await service.listSensitivityRules(base())).toEqual(third);
  });

  it("rejects duplicate ids, equivalent rules, invalid rules, and absent removals", async () => {
    await service.addSensitivityRule({
      ...base(),
      id: "pay",
      rule: { tier: "never-share", match: { kind: "heading-contains", text: "Compensation" } },
    });
    await expect(
      service.addSensitivityRule({
        ...base(),
        id: "pay",
        rule: { tier: "sensitive", match: { kind: "heading-contains", text: "Other" } },
      }),
    ).rejects.toThrow(/id pay already exists/u);
    await expect(
      service.addSensitivityRule({
        ...base(),
        id: "pay-again",
        rule: { tier: "never-share", match: { kind: "heading-contains", text: " compensation " } },
      }),
    ).rejects.toThrow(/equivalent never-share rule .* already exists as pay/u);
    await expect(
      service.addSensitivityRule({
        ...base(),
        id: "bad id!",
        rule: { tier: "sensitive", match: { kind: "heading-contains", text: "x" } },
      }),
    ).rejects.toThrow(CliUserError);
    await expect(
      service.addSensitivityRule({
        ...base(),
        rule: { tier: "bogus" as never, match: { kind: "heading-contains", text: "x" } },
      }),
    ).rejects.toThrow(/Tier must be one of/u);
    await expect(service.removeSensitivityRule({ ...base(), ruleId: "absent" })).rejects.toThrow(
      /No sensitivity rule with id absent/u,
    );
    expect((await service.listSensitivityRules(base())).version).toBe(1);
  });

  it("lists suggestions and adopts only the chosen ones, skipping existing", async () => {
    expect(service.listSensitivitySuggestions()).toBe(defaultSourceSensitivityRuleSuggestions);
    expect((await service.listSensitivityRules(base())).version).toBe(0);

    const adopted = await service.adoptSensitivitySuggestions({
      ...base(),
      suggestionIds: ["suggest-compensation", "suggest-contact"],
    });
    expect(adopted.version).toBe(1);
    expect(adopted.adopted).toEqual(["suggest-compensation", "suggest-contact"]);
    expect(adopted.rules.map((rule) => rule.id)).toEqual([
      "suggest-compensation",
      "suggest-contact",
    ]);

    const again = await service.adoptSensitivitySuggestions({
      ...base(),
      suggestionIds: ["suggest-contact"],
    });
    expect(again.version).toBe(1);
    expect(again.adopted).toEqual([]);
    expect(again.skipped).toEqual(["suggest-contact"]);

    await expect(
      service.adoptSensitivitySuggestions({ ...base(), suggestionIds: ["nope"] }),
    ).rejects.toThrow(/Unknown suggestion id nope/u);
    await expect(
      service.adoptSensitivitySuggestions({ ...base(), suggestionIds: [] }),
    ).rejects.toThrow(/at least one suggestion/u);
  });

  it("previews tiers per section without text by default", async () => {
    await service.adoptSensitivitySuggestions({
      ...base(),
      suggestionIds: ["suggest-compensation", "suggest-contact"],
    });
    const preview = await service.previewSourceSensitivity({ ...base(), sourceId });
    expect(preview.versionId).toBe(versionId);
    expect(preview.rulesVersion).toBe(1);
    expect(preview.sectionedByHeadings).toBe(true);
    expect(
      preview.sections.map((section) => [section.headingPath.join(" > "), section.tier]),
    ).toEqual([
      ["", "normal"],
      ["Experience", "normal"],
      ["Experience > Compensation", "never-share"],
      ["Contact", "sensitive"],
    ]);
    expect(preview.sections[2]?.matchedRuleIds).toEqual(["suggest-compensation"]);
    expect(preview.sections[2]?.characterCount).toBeGreaterThan(0);
    for (const section of preview.sections) expect(section).not.toHaveProperty("text");
    expect(JSON.stringify(preview)).not.toContain("Synthetic pay band");
  });

  it("includes section text only when asked", async () => {
    const preview = await service.previewSourceSensitivity({
      ...base(),
      sourceId,
      versionId,
      includeText: true,
    });
    expect(preview.rulesVersion).toBe(0);
    expect(preview.sections.map((section) => section.text).join("")).toContain(
      "Synthetic pay band.",
    );
  });

  it("previews a non-Markdown source as one root section", async () => {
    await service.addSensitivityRule({
      ...base(),
      rule: { tier: "never-share", match: { kind: "heading-contains", text: "heading" } },
    });
    const preview = await service.previewSourceSensitivity({ ...base(), sourceId: plainSourceId });
    expect(preview.sectionedByHeadings).toBe(false);
    expect(preview.sections).toHaveLength(1);
    expect(preview.sections[0]).toMatchObject({
      headingPath: [],
      level: 0,
      tier: "normal",
      matchedRuleIds: [],
    });
  });

  it("rejects an unknown source or version", async () => {
    await expect(
      service.previewSourceSensitivity({ ...base(), sourceId: "missing" }),
    ).rejects.toThrow(/Source missing was not found/u);
    await expect(
      service.previewSourceSensitivity({ ...base(), sourceId, versionId: "missing" }),
    ).rejects.toThrow(/Version missing .* was not found/u);
  });
});
