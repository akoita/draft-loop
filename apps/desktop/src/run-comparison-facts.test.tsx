import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApplicationRunRowView } from "./application-run-list.js";
import type { ReviewCoverageView } from "./coverage-contract.js";
import {
  createFixtureReviewState,
  type DesktopReviewState,
  type ReviewArtifact,
  type ReviewFinding,
  type RunWritingPolicyProjection,
} from "./model.js";
import { RunComparisonFactsTable, RunComparisonView } from "./run-comparison.js";
import {
  maximumComparisonMarkdownBytes,
  runComparisonFileName,
  runComparisonMarkdown,
} from "./run-comparison-export.js";
import { notRecorded, runComparisonFacts } from "./run-comparison-facts.js";
import { runComparisonReducer } from "./run-comparison-model.js";
import type { RunInputsView } from "./run-inputs.js";

const fixture = createFixtureReviewState();

function row(runId: string, extra: Partial<ApplicationRunRowView> = {}): ApplicationRunRowView {
  return {
    runId,
    startedAt: "2026-10-12T07:00:00.000Z",
    authorModel: "claude-opus-4-1",
    criticModel: "gpt-5",
    round: 1,
    state: "stopped",
    latest: false,
    ...extra,
  };
}

// Newest first: Run 2 is the open, latest run and Run 1 the earlier one.
const runs: readonly ApplicationRunRowView[] = [
  row("run-new", { authorModel: "claude-opus-5-5", criticModel: "gpt-6.1", latest: true }),
  row("run-old"),
];

function coverage(
  instructionsVersion: string | null,
  statuses: readonly ("covered" | "uncovered")[],
): ReviewCoverageView {
  return {
    instructionsVersion,
    summary: { judged: statuses.length, satisfied: 0, notSatisfied: 0, invalid: 0, unanswered: 0 },
    assessments: statuses.map((status, index) => ({
      requirementId: `requirement-${index}`,
      status,
      basis: "judgement",
      evidence: [],
      rationale: "internal critic rationale",
    })),
  };
}

function finding(
  id: string,
  severity: "error" | "warning",
  decision: ReviewFinding["decision"],
): ReviewFinding {
  return {
    id,
    code: "unsupported-claim",
    category: "factuality",
    severity,
    message: "hidden finding text",
    decision,
    agreement: "critic-only",
  };
}

function policy(version: string, checksum: string): RunWritingPolicyProjection {
  return {
    effective: {
      version,
      checksum,
      schemaVersion: 1,
      createdAt: "2026-10-01T00:00:00.000Z",
      priorChecksum: null,
    },
    lineage: { kind: "workspace" },
  };
}

function draft(id: string, opening: string): ReviewArtifact {
  return {
    id,
    version: 4,
    createdAt: "2026-10-12T07:00:00.000Z",
    claims: [],
    sections: [
      {
        id: `${id}-summary`,
        title: "Summary",
        blocks: [{ id: `${id}-block-1`, type: "paragraph", text: opening, claimIds: [] }],
      },
      {
        id: `${id}-experience`,
        title: "Experience",
        blocks: [{ id: `${id}-block-2`, type: "bullet", text: "Led a | piped team", claimIds: [] }],
      },
    ],
  };
}

const oldRun: DesktopReviewState = {
  ...fixture,
  runId: "run-old",
  applicationRuns: runs,
  round: 3,
  evaluation: { ready: false, stopReason: "", scores: { fit: 0.5, clarity: 0.7 } },
  coverage: coverage("coverage-v1", ["covered", "uncovered", "uncovered"]),
  findings: [
    finding("finding-1", "error", "pending"),
    finding("finding-2", "error", "accepted"),
    finding("finding-3", "error", "rejected"),
    finding("finding-4", "warning", "pending"),
  ],
  totalCostUsd: 0.4567,
  evidenceMode: { requestedMode: "retrieval", effectiveMode: "retrieval", chunkCount: 12 },
  writingPolicy: policy("3", "aaaaaaaaaaaaaaaaaaaa"),
  artifact: draft("artifact-old", "An earlier opening line."),
};

