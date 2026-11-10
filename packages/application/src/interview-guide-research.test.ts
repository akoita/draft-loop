import { describe, expect, it } from "vitest";

import {
  interviewGuideCanReuseBrief,
  interviewGuideMissingTopics,
  interviewGuideResearchPlan,
  interviewGuideResearchQueries,
  researchSourceReliability,
} from "./interview-guide-research.js";
import { type ResearchFindingsPort, runResearch } from "./research-run.js";
import { createScriptedResearchSearch } from "./research-search.js";

// An invented employer and invented pages only.
const subject = { employer: "Example Corp", role: "Data Analyst", country: "France" };
const now = new Date("2026-11-10T09:00:00.000Z");

describe("interview guide research", () => {
  it("searches three topics for an essential guide and more for an extensive one", () => {
    expect(interviewGuideResearchQueries(subject, { depth: "essential" }, now)).toEqual([
      { query: "Example Corp Data Analyst France", topic: "company", windowMonths: 12 },
      { query: "Example Corp careers Data Analyst team", topic: "role", windowMonths: 12 },
      { query: "Data Analyst trends 2026 France", topic: "field", windowMonths: 12 },
    ]);
    const extensive = interviewGuideResearchQueries(
      subject,
      { depth: "extensive", topics: ["salary"] },
      now,
    );
    expect(extensive.map((query) => query.topic)).toEqual([
      "company",
      "news",
      "role",
      "field",
      "process",
      "salary",
    ]);
    expect(extensive.find((query) => query.topic === "process")?.windowMonths).toBe(24);
    expect(extensive.find((query) => query.topic === "salary")?.query).toBe(
      "Data Analyst salary France 2026",
    );
  });

  it("rates the employer and public bodies primary, forums weak and the rest press", () => {
    const rate = (url: string) => researchSourceReliability(url, "Example Corp");
    expect(rate("https://www.examplecorp.com/careers")).toBe("primary");
    expect(rate("https://blog.example-corp.fr/post")).toBe("primary");
    expect(rate("https://www.ecb.europa.eu/press/pr.html")).toBe("primary");
    expect(rate("https://www.economie.gouv.fr/page")).toBe("primary");
    expect(rate("https://www.reddit.com/r/jobs/1")).toBe("weak");
    expect(rate("https://fr.glassdoor.ch/Avis/x")).toBe("weak");
    expect(rate("https://someone.medium.com/post")).toBe("weak");
    expect(rate("https://www.lesechos.fr/article")).toBe("press");
    expect(rate("not a url")).toBe("weak");
  });

  it("runs the plan with each query's window and ranks the sources it keeps", async () => {
    const search = createScriptedResearchSearch(
      [
        [
          {
            url: "https://news.example.net/a",
            title: "Press",
            excerpt: "Press page.",
            publishedOn: "2026-09-01",
          },
          {
            url: "https://www.examplecorp.com/about",
            title: "About",
            excerpt: "Official page.",
            publishedOn: "2026-10-01",
          },
        ],
        [
          {
            url: "https://www.reddit.com/r/x/1",
            title: "Forum",
            excerpt: "Forum page.",
            publishedOn: "2026-08-01",
          },
        ],
        [
          {
            url: "https://news.example.net/old",
            title: "Old",
            excerpt: "Old page.",
            publishedOn: "2025-01-01",
          },
        ],
      ],
      { costUsd: 0.01 },
    );
    const requests: Parameters<ResearchFindingsPort["write"]>[0][] = [];
    const plan = interviewGuideResearchPlan(subject, { depth: "essential" }, now);
    const brief = await runResearch({
      workspaceId: "owner",
      applicationId: "app_fixture0001",
      subject,
      plan,
      maxCostUsd: plan.maxCostUsd,
      search,
      screen: async () => true,
      findings: {
        write: async (request) => {
          requests.push(request);
          return { findings: [], model: { provider: "anthropic", model: "claude-haiku-5-5" } };
        },
      },
      findingsSpentUsd: () => 0,
      newId: () => "rbr_fixture0001",
      now: () => now,
    });

    expect(search.requests.map((request) => request.fromDate)).toEqual([
      "2025-11-10",
      "2025-11-10",
      "2025-11-10",
    ]);
    expect(brief.dropped).toEqual({ flagged: 0, outdated: 1 });
    expect(brief.queries).toHaveLength(3);
    expect(brief.from_date).toBe("2025-11-10");
    expect(brief.sources.map((source) => [source.title, source.topic, source.reliability])).toEqual(
      [
        ["About", "company", "primary"],
        ["Press", "company", "press"],
        ["Forum", "role", "weak"],
      ],
    );
    expect(requests[0]?.sources.map((source) => source.reliability)).toEqual([
      "primary",
      "press",
      "weak",
    ]);
  });

  it("names the topics a brief lacks and reuses only a recent, complete brief", () => {
    const brief = {
      created_at: "2026-11-05T09:00:00.000Z",
      sources: [
        { topic: "company" as const },
        { topic: "role" as const },
        { topic: "field" as const },
      ],
    } as Parameters<typeof interviewGuideCanReuseBrief>[0];
    expect(interviewGuideMissingTopics(brief, { depth: "essential" })).toEqual([]);
    expect(interviewGuideMissingTopics(brief, { depth: "extensive" })).toEqual(["news", "process"]);
    expect(interviewGuideMissingTopics(undefined, { depth: "essential" })).toEqual([
      "company",
      "role",
      "field",
    ]);
    expect(interviewGuideCanReuseBrief(brief, { depth: "essential" }, now)).toBe(true);
    expect(interviewGuideCanReuseBrief(brief, { depth: "extensive" }, now)).toBe(false);
    expect(
      interviewGuideCanReuseBrief(brief, { depth: "essential" }, new Date("2026-12-10T00:00:00Z")),
    ).toBe(false);
  });
});
