import { describe, expect, it } from "vitest";

import { createPostgresTenantDirectory, type PostgresTenantDirectory } from "./tenant-directory.js";
import { createTestSchema, runtimeRoleUrl } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const day1 = new Date("2026-11-18T10:00:00.000Z");
const day2 = new Date("2026-11-19T10:00:00.000Z");
const day3 = new Date("2026-11-20T10:00:00.000Z");

describe.runIf(connectionString !== undefined)("Postgres live voice use", () => {
  const url = connectionString ?? "";

  async function withDirectory(work: (directory: PostgresTenantDirectory) => Promise<void>) {
    const schema = await createTestSchema(url, "live_voice_usage");
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

  it("adds whole seconds per member and day", async () => {
    await withDirectory(async ({ liveVoiceUsage }) => {
      await liveVoiceUsage.addSeconds("m1", 60, day1);
      await liveVoiceUsage.addSeconds("m1", 0.2, day1);
      await liveVoiceUsage.addSeconds("m1", 0, day1);
      await liveVoiceUsage.addSeconds("m2", 30, day1);
      await expect(liveVoiceUsage.secondsToday("m1", day1)).resolves.toBe(61);
      await expect(liveVoiceUsage.secondsToday("m2", day1)).resolves.toBe(30);
      await expect(liveVoiceUsage.secondsToday("m1", day2)).resolves.toBe(0);
      await expect(liveVoiceUsage.addSeconds("m1", -1, day1)).rejects.toThrow(/Seconds/u);
    });
  });

  it("sweeps rows older than yesterday on the day's first add", async () => {
    await withDirectory(async ({ liveVoiceUsage }) => {
      await liveVoiceUsage.addSeconds("m1", 10, day1);
      await liveVoiceUsage.addSeconds("m1", 20, day2);
      await liveVoiceUsage.addSeconds("m2", 5, day3);
      await expect(liveVoiceUsage.secondsToday("m1", day1)).resolves.toBe(0);
      await expect(liveVoiceUsage.secondsToday("m1", day2)).resolves.toBe(20);
    });
  });
});