const newRun: DesktopReviewState = {
  ...fixture,
  runId: "run-new",
  applicationRuns: runs,
  round: 2,
  evaluation: { ready: true, stopReason: "", scores: { fit: 0.9, clarity: 0.8 } },
  coverage: coverage("coverage-v2", ["covered", "covered", "uncovered"]),
  findings: [finding("finding-5", "warning", "pending")],
  totalCostUsd: 1.2,
  evidenceMode: {
    requestedMode: "full-source",
    effectiveMode: "full-source",
    chunkCount: 282,
    sourceCount: 9,
  },
  writingPolicy: policy("5", "bbbbbbbbbbbbbbbbbbbb"),
  artifact: draft("artifact-new", "A sharper opening line."),
};

function withInputs(state: DesktopReviewState, runInputs: RunInputsView): DesktopReviewState {
  return { ...state, runInputs };
}

const labels = { left: "Run 1", right: "Run 2" };
const facts = runComparisonFacts(oldRun, newRun, labels);

function fact(key: string) {
  const found = facts.facts.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`Expected the ${key} fact.`);
  return found;
}

function input(key: string, from = facts) {
  const found = from.inputs.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`Expected the ${key} input.`);
  return found;
}

describe("the facts each run recorded", () => {
  it("names each run's recorded author and critic models", () => {
    expect(fact("author-model")).toMatchObject({
      left: "claude-opus-4-1",
      right: "claude-opus-5-5",
    });
    expect(fact("critic-model")).toMatchObject({ left: "gpt-5", right: "gpt-6.1" });
  });

  it("gives each run's rounds, mean readiness score, coverage, blocking findings and cost", () => {
    expect(fact("rounds")).toMatchObject({ left: "3", right: "2" });
    expect(fact("readiness")).toMatchObject({ left: "0.60", right: "0.85" });
    expect(fact("coverage")).toMatchObject({ left: "1 of 3 covered", right: "2 of 3 covered" });
    // A pending and an accepted error stay blocking; a rejected one and a warning do not.
    expect(fact("blocking-findings")).toMatchObject({ left: "2", right: "0" });
    expect(fact("cost")).toMatchObject({ left: "$0.457", right: "$1.200" });
  });

  it("reads models from the run's own row, never from the configured pair", () => {
    const reconfigured: DesktopReviewState = {
      ...newRun,
      providerExposure: {
        ...newRun.providerExposure,
        author: { company: "anthropic", model: "claude-current-config" },
        critic: { company: "openai", model: "gpt-current-config" },
      },
      setup: {
        ...newRun.setup,
        reviewedOpportunity: { briefId: "brief-current", version: 9 },
        writingPolicy: policy("99", "cccccccccccc").effective,
      },
    };
    expect(runComparisonFacts(oldRun, reconfigured, labels)).toEqual(facts);
  });

  it("says not recorded for what a run did not record", () => {
    const bare: DesktopReviewState = {
      ...fixture,
      runId: "run-bare",
      applicationRuns: [row("run-bare", { authorModel: "", criticModel: "" })],
      evaluation: { ready: false, stopReason: "", scores: {} },
      coverage: null,
      evidenceMode: null,
    };
    const result = runComparisonFacts(bare, bare, labels);
    for (const key of ["author-model", "critic-model", "readiness", "coverage"]) {
      const found = result.facts.find((candidate) => candidate.key === key);
      expect(found).toMatchObject({ left: notRecorded, right: notRecorded });
    }
  });
});

