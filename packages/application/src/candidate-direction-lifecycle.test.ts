import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSqliteStorage } from "@draft-loop/storage";
import { describe, expect, it } from "vitest";

import { CliUserError } from "./cli-user-error.js";
import { createLocalApplicationDriver } from "./local.js";

const silent = { write: () => undefined };

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "draft-loop-direction-"));
  await mkdir(join(root, "evidence"));
  await writeFile(join(root, "job.md"), "TypeScript engineer");
  await writeFile(join(root, "evidence", "resume.md"), "Built TypeScript tools.");
  await createLocalApplicationDriver().initialize(
    { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true, maxRounds: 3 },
    silent,
  );
  return root;
}

describe("Request revision with directions for the author", () => {
  it("stores the direction on the run and records it as a decision for the round", async () => {
    const root = await workspace();
    try {
      const driver = createLocalApplicationDriver();
      const started = await driver.start({ root, allowProviderData: false }, silent);
      const revising = await driver.lifecycle(
        {
          root,
          runId: started.runId,
          action: "revision",
          candidateDirection: "  Lead with tokenisation.  ",
        },
        silent,
      );
      expect(revising.candidateDirection).toMatchObject({
        round: started.round + 1,
        text: "Lead with tokenisation.",
      });

      const storage = await openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
      try {
        const decision = (await storage.listDecisions(started.runId)).find((record) =>
          JSON.stringify(record.payload).includes('"action":"revision"'),
        );
        expect(decision?.payload).toMatchObject({
          candidateDirection: "Lead with tokenisation.",
          candidateDirectionRound: started.round + 1,
        });
        expect(decision?.createdAt).toBeTruthy();
      } finally {
        await storage.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("changes nothing without directions and refuses an oversized direction", async () => {
    const root = await workspace();
    try {
      const driver = createLocalApplicationDriver();
      const started = await driver.start({ root, allowProviderData: false }, silent);
      await expect(
        driver.lifecycle(
          {
            root,
            runId: started.runId,
            action: "revision",
            candidateDirection: "x".repeat(1_001),
          },
          silent,
        ),
      ).rejects.toBeInstanceOf(CliUserError);
      const revising = await driver.lifecycle(
        { root, runId: started.runId, action: "revision" },
        silent,
      );
      expect(revising).not.toHaveProperty("candidateDirection");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
