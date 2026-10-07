import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteStorage } from "@draft-loop/storage";
import { afterEach, describe, expect, it } from "vitest";
import { type CliIo, initWorkspace, startRun, statusRun } from "./workflow.js";

const directories: string[] = [];

async function startedWorkspace(): Promise<{ readonly root: string; readonly runId: string }> {
  const root = await mkdtemp(join(tmpdir(), "draft-loop-cli-coverage-"));
  directories.push(root);
  await mkdir(join(root, "evidence"));
  await writeFile(join(root, "job.md"), "TypeScript systems engineer\nKubernetes operations\n");
  await writeFile(
    join(root, "evidence", "resume.md"),
    "Synthetic candidate evidence for TypeScript systems engineering and Kubernetes operations.",
  );
  await initWorkspace({ root, jobDescription: "job.md", sources: "evidence", fixtureMode: true });
  const started = await startRun(root);
  return { root, runId: started.runId };
}

function io(): { readonly output: string[]; readonly value: CliIo } {
  const output: string[] = [];
  return { output, value: { write: (line) => output.push(line) } };
}

async function attachCoverageJudgement(root: string, runId: string): Promise<void> {
  const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
  try {
    const key = `draft-loop:orchestration:run:${runId}`;
    const stored = await storage.get(key);
    if (stored === undefined) throw new Error("The run snapshot was not stored.");
    const snapshot = JSON.parse(stored) as {
      round: number;
      executionHistory: Array<Record<string, unknown>>;
    };
    const critic = snapshot.executionHistory.findLast(
      (execution) => execution.step === "critic" && execution.round === snapshot.round,
    );
    if (critic === undefined) throw new Error("The fixture run has no critic execution.");
    critic.coverageJudgement = {
      instructionsVersion: "coverage-judgement-v1",
      summary: { judged: 2, satisfied: 1, notSatisfied: 1, invalid: 0, unanswered: 0 },
      assessments: [
        {
          requirementId: "req-1",
          status: "covered",
          basis: "judgement",
          evidence: [{ blockId: "block-a" }, { blockId: "block-b", score: 0.8 }],
          rationale: "The block shows production Kubernetes work.",
        },
        {
          requirementId: "req-2",
          status: "uncovered",
          basis: "protected-rule",
          evidence: [],
          rationale: "Not covered under the strict degree rule.",
        },
      ],
    };
    await storage.set(key, JSON.stringify(snapshot));
  } finally {
    await storage.close();
  }
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("status requirement coverage listing", () => {
  it("lists each requirement assessment from the latest critic judgement", async () => {
    const { root, runId } = await startedWorkspace();
    await attachCoverageJudgement(root, runId);
    const messages = io();

    const snapshot = await statusRun(root, runId, messages.value);

    expect(snapshot?.round).toBe(1);
    expect(
      messages.output.slice(messages.output.indexOf("Requirement coverage (round 1):")),
    ).toEqual([
      "Requirement coverage (round 1):",
      "  [covered] req-1 — critic judgement — The block shows production Kubernetes work.",
      "    evidence: block-a, block-b",
      "  [uncovered] req-2 — strict rule — Not covered under the strict degree rule.",
    ]);
    expect(messages.output.join("\n")).not.toContain("Synthetic candidate evidence");
  });

  it("leaves the status output unchanged when no critic judged coverage", async () => {
    const { root, runId } = await startedWorkspace();
    const messages = io();

    await statusRun(root, runId, messages.value);

    expect(messages.output.join("\n")).not.toContain("Requirement coverage");
    expect(messages.output.at(-1)).toMatch(/^(run |costUsd=|evaluation:|findings:)/u);
  });
});