describe("the input differences between the runs", () => {
  it("flags a different evidence mode and size in words", () => {
    expect(input("evidence")).toMatchObject({
      status: "different",
      message: "Different evidence: retrieval, 12 chunks vs full source, 282 chunks from 9 sources",
    });
  });

  it("flags a different writing policy by version and checksum", () => {
    expect(input("writing-policy")).toMatchObject({
      status: "different",
      message: "Different writing policy: v3 (aaaaaaaaaaaa…) vs v5 (bbbbbbbbbbbb…)",
    });
    const sameVersion = runComparisonFacts(
      { ...oldRun, writingPolicy: policy("5", "dddddddddddddddd") },
      newRun,
      labels,
    );
    expect(input("writing-policy", sameVersion).status).toBe("different");
  });

  it("flags different coverage instructions and marks the judged scores not directly comparable", () => {
    expect(input("coverage-instructions")).toMatchObject({
      status: "different",
      message:
        "Different coverage-judgement instructions: coverage-v1 vs coverage-v2; coverage and readiness are not directly comparable",
    });
    expect(facts.notDirectlyComparable).toBe(true);
    expect(fact("coverage").note).toBe(
      "not directly comparable: judged under different coverage instructions",
    );
    expect(fact("readiness").note).toBeDefined();
    expect(fact("rounds").note).toBeUndefined();
  });

  it("says Same when the runs had the same input", () => {
    const same = runComparisonFacts(newRun, { ...newRun, runId: "run-old" }, labels);
    expect(input("evidence", same)).toMatchObject({ status: "same", message: "Same evidence" });
    expect(input("writing-policy", same)).toMatchObject({ status: "same" });
    expect(input("coverage-instructions", same)).toMatchObject({ status: "same" });
    expect(same.notDirectlyComparable).toBe(false);
    expect(same.facts.find((row) => row.key === "coverage")?.note).toBeUndefined();
  });

  it("says not recorded for either run when neither recorded its inputs, never guessing", () => {
    expect(input("requirements-brief")).toMatchObject({
      status: "unknown",
      message: "Requirements brief not recorded for either run, so it cannot be compared",
    });
    expect(input("career-profile")).toMatchObject({ status: "unknown" });
  });

  it("flags a different requirements brief and career profile by version", () => {
    const left = withInputs(oldRun, {
      brief: { briefId: "target-role", version: 3 },
      profile: { profileId: "profile-1", version: 2 },
    });
    const right = withInputs(newRun, {
      brief: { briefId: "target-role", version: 5 },
      profile: { profileId: "profile-1", version: 4 },
    });
    const different = runComparisonFacts(left, right, labels);
    expect(input("requirements-brief", different)).toMatchObject({
      status: "different",
      message: "Different requirements brief: v3 vs v5",
    });
    expect(input("career-profile", different)).toMatchObject({
      status: "different",
      message: "Different career profile: v2 vs v4",
    });
  });

  it("says Same for the same brief and profile, even when the current selection differs", () => {
    const recorded = {
      brief: { briefId: "target-role", version: 3 },
      profile: { profileId: "profile-1", version: 2 },
    };
    const same = runComparisonFacts(
      withInputs(oldRun, recorded),
      withInputs(
        {
          ...newRun,
          setup: {
            ...newRun.setup,
            reviewedOpportunity: { briefId: "brief-current", version: 9 },
          },
        },
        recorded,
      ),
      labels,
    );
    expect(input("requirements-brief", same)).toMatchObject({
      status: "same",
      message: "Same requirements brief",
    });
    expect(input("career-profile", same)).toMatchObject({
      status: "same",
      message: "Same career profile",
    });
  });

  it("tells another brief with the same version apart without naming its id", () => {
    const result = runComparisonFacts(
      withInputs(oldRun, { brief: { briefId: "role-a", version: 1 }, profile: null }),
      withInputs(newRun, { brief: { briefId: "role-b", version: 1 }, profile: null }),
      labels,
    );
    expect(input("requirements-brief", result)).toMatchObject({
      status: "different",
      message: "Different requirements brief: v1 (other brief) vs v1 (other brief)",
    });
    expect(JSON.stringify(result)).not.toContain("role-a");
  });

  it("names the run that used raw job text, and what the other run used", () => {
    const rawText = { brief: null, profile: { profileId: "profile-1", version: 2 } };
    const briefed = { brief: { briefId: "target-role", version: 5 }, profile: rawText.profile };
    const leftRaw = runComparisonFacts(
      withInputs(oldRun, rawText),
      withInputs(newRun, briefed),
      labels,
    );
    expect(input("requirements-brief", leftRaw)).toMatchObject({
      status: "different",
      left: "none (raw job text)",
      right: "v5",
      message: "Run 1 recorded no requirements brief (raw job text); Run 2 used v5",
    });
    expect(input("career-profile", leftRaw).status).toBe("same");
    const rightRaw = runComparisonFacts(
      withInputs(oldRun, briefed),
      withInputs(newRun, rawText),
      labels,
    );
    expect(input("requirements-brief", rightRaw).message).toBe(
      "Run 2 recorded no requirements brief (raw job text); Run 1 used v5",
    );
  });

  it("says neither run used a brief when both were started from raw job text", () => {
    const rawText = { brief: null, profile: null };
    const both = runComparisonFacts(
      withInputs(oldRun, rawText),
      withInputs(newRun, rawText),
      labels,
    );
    expect(input("requirements-brief", both)).toMatchObject({
      status: "same",
      message: "Neither run used a requirements brief (raw job text)",
    });
    expect(input("career-profile", both).status).toBe("same");
  });

  it("names the run whose brief was not recorded when only the other recorded its inputs", () => {
    const partial = runComparisonFacts(
      oldRun,
      withInputs(newRun, { brief: { briefId: "target-role", version: 5 }, profile: null }),
      labels,
    );
    expect(input("requirements-brief", partial)).toMatchObject({
      status: "unknown",
      message: "Requirements brief not recorded for Run 1, so it cannot be compared",
    });
  });

  it("names the run that did not record an input", () => {
    const partial = runComparisonFacts(oldRun, { ...newRun, evidenceMode: null }, labels);
    expect(input("evidence", partial)).toMatchObject({
      status: "unknown",
      message: "Evidence mode and size not recorded for Run 2, so it cannot be compared",
    });
  });
});

