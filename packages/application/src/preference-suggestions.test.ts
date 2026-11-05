import type { WritingPolicy } from "@draft-loop/domain";
import type { WorkspaceSettingName, WorkspaceSettingsPort } from "@draft-loop/storage";
import { describe, expect, it } from "vitest";

import { CliUserError } from "./cli-user-error.js";
import {
  applyPreferenceSuggestion,
  createPreferenceSuggestions,
  type PreferenceSuggestion,
  suggestPreferences,
} from "./preference-suggestions.js";
import type { ReviewSignals } from "./review-signals.js";
import { writingPolicyFromCommand } from "./writing-policy-file.js";

const none: ReviewSignals = { dismissedFindings: [], deletedTerms: [], sectionOrders: [] };

const term = (value: string, count: number, apps: string[]) => ({
  term: value,
  count,
  runIds: Array.from({ length: count }, (_, i) => `run-${i}`),
  applicationIds: apps,
});

const order = (runId: string, applicationId: string, approved: string[]) => ({
  runId,
  applicationId,
  drafted: ["summary", "experience", "skills"],
  approved,
  removed: [],
});

const reordered = ["summary", "skills", "experience"];

describe("suggestPreferences", () => {
  it("suggests a term removed at least 3 times across at least 2 applications", () => {
    const suggestions = suggestPreferences(
      {
        ...none,
        deletedTerms: [
          term("passionate", 3, ["a", "b"]),
          term("synergy", 2, ["a", "b"]),
          term("rockstar", 5, ["a"]),
        ],
      },
      undefined,
      new Set(),
    );
    expect(suggestions).toEqual([
      expect.objectContaining({
        kind: "forbidden-term",
        term: "passionate",
        occurrences: 3,
        applications: 2,
        reason: 'You removed "passionate" from 3 drafts across 2 applications.',
      }),
    ]);
    expect(suggestions[0]?.id).toMatch(/^preference-[a-f0-9]{16}$/u);
  });

  it("suggests a section order approved 3 times across 2 applications", () => {
    const signals = {
      ...none,
      sectionOrders: [
        order("r1", "a", reordered),
        order("r2", "b", reordered),
        order("r3", "b", reordered),
      ],
    };
    expect(suggestPreferences(signals, undefined, new Set())).toEqual([
      expect.objectContaining({
        kind: "section-order",
        sectionOrder: reordered,
        occurrences: 3,
        applications: 2,
      }),
    ]);
    const twoOnly = { ...none, sectionOrders: signals.sectionOrders.slice(0, 2) };
    expect(suggestPreferences(twoOnly, undefined, new Set())).toEqual([]);
    const oneApp = {
      ...none,
      sectionOrders: signals.sectionOrders.map((s) => ({ ...s, applicationId: "a" })),
    };
    expect(suggestPreferences(oneApp, undefined, new Set())).toEqual([]);
  });

  it("skips what the policy already holds and what was dismissed", () => {
    const signals = {
      deletedTerms: [term("passionate", 3, ["a", "b"])],
      sectionOrders: [
        order("r1", "a", reordered),
        order("r2", "b", reordered),
        order("r3", "b", reordered),
      ],
      dismissedFindings: [],
    };
    const [first, second] = suggestPreferences(signals, undefined, new Set());
    const policy = {
      rules: [
        {
          id: "x",
          kind: "forbidden-term",
          term: "Passionate",
          caseSensitive: false,
          wholeWord: true,
        },
      ],
      preferences: { sectionOrder: reordered },
    } as unknown as WritingPolicy;
    expect(suggestPreferences(signals, policy, new Set())).toEqual([]);
    expect(
      suggestPreferences(signals, undefined, new Set([first?.id ?? "", second?.id ?? ""])),
    ).toEqual([]);
  });
});

