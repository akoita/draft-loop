import type { CareerInterviewerPort, CareerInterviewerRequest } from "@draft-loop/orchestrator";
import type { CareerInterviewSessionTopic } from "@draft-loop/schemas/career-interview";
import { createMemoryCareerInterviewSessionStore } from "@draft-loop/storage/career-interview-sessions";
import { describe, expect, it } from "vitest";

import {
  type CareerInterviewPublishInput,
  careerInterviewConflicts,
  careerInterviewSourceRules,
  createCareerInterviewPublisher,
  renderCareerInterviewMarkdown,
} from "./career-interview-evidence.js";
import { createCareerInterviewService } from "./career-interview-service.js";
import type { CareerInterviewFact } from "./career-interview-topics.js";

// An invented record: one role with dates but no outcome, and a never-share entry.
const facts: CareerInterviewFact[] = [
  { id: "t", category: "role", subjectId: "job", field: "title", value: "Analyst" },
  { id: "e", category: "employer", subjectId: "job", field: "name", value: "Example Bank" },
  { id: "d", category: "date", subjectId: "job", field: "dates", value: "2019 to 2022" },
  { id: "s", category: "role", subjectId: "job", field: "scope", value: "Secret client list" },
];

function harness(replies: readonly { text: string; summary?: string }[]) {
  const store = createMemoryCareerInterviewSessionStore();
  const requests: CareerInterviewerRequest[] = [];
  const published: CareerInterviewPublishInput[] = [];
  const port: CareerInterviewerPort = {
    reply: async (request) => {
      requests.push(request);
      const reply = replies[requests.length - 1] ?? { text: "What else happened?" };
      return { ...reply, model: { provider: "anthropic", model: "scripted" } };
    },
  };
  let clock = 0;
  let ids = 0;
  const service = createCareerInterviewService({
    store,
    loadRecord: async () => ({
      facts,
      requirements: [],
      mayTransmit: (fact) => fact.id !== "s",
    }),
    interviewer: () => port,
    publish: async (input) => {
      published.push(input);
      return { sourceId: `source-${published.length}`, status: "created" };
    },
    now: () => new Date(Date.UTC(2026, 10, 5, 9, 0, clock++)).toISOString(),
    newId: () => `cis_fixture000${++ids}`,
  });
  return { service, store, requests, published };
}

describe("career interview service", () => {
  it("proposes, discusses, summarises and confirms a topic into evidence", async () => {
    const { service, requests, published } = harness([
      { text: "What did a typical week look like?" },
      { text: "Who used that work?" },
      {
        text: "Here is what I noted. Is it right?",
        summary: "From 2019 you built the bank's loan reports.",
      },
    ]);
    const session = await service.start("owner");
    expect(session.topics.map((topic) => topic.kind)).toEqual(["role-gap"]);
    // The screen words the reason from what the role leaves out (#2418).
    expect(session.topics[0]?.missing?.length).toBeGreaterThan(0);
    const key = session.topics[0]?.key ?? "";

    const opened = await service.accept("owner", session.id, key);
    expect(opened.topics[0]).toMatchObject({ status: "open" });
    expect(opened.topics[0]?.turns.at(-1)?.text).toBe("What did a typical week look like?");
    expect(requests[0]?.topic.context.join(" ")).not.toContain("Secret client list");
    expect(opened.model).toEqual({ provider: "anthropic", model: "scripted" });

    await service.answer("owner", session.id, key, { mark: "unknown" });
    const summarised = await service.answer("owner", session.id, key, { mark: "skipped" });
    expect(summarised.topics[0]).toMatchObject({
      status: "summarised",
      summary: "From 2019 you built the bank's loan reports.",
    });
    expect(await service.conflicts("owner", session.id, key)).toEqual([]);

    const { session: confirmed, published: result } = await service.confirm(
      "owner",
      session.id,
      key,
      { knowledgeBaseId: "kb-1", tier: "normal", summary: "From 2019 I built loan reports." },
    );
    expect(result).toEqual({ sourceId: "source-1", status: "created" });
    expect(confirmed.topics[0]).toMatchObject({
      status: "closed",
      summary: "From 2019 I built loan reports.",
    });
    expect(published[0]).toMatchObject({ knowledgeBaseId: "kb-1", tier: "normal", topicIndex: 0 });
  });

  it("resumes the unfinished session and remembers a declined topic in the next one", async () => {
    const { service } = harness([]);
    const first = await service.start("owner");
    await service.pause("owner", first.id);
    const resumed = await service.start("owner");
    expect(resumed).toMatchObject({ id: first.id, status: "open" });

    await service.decline("owner", first.id, first.topics[0]?.key ?? "");
    await service.close("owner", first.id);
    const later = await service.start("owner");
    expect(later.id).not.toBe(first.id);
    expect(later.topics).toEqual([]);
  });

  it("lets the candidate bring an own subject and refuses answers on a closed topic", async () => {
    const { service } = harness([{ text: "What made it memorable?" }]);
    const session = await service.start("owner");
    const withOwn = await service.ownSubject("owner", session.id, "a hackathon win");
    const own = withOwn.topics.at(-1);
    expect(own).toMatchObject({ kind: "candidate-subject", status: "open" });
    expect(own?.title).toBe("a hackathon win");
    await service.setAside("owner", session.id, own?.key ?? "");
    await expect(
      service.answer("owner", session.id, own?.key ?? "", { text: "More words" }),
    ).rejects.toMatchObject({ code: "topic_not_open" });
    await expect(
      service.confirm("owner", session.id, own?.key ?? "", {
        knowledgeBaseId: "kb-1",
        tier: "normal",
      }),
    ).rejects.toMatchObject({ code: "topic_not_summarised" });
  });

  it("gives an own subject the record facts it names, minus the withheld ones", async () => {
    const { service, requests } = harness([{ text: "What did you do there?" }]);
    const session = await service.start("owner");
    const withOwn = await service.ownSubject("owner", session.id, "My years at Example Bank");
    expect(withOwn.topics.at(-1)?.fact_ids).toEqual(["e"]);
    expect(requests.at(-1)?.topic.context.join(" ")).toContain("Example Bank");
  });

  it("shows a summary year outside the role's dates as a conflict without changing the record", () => {
    expect(careerInterviewConflicts("I joined in 2017 and left in 2021.", facts)).toEqual([
      { kind: "date", summaryValue: "2017", factId: "d", factValue: "2019 to 2022" },
    ]);
    expect(facts[2]?.value).toBe("2019 to 2022");
  });
});

