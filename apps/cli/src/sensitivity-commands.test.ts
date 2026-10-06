import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createCli } from "./index.js";
import {
  type ApplicationService,
  CliUserError,
  createCandidateKnowledgeStoreService,
  createSourceSensitivityService,
  type SensitiveKnowledgeConsentService,
  type SourceSensitivityPreview,
  type SourceSensitivityRulesView,
  type SourceSensitivityService,
  type WithheldKnowledgeCounts,
} from "./workflow.js";

const rulesView: SourceSensitivityRulesView = {
  knowledgeBaseId: "kb-1",
  version: 2,
  checksum: "abc",
  createdAt: "2030-01-01T00:00:00.000Z",
  rules: [
    { id: "pay", tier: "never-share", match: { kind: "heading-contains", text: "Compensation" } },
    { id: "ct", tier: "sensitive", match: { kind: "heading-path", path: ["Work", "Contact"] } },
  ],
};

const preview: SourceSensitivityPreview = {
  knowledgeBaseId: "kb-1",
  sourceId: "src-1",
  versionId: "ver-1",
  mediaType: "text/markdown",
  rulesVersion: 2,
  sectionedByHeadings: true,
  sections: [
    {
      index: 0,
      headingPath: ["Work", "Compensation"],
      level: 2,
      tier: "never-share",
      matchedRuleIds: ["pay"],
      characterCount: 42,
    },
  ],
};

const noCounts = { sections: 0, characters: 0 };
const neverShareCounts = { sections: 1, characters: 87 };
const sensitiveCounts = { sections: 2, characters: 150 };
const bothCounts = { sections: 3, characters: 237 };

function consentCounts(allowSensitive: boolean): WithheldKnowledgeCounts {
  const totals = {
    neverShare: neverShareCounts,
    sensitive: sensitiveCounts,
    withheldNow: allowSensitive ? neverShareCounts : bothCounts,
    withheldIfToggled: allowSensitive ? bothCounts : neverShareCounts,
  };
  return {
    allowSensitive,
    consentUpdatedAt: "2030-01-02T03:04:05.000Z",
    knowledgeBases: [{ storeId: "store-1", knowledgeBaseId: "kb-1", ...totals }],
    total: totals,
  };
}

function setup() {
  const lines: string[] = [];
  let allowSensitive = false;
  const consentService = {
    countWithheldKnowledge: vi.fn(async () => consentCounts(allowSensitive)),
    setSensitiveKnowledgeConsent: vi.fn(async (_root: string, allow: boolean) => {
      allowSensitive = allow;
      return { allowSensitive: allow, updatedAt: "2030-01-02T03:04:05.000Z" };
    }),
  } satisfies SensitiveKnowledgeConsentService;
  const service = {
    listSensitivityRules: vi.fn(async () => rulesView),
    addSensitivityRule: vi.fn(async () => rulesView),
    removeSensitivityRule: vi.fn(async () => rulesView),
    adoptSensitivitySuggestions: vi.fn(async () => ({
      ...rulesView,
      adopted: ["suggest-contact"],
      skipped: ["suggest-salary"],
    })),
    listSensitivitySuggestions: vi.fn(() =>
      [rulesView.rules[0]].flatMap((rule) => (rule ? [rule] : [])),
    ),
    previewSourceSensitivity: vi.fn(async () => preview),
  } satisfies SourceSensitivityService;
  const cli = createCli({
    service: {} as ApplicationService,
    sensitivityService: service,
    consentService,
    io: { write: (line: string) => lines.push(line) },
  });
  cli.exitOverride();
  const run = (...args: string[]) =>
    cli.parseAsync(["node", "draft-loop", "knowledge", "sensitivity", ...args]);
  return { service, consentService, lines, run };
}

