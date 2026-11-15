import { type CareerInterviewerPort, careerInterviewProposal } from "@draft-loop/orchestrator";
import { createMemoryCareerInterviewSessionStore } from "@draft-loop/storage/career-interview-sessions";
import { describe, expect, it } from "vitest";

import { createCareerInterviewService } from "./career-interview-service.js";
import {
  type CareerInterviewFact,
  careerStartTopicKey,
  findCareerInterviewTopics,
} from "./career-interview-topics.js";

/** A first conversation on a record with no fact (#2732). */
function harness(facts: readonly CareerInterviewFact[] = []) {
  const kinds: string[] = [];
  const port: CareerInterviewerPort = {
    reply: async (request) => {
      kinds.push(request.topic.kind);
      return request.closing
        ? {
            text: "Here is what I noted. Is it right?",
            summary: "I was a route planner.",
            model: { provider: "anthropic", model: "scripted" },
          }
        : {
            text: "Where did you work most recently?",
            model: { provider: "anthropic", model: "scripted" },
          };
    },
  };
  let clock = 0;
  let ids = 0;
  const service = createCareerInterviewService({
    store: createMemoryCareerInterviewSessionStore(),
    loadRecord: async () => ({ facts, requirements: [], mayTransmit: () => true }),
    interviewer: () => port,
    publish: async () => ({ sourceId: "source-1", status: "created" }),
    now: () => new Date(Date.UTC(2026, 10, 15, 9, 0, clock++)).toISOString(),
    newId: () => `cis_fixture000${++ids}`,
  });
  return { service, kinds };
}

describe("career interview starting topics", () => {
  it("offers the four starting topics, in order, for a record with no fact", () => {
    const topics = findCareerInterviewTopics({
      facts: [],
      // A job post's themes wait until there is a record to compare them with.
      requirements: [{ id: "r", applicationId: "a", text: "Kubernetes", priority: "critical" }],
    });
    expect(topics.map((topic) => topic.title)).toEqual([
      "work history",
      "education",
      "skills",
      "proud of",
    ]);
    expect(topics.every((topic) => topic.kind === "career-start")).toBe(true);
    expect(topics[0]?.key).toBe("career-start:work-history");
  });

  it("leaves out a declined starting topic and stops once the record has a fact", () => {
    const declined = [careerStartTopicKey("education")];
    const left = findCareerInterviewTopics({ facts: [], declinedTopicKeys: declined });
    expect(left.map((topic) => topic.title)).toEqual(["work history", "skills", "proud of"]);

    const withFact = findCareerInterviewTopics({
      facts: [{ id: "s", category: "skill", field: "name", value: "Route planning" }],
    });
    expect(withFact.some((topic) => topic.kind === "career-start")).toBe(false);
  });

  it("opens a session with all four and words the offer without listing reasons", async () => {
    const { service } = harness();
    const session = await service.start("owner");
    expect(session.topics).toHaveLength(4);
    expect(careerInterviewProposal(session.topics)).toContain("Your record is empty");
  });

  it("does not offer again a starting topic already told, while the profile is still empty", async () => {
    const { service, kinds } = harness();
    const first = await service.start("owner");
    const key = careerStartTopicKey("work history");
    await service.accept("owner", first.id, key);
    expect(kinds).toEqual(["career-start"]);
    await service.answer("owner", first.id, key, { mark: "unknown" });
    await service.answer("owner", first.id, key, { mark: "skipped" });
    await service.confirm("owner", first.id, key, { knowledgeBaseId: "kb-1", tier: "normal" });
    await service.close("owner", first.id);

    const second = await service.start("owner");
    expect(second.topics.map((topic) => topic.title)).toEqual(["education", "skills", "proud of"]);
  });

  it("keeps two topics per proposal for a record with facts", async () => {
    const { service } = harness([
      { id: "t", category: "role", subjectId: "job", field: "title", value: "Analyst" },
    ]);
    const session = await service.start("owner");
    expect(session.topics.every((topic) => topic.kind !== "career-start")).toBe(true);
    expect(session.topics.length).toBeLessThanOrEqual(2);
  });
});