describe("applyPreferenceSuggestion", () => {
  const forbidden: PreferenceSuggestion = {
    id: "preference-0000000000000000",
    kind: "forbidden-term",
    term: "passionate",
    occurrences: 3,
    applications: 2,
    reason: "",
  };
  const sections: PreferenceSuggestion = {
    id: "preference-1111111111111111",
    kind: "section-order",
    sectionOrder: reordered,
    occurrences: 3,
    applications: 2,
    reason: "",
  };

  it("yields a valid policy that enforces the accepted preference", async () => {
    const content =
      "# Policy\n\nTone: professional\nSection order: summary, experience\n\n## Rules\n\n- No em dashes.";
    const updated = applyPreferenceSuggestion(
      applyPreferenceSuggestion(content, forbidden),
      sections,
    );
    const compiled = await writingPolicyFromCommand({ content: updated });
    expect(
      compiled.rules?.some((rule) => rule.kind === "forbidden-term" && rule.term === "passionate"),
    ).toBe(true);
    expect(compiled.preferences?.sectionOrder).toEqual(reordered);
    expect(updated.match(/Section order/gu)).toHaveLength(1);
  });

  it("adds a section order when the policy has none", () => {
    expect(applyPreferenceSuggestion("# Policy", sections)).toBe(
      "# Policy\n\nSection order: summary, skills, experience\n",
    );
  });
});

function memorySettings(): WorkspaceSettingsPort & { docs: Map<string, string> } {
  const docs = new Map<string, string>();
  const key = (root: string, name: WorkspaceSettingName) => `${root}\u0000${name}`;
  return {
    docs,
    read: async (root, name) => docs.get(key(root, name)),
    write: async (root, name, content) => {
      docs.set(key(root, name), content);
    },
    remove: async (root, name) => docs.delete(key(root, name)),
  };
}

describe("preference suggestions service", () => {
  const root = "/tenants/t/workspaces/w";
  const run = (id: string, app: string, edited: string) => ({ id, app, edited });
  const runs = [
    run("r1", "a", "An engineer."),
    run("r2", "b", "A builder."),
    run("r3", "b", "A person."),
  ];

  function open() {
    const versions = new Map<string, unknown>();
    for (const { id, edited } of runs) {
      const section = (text: string) => [{ kind: "summary", blocks: [{ id: "b", text }] }];
      versions.set(`${id}-v1`, {
        id: `${id}-v1`,
        parentVersionId: null,
        sections: section("A passionate engineer."),
      });
      versions.set(`${id}-v1-candidate-edits`, {
        id: `${id}-v1-candidate-edits`,
        parentVersionId: `${id}-v1`,
        sections: section(edited),
      });
    }
    const history = {
      listRuns: async () =>
        runs.map(({ id }) => ({
          id,
          approval: "approved",
          artifactId: `${id}-v1-candidate-edits`,
        })),
      listFindings: async () => [],
      listDecisions: async () => [],
      getArtifactVersion: async (id: string) => ({ payload: versions.get(id) }),
      applications: {
        applicationIdForRun: async (_w: string, runId: string) =>
          runs.find((r) => r.id === runId)?.app,
      },
      close: async () => undefined,
    };
    let content = "# Policy\n";
    const saved: string[] = [];
    const settings = memorySettings();
    const suggestions = createPreferenceSuggestions({
      storage: { open: async () => history, exportBlobs: {} } as never,
      settings,
      service: {
        readWorkspace: async () => ({ id: "w" }) as never,
        getWritingPolicy: async () =>
          ({ policy: await writingPolicyFromCommand({ content }) }) as never,
        configureWritingPolicy: async (command) => {
          content = command.content ?? content;
          saved.push(content);
          return {} as never;
        },
      },
    });
    return { suggestions, saved, settings };
  }

  it("accepting writes a new policy version and the suggestion is gone", async () => {
    const { suggestions, saved } = open();
    const [suggestion] = await suggestions.list(root);
    expect(suggestion).toMatchObject({ kind: "forbidden-term", term: "passionate" });
    await suggestions.accept(root, suggestion?.id ?? "");
    expect(saved).toEqual(["# Policy\n- Forbidden term: passionate\n"]);
    expect(await suggestions.list(root)).toEqual([]);
  });

  it("dismissing records only the id and never offers it again", async () => {
    const { suggestions, saved, settings } = open();
    const [suggestion] = await suggestions.list(root);
    await suggestions.dismiss(root, suggestion?.id ?? "");
    expect(await suggestions.list(root)).toEqual([]);
    expect(saved).toEqual([]);
    expect([...settings.docs.values()].join("")).not.toContain("passionate");
  });

  it("refuses an id that is not waiting for a decision", async () => {
    const { suggestions } = open();
    await expect(suggestions.accept(root, "preference-ffffffffffffffff")).rejects.toBeInstanceOf(
      CliUserError,
    );
    await expect(suggestions.dismiss(root, "preference-ffffffffffffffff")).rejects.toBeInstanceOf(
      CliUserError,
    );
  });
});