describe("career interview evidence", () => {
  const session = { id: "cis_fixture0001" };
  const topic = {
    key: "role-gap:job:abcd",
    kind: "role-gap",
    reason: "Your record names Analyst but not what changed.",
    status: "closed",
    fact_ids: [],
    requirement_ids: [],
    summary: "I built *loan* reports.",
    turns: [
      { role: "interviewer", text: "What changed?", at: "2026-11-05T09:00:00.000Z" },
      { role: "candidate", text: "I built loan reports.", at: "2026-11-05T09:01:00.000Z" },
      { role: "candidate", text: "", mark: "skipped", at: "2026-11-05T09:02:00.000Z" },
    ],
  } satisfies CareerInterviewSessionTopic as CareerInterviewSessionTopic;

  it("renders the confirmed summary and the speaker-labelled words as plain Markdown", () => {
    const markdown = renderCareerInterviewMarkdown(session, 0, topic);
    expect(markdown).toContain("# Career interview cis_fixture0001 topic 1");
    expect(markdown).toContain("I built \\*loan\\* reports.");
    expect(markdown).toContain("- Candidate: I built loan reports.");
    expect(markdown).toContain("- Interviewer: What changed?");
    expect(markdown).toContain("- Candidate: (skipped this question)");
    expect(renderCareerInterviewMarkdown(session, 0, topic)).toBe(markdown);
  });

  it("keeps skipped and unknown answers in order, so each answer stays with its question", () => {
    const marked = {
      ...topic,
      turns: [
        { role: "interviewer", text: "Which tools?", at: "2026-11-05T09:00:00.000Z" },
        { role: "candidate", text: "", mark: "unknown", at: "2026-11-05T09:01:00.000Z" },
        { role: "interviewer", text: "What changed?", at: "2026-11-05T09:02:00.000Z" },
        { role: "candidate", text: "I built loan reports.", at: "2026-11-05T09:03:00.000Z" },
      ],
    } as CareerInterviewSessionTopic;
    expect(renderCareerInterviewMarkdown(session, 0, marked)).toContain(
      [
        "- Interviewer: Which tools?",
        "- Candidate: (said they did not know)",
        "- Interviewer: What changed?",
        "- Candidate: I built loan reports.",
      ].join("\n"),
    );
  });

  it("renders a topic of only marked answers without inventing words", () => {
    const onlyMarked = {
      ...topic,
      turns: [{ role: "candidate", text: "", mark: "skipped", at: "2026-11-05T09:00:00.000Z" }],
    } as CareerInterviewSessionTopic;
    const markdown = renderCareerInterviewMarkdown(session, 0, onlyMarked);
    expect(markdown).toContain("## Conversation\n\n- Candidate: (skipped this question)\n");
    expect(markdown).not.toContain("No words recorded.");
  });

  it("publishes once with the tier rule first and the transcript evidence kind", async () => {
    const calls: string[] = [];
    const rules: string[] = [];
    let sources = 0;
    const publish = createCareerInterviewPublisher({
      intake: {
        addFileSource: async () => {
          calls.push("add");
          sources += 1;
          return {
            created: sources === 1,
            source: { id: "source-1" },
          } as never;
        },
      },
      rules: {
        list: async () => ({ rules: rules.map((id) => ({ id })) }) as never,
        add: async (_kb, _rule, id) => {
          calls.push("rule");
          rules.push(id ?? "");
          return undefined as never;
        },
      },
      setEvidenceKind: async (_kb, _source, kind) => {
        calls.push(`kind:${kind}`);
      },
    });
    const input = {
      session: {
        id: "cis_fixture0001",
        workspace_id: "owner",
        status: "open" as const,
        topics: [topic],
        created_at: "2026-11-05T09:00:00.000Z",
        updated_at: "2026-11-05T09:00:00.000Z",
      },
      topicIndex: 0,
      knowledgeBaseId: "kb-1",
      tier: "sensitive" as const,
    };
    expect(await publish(input)).toEqual({ sourceId: "source-1", status: "created" });
    expect(await publish(input)).toEqual({ sourceId: "source-1", status: "already-present" });
    expect(calls).toEqual(["rule", "add", "kind:transcript", "add"]);
    expect(careerInterviewSourceRules(session, 0, "normal")).toEqual([]);
  });
});
