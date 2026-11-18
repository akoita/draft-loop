import { describe, expect, it } from "vitest";

import { createPostgresTenantDirectory, type PostgresTenantDirectory } from "./tenant-directory.js";
import { createTestSchema, runtimeRoleUrl } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const day1 = new Date("2026-11-18T10:00:00.000Z");
const day2 = new Date("2026-11-19T10:00:00.000Z");
const day3 = new Date("2026-11-20T10:00:00.000Z");

describe.runIf(connectionString !== undefined)("Postgres support assistant use", () => {
  const url = connectionString ?? "";

  async function withDirectory(work: (directory: PostgresTenantDirectory) => Promise<void>) {
    const schema = await createTestSchema(url, "support_usage");
    const directory = await createPostgresTenantDirectory({
      connectionString: runtimeRoleUrl(url),
      schema: schema.schema,
    });
    try {
      await work(directory);
    } finally {
      await directory.close();
      await schema.drop();
    }
  }

  it("counts questions per member and day, and shares them between instances", async () => {
    await withDirectory(async ({ supportUsage }) => {
      await supportUsage.countQuestion("m1", day1);
      await supportUsage.countQuestion("m1", day1);
      await supportUsage.countQuestion("m2", day1);
      await expect(supportUsage.questionsToday("m1", day1)).resolves.toBe(2);
      await expect(supportUsage.questionsToday("m2", day1)).resolves.toBe(1);
      await expect(supportUsage.questionsToday("m1", day2)).resolves.toBe(0);
    });
  });

  it("adds the day's estimated cost and starts again the next UTC day", async () => {
    await withDirectory(async ({ supportUsage }) => {
      await supportUsage.addCost(0.25, day1);
      await supportUsage.addCost(0.000125, day1);
      await supportUsage.addCost(0, day1);
      await expect(supportUsage.costTodayUsd(day1)).resolves.toBeCloseTo(0.250125, 6);
      await expect(supportUsage.costTodayUsd(day2)).resolves.toBe(0);
      await expect(supportUsage.addCost(-1, day1)).rejects.toThrow(/cost/u);
    });
  });

  it("sweeps member counts older than yesterday on the day's first question", async () => {
    await withDirectory(async ({ supportUsage }) => {
      await supportUsage.countQuestion("m1", day1);
      await supportUsage.countQuestion("m1", day2);
      await expect(supportUsage.questionsToday("m1", day1)).resolves.toBe(1);
      await supportUsage.countQuestion("m2", day3);
      await expect(supportUsage.questionsToday("m1", day1)).resolves.toBe(0);
      await expect(supportUsage.questionsToday("m1", day2)).resolves.toBe(1);
    });
  });
});
