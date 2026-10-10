import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSqliteStorage } from "@draft-loop/storage";
import { describe, expect, it } from "vitest";

import { createLocalApplicationDriver } from "./local.js";

const silent = { write: () => undefined };

describe("review decisions while the author revises", () => {
  it("saves a finding decision against the latest saved round", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-decision-round-"));
    try {
      await mkdir(join(root, "evidence"));
      await writeFile(join(root, "job.md"), "TypeScript engineer");
      await writeFile(join(root, "evidence", "resume.md"), "Built TypeScript tools.");
      const driver = createLocalApplicationDriver();
      await driver.initialize(
        { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true, maxRounds: 3 },
        silent,
      );
      const started = await driver.start({ root, allowProviderData: false }, silent);
      // Round 2 opens before its draft exists, so it has no saved round yet.
      const revising = await driver.lifecycle(
        { root, runId: started.runId, action: "revision" },
        silent,
      );
      expect(revising).toMatchObject({ state: "revising", round: started.round + 1 });

      await driver.recordReviewDecision({
        root,
        runId: started.runId,
        kind: "finding",
        targetId: `${started.runId}:finding:scope:0:review-warning`,
        decision: "accepted",
      });

      const storage = await openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
      try {
        const decisions = (await storage.listDecisions(started.runId)).filter(
          (decision) => decision.actor === "user:desktop",
        );
        expect(decisions.map((decision) => decision.roundId)).toEqual([
          `${started.runId}:round:${started.round}`,
        ]);
      } finally {
        await storage.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