describe("the comparison table on screen", () => {
  const html = renderToStaticMarkup(<RunComparisonFactsTable facts={facts} />);

  it("shows each fact for both runs", () => {
    expect(html).toContain('<th scope="col">Run 1</th><th scope="col">Run 2</th>');
    for (const text of [
      "Author model",
      "claude-opus-5-5",
      "Critic model",
      "gpt-6.1",
      "Rounds",
      "Mean readiness score",
      "0.85",
      "Requirements covered (judged)",
      "2 of 3 covered",
      "Blocking findings left",
      "Cost",
      "$1.200",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('<td data-run="Run 1">$0.457</td>');
  });

  it("shows each input difference in words", () => {
    expect(html).toContain("Input differences");
    expect(html).toContain(
      '<li data-input="writing-policy" data-status="different">Different writing policy: v3',
    );
    expect(html).toContain('data-input="evidence" data-status="different"');
    expect(html).toContain('data-input="coverage-instructions" data-status="different"');
    expect(html).toContain("Requirements brief not recorded for either run");
    expect(html).toContain("Career profile version not recorded for either run");
    expect(html).toContain("not directly comparable: judged under different coverage instructions");
  });

  it("sits above both drafts once the other run is read, with Export comparison", () => {
    const chosen = runComparisonReducer(null, {
      type: "choose",
      workspaceId: newRun.workspaceId,
      openRunId: "run-new",
      otherRunId: "run-old",
    });
    const loaded = runComparisonReducer(chosen, { type: "loaded", state: oldRun });
    if (loaded === null) throw new Error("Expected a comparison.");
    const view = renderToStaticMarkup(
      <RunComparisonView
        comparison={loaded}
        state={newRun}
        onSwap={() => undefined}
        onClose={() => undefined}
        onSaveMarkdown={async () => ({ saved: true, fileName: "comparison.md" })}
      />,
    );
    const table = view.indexOf("run-comparison-table");
    expect(table).toBeGreaterThan(-1);
    expect(table).toBeLessThan(view.indexOf("run-comparison-grid"));
    expect(view).toContain("Export comparison");
    expect(view).toContain("claude-opus-4-1");

    // While the other run is still being read, there is no table and nothing to export.
    if (chosen === null) throw new Error("Expected a comparison.");
    const reading = renderToStaticMarkup(
      <RunComparisonView
        comparison={chosen}
        state={newRun}
        onSwap={() => undefined}
        onClose={() => undefined}
        onSaveMarkdown={async () => ({ saved: true, fileName: "comparison.md" })}
      />,
    );
    expect(reading).not.toContain("run-comparison-table");
    expect(reading).toMatch(/<button[^>]*disabled=""[^>]*>Export comparison/u);
    const withoutSave = renderToStaticMarkup(
      <RunComparisonView
        comparison={loaded}
        state={newRun}
        onSwap={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(withoutSave).not.toContain("Export comparison");
  });
});

describe("the exported comparison file", () => {
  const markdown = runComparisonMarkdown({ facts, left: oldRun.artifact, right: newRun.artifact });

  it("holds the table, the input differences and both drafts' text", () => {
    expect(markdown).toBe(
      [
        "# Run comparison: Run 1 and Run 2",
        "",
        "Each value is what that run recorded.",
        "",
        "|  | Run 1 | Run 2 |",
        "| --- | --- | --- |",
        "| Author model | claude-opus-4-1 | claude-opus-5-5 |",
        "| Critic model | gpt-5 | gpt-6.1 |",
        "| Rounds | 3 | 2 |",
        "| Mean readiness score (not directly comparable: judged under different coverage instructions) | 0.60 | 0.85 |",
        "| Requirements covered (judged) (not directly comparable: judged under different coverage instructions) | 1 of 3 covered | 2 of 3 covered |",
        "| Blocking findings left | 2 | 0 |",
        "| Cost | $0.457 | $1.200 |",
        "",
        "## Input differences",
        "",
        "- Requirements brief not recorded for either run, so it cannot be compared.",
        "- Career profile version not recorded for either run, so it cannot be compared.",
        "- Different evidence: retrieval, 12 chunks vs full source, 282 chunks from 9 sources.",
        "- Different writing policy: v3 (aaaaaaaaaaaa…) vs v5 (bbbbbbbbbbbb…).",
        "- Different coverage-judgement instructions: coverage-v1 vs coverage-v2; coverage and readiness are not directly comparable.",
        "",
        "## Run 1 draft",
        "",
        "Draft version 4.",
        "",
        "### Summary",
        "",
        "An earlier opening line.",
        "",
        "### Experience",
        "",
        "- Led a | piped team",
        "",
        "## Run 2 draft",
        "",
        "Draft version 4.",
        "",
        "### Summary",
        "",
        "A sharper opening line.",
        "",
        "### Experience",
        "",
        "- Led a | piped team",
        "",
      ].join("\n"),
    );
  });

  it("carries no internal ids, critic rationale or finding text", () => {
    for (const hidden of [
      "run-old",
      "run-new",
      "artifact-old",
      "artifact-new",
      "block-1",
      "requirement-0",
      "finding-1",
      fixture.workspaceId,
      "internal critic rationale",
      "hidden finding text",
    ]) {
      expect(markdown).not.toContain(hidden);
    }
    expect(new TextEncoder().encode(markdown).length).toBeLessThan(maximumComparisonMarkdownBytes);
  });

  it("escapes a table cell that would break the row", () => {
    const piped = runComparisonMarkdown({
      facts: {
        ...facts,
        facts: [{ key: "author-model", label: "Author model", left: "a|b", right: "c\nd" }],
      },
      left: null,
      right: null,
    });
    expect(piped).toContain("| Author model | a\\|b | c d |");
    expect(piped).toContain("## Run 1 draft\n\nThe draft could not be read.");
  });

  it("suggests a file name from the run numbers", () => {
    expect(runComparisonFileName("Run 1", "Run 2")).toBe("run-1-vs-run-2-comparison.md");
    expect(runComparisonFileName("", "Run")).toBe("run-vs-run-comparison.md");
  });
});
