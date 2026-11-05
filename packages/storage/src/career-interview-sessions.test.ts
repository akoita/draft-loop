import type { CareerInterviewSession } from "@draft-loop/schemas/career-interview";
import { describe, expect, it } from "vitest";

import {
  createMemoryCareerInterviewSessionStore,
  requireCareerInterviewSession,
} from "./career-interview-sessions.js";

// Invented topics and answers only.
function session(
  id: string,
  overrides: Partial<CareerInterviewSession> = {},
): CareerInterviewSession {
  return requireCareerInterviewSession({
    id,
    workspace_id: "owner",
    status: "open",
    topics: [
      {
        key: "untold-period:2016-2017:abcd1234",
        kind: "untold-period",
        reason: "Your record says nothing between 2016 and 2017.",
        status: "open",
        turns: [
          {
            role: "interviewer",
            text: "Would you like to talk about that period?",
            at: "2026-11-05T09:00:00.000Z",
          },
          { role: "candidate", text: "", mark: "skipped", at: "2026-11-05T09:01:00.000Z" },
        ],
      },
    ],
    created_at: "2026-11-05T09:00:00.000Z",
    updated_at: "2026-11-05T09:01:00.000Z",
    ...overrides,
  });
}

describe("career interview sessions in memory", () => {
  it("inserts, resumes, replaces and lists a workspace's sessions", async () => {
    const store = createMemoryCareerInterviewSessionStore();
    const first = session("cis_fixture0001");
    await store.insert(first);
    await expect(store.insert(first)).rejects.toMatchObject({ code: "duplicate_session" });
    expect(await store.get("owner", first.id)).toEqual(first);
    expect(await store.get("other", first.id)).toBeUndefined();
    expect(await store.latestUnfinished("owner")).toEqual(first);

    await store.replace({
      ...first,
      status: "closed",
      created_at: "2030-01-01T00:00:00.000Z",
      updated_at: "2030-01-02T00:00:00.000Z",
    });
    expect(await store.get("owner", first.id)).toMatchObject({
      status: "closed",
      created_at: "2026-11-05T09:00:00.000Z",
    });
    expect(await store.latestUnfinished("owner")).toBeUndefined();
    await expect(store.replace({ ...first, workspace_id: "other" })).rejects.toMatchObject({
      code: "session_not_found",
    });

    const second = session("cis_fixture0002", {
      status: "paused",
      created_at: "2026-11-06T09:00:00.000Z",
      updated_at: "2026-11-06T09:00:00.000Z",
    });
    await store.insert(second);
    expect((await store.list("owner", 10)).map((entry) => entry.id)).toEqual([
      "cis_fixture0002",
      "cis_fixture0001",
    ]);
    expect(await store.latestUnfinished("owner")).toEqual(second);
  });

  it("collects declined topic keys across sessions", async () => {
    const store = createMemoryCareerInterviewSessionStore();
    const declined = session("cis_fixture0003");
    await store.insert({
      ...declined,
      topics: declined.topics.map((topic) => ({ ...topic, status: "declined" })),
    });
    await store.insert(session("cis_fixture0004"));
    expect([...(await store.declinedTopicKeys("owner"))]).toEqual([
      "untold-period:2016-2017:abcd1234",
    ]);
    expect([...(await store.declinedTopicKeys("other"))]).toEqual([]);
  });

  it("refuses an invalid session", async () => {
    const store = createMemoryCareerInterviewSessionStore();
    await expect(store.insert({ ...session("cis_fixture0005"), id: "bad" })).rejects.toMatchObject({
      code: "invalid_session",
    });
  });
});
