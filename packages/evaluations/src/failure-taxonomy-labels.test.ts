import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/** The labelled Economy rounds (#1105) stay complete, content-free and split by case. */

interface Labels {
  readonly provenance: { readonly kind: string; readonly rounds: number; readonly costUsd: number };
  readonly modes: readonly { readonly id: string; readonly definition: string }[];
  readonly rounds: readonly {
    readonly id: string;
    readonly caseId: string;
    readonly split: "train" | "dev" | "held-out";
    readonly labels: Readonly<Record<string, "pass" | "fail">>;
    readonly criticFlagged: Readonly<Record<string, boolean>>;
  }[];
}

const labels = JSON.parse(
  readFileSync(new URL("../fixtures/failure-taxonomy/labels.json", import.meta.url), "utf8"),
) as Labels;

describe("failure-taxonomy labels", () => {
  it("label every mode for every round, at least 30 rounds", () => {
    expect(labels.provenance.kind).toBe("synthetic");
    expect(labels.rounds.length).toBe(labels.provenance.rounds);
    expect(labels.rounds.length).toBeGreaterThanOrEqual(30);
    expect(new Set(labels.rounds.map(({ id }) => id)).size).toBe(labels.rounds.length);
    const modes = labels.modes.map(({ id }) => id).sort();
    for (const round of labels.rounds) {
      expect(Object.keys(round.labels).sort(), round.id).toEqual(modes);
      for (const [mode, flagged] of Object.entries(round.criticFlagged)) {
        expect(round.labels[mode], `${round.id}/${mode}`).toBe("fail");
        expect(typeof flagged).toBe("boolean");
      }
    }
  });

  it("keep each case on one side of the split", () => {
    const sides = new Map<string, Set<string>>();
    for (const { caseId, split } of labels.rounds) {
      sides.set(caseId, (sides.get(caseId) ?? new Set()).add(split));
    }
    for (const [caseId, splits] of sides) expect(splits.size, caseId).toBe(1);
    expect(new Set(labels.rounds.map(({ split }) => split))).toEqual(
      new Set(["train", "dev", "held-out"]),
    );
  });
});