describe("knowledge sensitivity CLI", () => {
  it("lists rules as text and JSON", async () => {
    const { service, lines, run } = setup();
    await run("list", "store", "kb-1");
    expect(service.listSensitivityRules).toHaveBeenCalledWith({
      storeRoot: "store",
      knowledgeBaseId: "kb-1",
    });
    expect(lines).toEqual([
      "sensitivity rules version 2 (2 rules, saved 2030-01-01T00:00:00.000Z)",
      '  pay  never-share  heading contains "Compensation"',
      "  ct  sensitive  heading path Work > Contact",
    ]);
    lines.length = 0;
    await run("list", "store", "kb-1", "--json");
    expect(JSON.parse(lines[0] ?? "")).toEqual(rulesView);
  });

  it("adds a heading-contains rule and a heading-path rule", async () => {
    const { service, run } = setup();
    await run("add", "store", "kb-1", "--tier", "never-share", "--heading-contains", "Salary");
    expect(service.addSensitivityRule).toHaveBeenLastCalledWith({
      storeRoot: "store",
      knowledgeBaseId: "kb-1",
      rule: { tier: "never-share", match: { kind: "heading-contains", text: "Salary" } },
    });
    await run(
      "add",
      "store",
      "kb-1",
      "--heading-path",
      "Work",
      "Contact details",
      "--tier",
      "sensitive",
      "--id",
      "my-rule",
    );
    expect(service.addSensitivityRule).toHaveBeenLastCalledWith({
      storeRoot: "store",
      knowledgeBaseId: "kb-1",
      id: "my-rule",
      rule: {
        tier: "sensitive",
        match: { kind: "heading-path", path: ["Work", "Contact details"] },
      },
    });
  });

  it("rejects a bad tier and a missing or ambiguous match", async () => {
    const { service, run } = setup();
    await expect(
      run("add", "store", "kb-1", "--tier", "secret", "--heading-contains", "x"),
    ).rejects.toThrow(/--tier must be one of: normal, sensitive, never-share/u);
    await expect(run("add", "store", "kb-1", "--tier", "sensitive")).rejects.toThrow(
      /exactly one of --heading-contains or --heading-path/u,
    );
    await expect(
      run(
        "add",
        "store",
        "kb-1",
        "--tier",
        "sensitive",
        "--heading-contains",
        "x",
        "--heading-path",
        "y",
      ),
    ).rejects.toBeInstanceOf(CliUserError);
    expect(service.addSensitivityRule).not.toHaveBeenCalled();
  });

  it("removes a rule by id", async () => {
    const { service, run } = setup();
    await run("remove", "store", "kb-1", "pay");
    expect(service.removeSensitivityRule).toHaveBeenCalledWith({
      storeRoot: "store",
      knowledgeBaseId: "kb-1",
      ruleId: "pay",
    });
  });

  it("lists suggestions without needing a store and says they are not applied", async () => {
    const { lines, run } = setup();
    await run("suggestions");
    expect(lines[0]).toMatch(/not applied/u);
    expect(lines[1]).toBe('  pay  never-share  heading contains "Compensation"');
  });

  it("adopts suggestions only with --confirm", async () => {
    const { service, lines, run } = setup();
    await expect(run("adopt", "store", "kb-1", "suggest-contact")).rejects.toThrow(
      /requires --confirm/u,
    );
    expect(service.adoptSensitivitySuggestions).not.toHaveBeenCalled();
    await run("adopt", "store", "kb-1", "suggest-contact", "suggest-salary", "--confirm");
    expect(service.adoptSensitivitySuggestions).toHaveBeenCalledWith({
      storeRoot: "store",
      knowledgeBaseId: "kb-1",
      suggestionIds: ["suggest-contact", "suggest-salary"],
    });
    expect(lines.slice(0, 2)).toEqual([
      "adopted: suggest-contact",
      "skipped (already present): suggest-salary",
    ]);
  });

  it("previews a table without text by default and with text on request", async () => {
    const { service, lines, run } = setup();
    await run("preview", "store", "kb-1", "src-1");
    expect(service.previewSourceSensitivity).toHaveBeenLastCalledWith({
      storeRoot: "store",
      knowledgeBaseId: "kb-1",
      sourceId: "src-1",
      includeText: false,
    });
    expect(lines.join("\n")).toContain("never-share");
    expect(lines.join("\n")).toContain("Work > Compensation");

    service.previewSourceSensitivity.mockResolvedValueOnce({
      ...preview,
      sections: preview.sections.map((section) => ({ ...section, text: "SYNTHETIC BODY" })),
    });
    lines.length = 0;
    await run("preview", "store", "kb-1", "src-1", "--version", "ver-0", "--text");
    expect(service.previewSourceSensitivity).toHaveBeenLastCalledWith({
      storeRoot: "store",
      knowledgeBaseId: "kb-1",
      sourceId: "src-1",
      versionId: "ver-0",
      includeText: true,
    });
    expect(lines).toContain("SYNTHETIC BODY");
  });

  it("prints the consent state and counts without changing anything", async () => {
    const { consentService, lines, run } = setup();
    await run("consent", "workspace");
    expect(consentService.setSensitiveKnowledgeConsent).not.toHaveBeenCalled();
    expect(consentService.countWithheldKnowledge).toHaveBeenCalledWith("workspace");
    expect(lines).toEqual([
      "sensitive-knowledge consent: denied (updated 2030-01-02T03:04:05.000Z)",
      "never-share sections are never sent to a provider.",
      "sensitive sections are NOT sent to a provider.",
      "never-share in the selected knowledge: 1 sections, 87 characters",
      "sensitive in the selected knowledge: 2 sections, 150 characters",
      "withheld now: 3 sections, 237 characters",
      "if you allow sensitive sections, withheld would be: 1 sections, 87 characters",
      "  store store-1 knowledge-base kb-1: never-share 1 sections, 87 characters; sensitive 2 sections, 150 characters",
    ]);
  });

  it("allows and denies sensitive sections explicitly and says what is sent", async () => {
    const { consentService, lines, run } = setup();
    await run("consent", "workspace", "--allow");
    expect(consentService.setSensitiveKnowledgeConsent).toHaveBeenLastCalledWith("workspace", true);
    expect(lines).toContain("sensitive sections ARE sent to a provider.");
    expect(lines).toContain("never-share sections are never sent to a provider.");
    expect(lines).toContain("withheld now: 1 sections, 87 characters");
    expect(lines).toContain(
      "if you deny sensitive sections, withheld would be: 3 sections, 237 characters",
    );
    lines.length = 0;
    await run("consent", "workspace", "--deny");
    expect(consentService.setSensitiveKnowledgeConsent).toHaveBeenLastCalledWith(
      "workspace",
      false,
    );
    expect(lines).toContain("sensitive sections are NOT sent to a provider.");
  });

  it("prints the consent view as JSON and rejects --allow with --deny", async () => {
    const { consentService, lines, run } = setup();
    await run("consent", "workspace", "--json");
    expect(JSON.parse(lines[0] ?? "")).toEqual(consentCounts(false));
    await expect(run("consent", "workspace", "--allow", "--deny")).rejects.toThrow(
      /at most one of --allow or --deny/u,
    );
    expect(consentService.setSensitiveKnowledgeConsent).not.toHaveBeenCalled();
  });

  it("states that consent is unset when no consent has been recorded", async () => {
    const { consentService, lines, run } = setup();
    consentService.countWithheldKnowledge.mockResolvedValueOnce({
      ...consentCounts(false),
      consentUpdatedAt: null,
      knowledgeBases: [],
      total: {
        neverShare: noCounts,
        sensitive: noCounts,
        withheldNow: noCounts,
        withheldIfToggled: noCounts,
      },
    });
    await run("consent", "workspace");
    expect(lines[0]).toBe("sensitive-knowledge consent: not set (sensitive sections are not sent)");
    expect(lines).toContain("withheld now: 0 sections, 0 characters");
  });

  it("works end to end against a real store", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-cli-sensitivity-"));
    try {
      const storeRoot = join(directory, "store");
      const view = await createCandidateKnowledgeStoreService().initializeStore({ storeRoot });
      const knowledgeBaseId = view.knowledgeBases[0]?.id ?? "";
      const lines: string[] = [];
      const cli = createCli({
        service: {} as ApplicationService,
        sensitivityService: createSourceSensitivityService(),
        io: { write: (line: string) => lines.push(line) },
      });
      const run = (...args: string[]) =>
        cli.parseAsync(["node", "draft-loop", "knowledge", "sensitivity", ...args]);
      await run("list", storeRoot, knowledgeBaseId);
      expect(lines.at(-1)).toMatch(/none saved/u);
      await run(
        "add",
        storeRoot,
        knowledgeBaseId,
        "--tier",
        "never-share",
        "--heading-contains",
        "Salary",
        "--id",
        "pay",
      );
      await run(
        "add",
        storeRoot,
        knowledgeBaseId,
        "--tier",
        "sensitive",
        "--heading-path",
        "A",
        "B",
      );
      lines.length = 0;
      await run("list", storeRoot, knowledgeBaseId, "--json");
      const listed = JSON.parse(lines[0] ?? "") as SourceSensitivityRulesView;
      expect(listed.version).toBe(2);
      expect(listed.rules.map((rule) => rule.id)[0]).toBe("pay");
      await run("remove", storeRoot, knowledgeBaseId, "pay");
      await expect(run("remove", storeRoot, knowledgeBaseId, "pay")).rejects.toThrow(
        /No sensitivity rule with id pay/u,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
