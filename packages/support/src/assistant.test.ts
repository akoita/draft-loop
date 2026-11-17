import { helpGuide } from "@draft-loop/user-guide";
import { describe, expect, it } from "vitest";

import {
  createSupportAssistant,
  type SupportAssistantOptions,
  type SupportQuestion,
  supportSystemPrompt,
} from "./assistant.js";
import { supportGoldenSet } from "./golden-set.js";
import { rankGuideSections } from "./guide-search.js";
import type {
  SupportAccountPort,
  SupportAuditEvent,
  SupportModelRequest,
  SupportUsageEntry,
} from "./ports.js";

type StepOutput = Record<string, unknown>;

function toolStep(
  tool: string,
  fields: Partial<Record<"query" | "run_id" | "summary", string>> = {},
) {
  return { step: "tool", tool, query: null, run_id: null, summary: null, ...fields };
}

function answerStep(answer: string, sectionIds: string[], outcome = "answered"): StepOutput {
  return { step: "answer", answer, section_ids: sectionIds, outcome };
}

const account: SupportAccountPort = {
  accountSummary: async () => ({
    plan: "individual",
    credits: 3,
    counters: [{ name: "prepare_runs", used: 4, limit: 20 }],
  }),
  recentRuns: async () => [
    {
      run_id: "run_1",
      application_id: "app_1",
      state: "failed",
      error_code: "provider-overloaded",
      recoverable: true,
      wait_seconds: 120,
      updated_at: "2026-11-17T10:00:00Z",
    },
  ],
  runStatus: async (runId) =>
    runId === "run_1"
      ? {
          run_id: "run_1",
          application_id: "app_1",
          state: "failed",
          error_code: "provider-overloaded",
          recoverable: true,
          wait_seconds: 120,
          updated_at: "2026-11-17T10:00:00Z",
        }
      : null,
  serviceStatus: async () => ({ state: "operational", codes: [] }),
};

/** A fake model that plays the scripted steps, or computes each from the request. */
function harness(
  script: readonly (StepOutput | ((request: SupportModelRequest) => StepOutput))[],
  overrides: Partial<SupportAssistantOptions> & { today?: number; costToday?: number } = {},
) {
  const requests: SupportModelRequest[] = [];
  const recorded: SupportUsageEntry[] = [];
  const audit: SupportAuditEvent[] = [];
  const counted: string[] = [];
  let index = 0;
  const assistant = createSupportAssistant({
    model: async (request) => {
      requests.push(request);
      const next = script[index];
      index += 1;
      if (next === undefined) throw new Error("script exhausted");
      return {
        output: typeof next === "function" ? next(request) : next,
        modelId: "claude-haiku-5-5",
        inputTokens: 1000,
        outputTokens: 80,
        estimatedUsd: 0.002,
      };
    },
    account,
    usage: {
      questionsToday: async () => overrides.today ?? 0,
      costTodayUsd: async () => overrides.costToday ?? 0,
      countQuestion: async (memberId) => {
        counted.push(memberId);
      },
      record: async (entry) => {
        recorded.push(entry);
      },
    },
    onAudit: (event) => audit.push(event),
    now: () => "2026-11-17T12:00:00Z",
    ...overrides,
  });
  return { assistant, requests, recorded, audit, counted };
}

function ask(question: string, language: "en" | "fr" = "en"): SupportQuestion {
  return { memberId: "member_1", conversationId: "conv_1", language, question };
}

describe("the support assistant (#2882)", () => {
  it("answers from the guide with the sections it used", async () => {
    const { assistant, requests, recorded, audit, counted } = harness([
      toolStep("search_guide", { query: "export pdf" }),
      answerStep("Approve the draft, then select Export and pick PDF.", ["review", "review"]),
    ]);

    const reply = await assistant.answer(ask("How do I get a PDF?"));

    expect(reply).toEqual({
      mode: "assistant",
      outcome: "answered",
      text: "Approve the draft, then select Export and pick PDF.",
      sections: [{ id: "review", title: "Review and export" }],
      ticketId: null,
    });
    expect(requests).toHaveLength(2);
    const second = requests[1]?.input as {
      tool_results: { tool: string; result: { id: string }[] }[];
    };
    expect(second.tool_results[0]?.tool).toBe("search_guide");
    expect(second.tool_results[0]?.result[0]?.id).toBe("review");
    expect(recorded).toHaveLength(2);
    expect(counted).toEqual(["member_1"]);
    expect(audit).toEqual([
      {
        kind: "tool",
        conversationId: "conv_1",
        tool: "search_guide",
        status: "ok",
        at: "2026-11-17T12:00:00Z",
      },
      {
        kind: "reply",
        conversationId: "conv_1",
        mode: "assistant",
        result: "answered",
        modelCalls: 2,
        estimatedUsd: 0.004,
        at: "2026-11-17T12:00:00Z",
      },
    ]);
  });

  it("reads the member's account, runs and the service status through the bound port", async () => {
    const { assistant, requests, audit } = harness([
      toolStep("get_account_summary"),
      toolStep("list_recent_runs"),
      toolStep("get_run_status", { run_id: "run_other" }),
      answerStep("Your last run hit a busy model and retries in two minutes.", ["problems"]),
    ]);

    const reply = await assistant.answer(ask("Why did my run fail?"));

    expect(reply).toMatchObject({ mode: "assistant", outcome: "answered" });
    const last = requests[3]?.input as { tool_results: { tool: string; result: unknown }[] };
    expect(last.tool_results.map((result) => result.tool)).toEqual([
      "get_account_summary",
      "list_recent_runs",
      "get_run_status",
    ]);
    expect(last.tool_results[0]?.result).toMatchObject({ plan: "individual", credits: 3 });
    expect(last.tool_results[1]?.result).toMatchObject([
      { error_code: "provider-overloaded", recoverable: true },
    ]);
    expect(last.tool_results[2]?.result).toEqual({ error: "run_not_found" });
    expect(audit.filter((event) => event.kind === "tool").map((event) => event.status)).toEqual([
      "ok",
      "ok",
      "not-found",
    ]);
  });

  it("reports the service status", async () => {
    const { assistant, requests } = harness([
      toolStep("get_service_status"),
      answerStep("DraftLoop is running normally.", ["problems"]),
    ]);
    await assistant.answer(ask("Is DraftLoop down?"));
    const last = requests[1]?.input as { tool_results: { result: unknown }[] };
    expect(last.tool_results[0]?.result).toEqual({ state: "operational", codes: [] });
  });

  it("turns a failing tool into an error code the model can read", async () => {
    const { assistant, requests, audit } = harness(
      [toolStep("get_account_summary"), answerStep("I could not read your plan.", ["credits"])],
      {
        account: {
          ...account,
          accountSummary: async () => {
            throw new Error("database down");
          },
        },
      },
    );
    const reply = await assistant.answer(ask("How many credits do I have?"));
    expect(reply).toMatchObject({ mode: "assistant" });
    const last = requests[1]?.input as { tool_results: { result: unknown }[] };
    expect(last.tool_results[0]?.result).toEqual({ error: "tool_failed" });
    expect(audit[0]).toMatchObject({ kind: "tool", status: "failed" });
  });

  it("opens one handoff ticket when a port is given, and none without it", async () => {
    const opened: { conversationId: string; summary: string }[] = [];
    const withPort = harness(
      [
        toolStep("open_handoff", { summary: "Member was charged twice for a credit pack." }),
        toolStep("open_handoff", { summary: "again" }),
        answerStep("A person will reply by email.", ["credits"], "needs_person"),
      ],
      {
        handoff: {
          open: async (input) => {
            opened.push(input);
            return { ticket_id: "tkt_1" };
          },
        },
      },
    );
    const reply = await withPort.assistant.answer(ask("I was charged twice, I want a person."));
    expect(reply).toMatchObject({ mode: "assistant", outcome: "needs_person", ticketId: "tkt_1" });
    expect(opened).toEqual([
      { conversationId: "conv_1", summary: "Member was charged twice for a credit pack." },
    ]);
    expect(withPort.requests[0]?.systemPrompt).toContain("call open_handoff");

    const without = harness([
      toolStep("open_handoff", { summary: "x" }),
      answerStep("Use Send feedback in the header.", ["problems"], "needs_person"),
    ]);
    const plain = await without.assistant.answer(ask("I want a person."));
    expect(plain).toMatchObject({ outcome: "needs_person", ticketId: null });
    expect(without.audit[0]).toMatchObject({ tool: "open_handoff", status: "not-offered" });
    expect(without.requests[0]?.systemPrompt).toContain("Send feedback");
  });

  it("passes a refusal through without calling a tool", async () => {
    const { assistant, requests, audit } = harness([
      answerStep("I only help with using DraftLoop.", [], "refused"),
    ]);
    const reply = await assistant.answer(ask("Rewrite my CV summary so it sounds senior."));
    expect(reply).toEqual({
      mode: "assistant",
      outcome: "refused",
      text: "I only help with using DraftLoop.",
      sections: [],
      ticketId: null,
    });
    expect(requests).toHaveLength(1);
    expect(audit.filter((event) => event.kind === "tool")).toHaveLength(0);
  });

  it("tells the model to refuse CV content and off-topic requests, in the member's language", () => {
    const english = supportSystemPrompt("en", false);
    expect(english).toContain("Never write, rewrite, review or judge a CV");
    expect(english).toContain("Refuse anything else with outcome refused");
    expect(english).toContain("Answer in English");
    expect(english).toContain("## Review and export");

    const french = supportSystemPrompt("fr", true);
    expect(french).toContain("Answer in French");
    expect(french).toContain("## Relire et exporter");
    // The same text for every member in a language, so the route can cache it.
    expect(supportSystemPrompt("fr", true)).toBe(french);
  });

  it("sends the last six turns of history and never the member's id", async () => {
    const { assistant, requests } = harness([answerStep("Yes.", ["job"])]);
    await assistant.answer({
      ...ask("And from a link?"),
      history: Array.from({ length: 8 }, (_, index) => ({
        role: index % 2 === 0 ? ("member" as const) : ("assistant" as const),
        text: `turn ${index}`,
      })),
    });
    const input = requests[0]?.input as { history: { text: string }[] };
    expect(input.history.map((turn) => turn.text)).toEqual([
      "turn 2",
      "turn 3",
      "turn 4",
      "turn 5",
      "turn 6",
      "turn 7",
    ]);
    expect(JSON.stringify(requests[0])).not.toContain("member_1");
  });
});

describe("the support assistant's limits (#2882)", () => {
  it("falls back to guide search when switched off, without a model call", async () => {
    const { assistant, requests, audit } = harness([], { limits: { enabled: false } });
    const reply = await assistant.answer(ask("How do I export a PDF?"));
    expect(reply).toMatchObject({ mode: "guide_search", reason: "disabled" });
    expect(reply.sections[0]?.id).toBe("review");
    expect(requests).toHaveLength(0);
    expect(audit).toEqual([
      expect.objectContaining({
        kind: "reply",
        mode: "guide_search",
        result: "disabled",
        modelCalls: 0,
      }),
    ]);
  });

  it("falls back at the member's daily limit and at the global cost cap", async () => {
    const member = harness([], { today: 20 });
    expect(await member.assistant.answer(ask("credits"))).toMatchObject({
      mode: "guide_search",
      reason: "member_limit",
    });
    const global = harness([], { costToday: 2 });
    expect(await global.assistant.answer(ask("credits"))).toMatchObject({
      mode: "guide_search",
      reason: "cost_cap",
    });
    expect(member.requests).toHaveLength(0);
    expect(global.requests).toHaveLength(0);
  });

  it("falls back on a question over the length bound", async () => {
    const { assistant, requests } = harness([]);
    const reply = await assistant.answer(ask("x".repeat(1001)));
    expect(reply).toMatchObject({ mode: "guide_search", reason: "question_too_long" });
    expect(requests).toHaveLength(0);
  });

  it("falls back when the model fails or answers outside the schema", async () => {
    const failing = harness([]);
    expect(await failing.assistant.answer(ask("How do I add a job?"))).toMatchObject({
      mode: "guide_search",
      reason: "model_failed",
    });
    const invalid = harness([{ step: "answer", answer: "", section_ids: [], outcome: "answered" }]);
    const reply = await invalid.assistant.answer(ask("How do I add a job?"));
    expect(reply).toMatchObject({ mode: "guide_search", reason: "model_failed" });
    expect(reply.sections[0]?.id).toBe("job");
  });

  it("falls back when the model keeps calling tools past the step limit", async () => {
    const { assistant, requests } = harness(
      Array.from({ length: 5 }, () => toolStep("search_guide", { query: "credits" })),
    );
    const reply = await assistant.answer(ask("credits"));
    expect(reply).toMatchObject({ mode: "guide_search", reason: "no_answer" });
    expect(requests).toHaveLength(4);
    expect(requests.every((request) => request.maxOutputTokens === 600)).toBe(true);
  });
});

describe("the support golden set (#2882)", () => {
  it("has about forty questions in both languages, refusals included", () => {
    expect(supportGoldenSet.length).toBeGreaterThanOrEqual(38);
    expect(new Set(supportGoldenSet.map((item) => item.id)).size).toBe(supportGoldenSet.length);
    for (const language of ["en", "fr"] as const) {
      const items = supportGoldenSet.filter((item) => item.language === language);
      expect(items.length).toBeGreaterThanOrEqual(15);
      expect(items.some((item) => "refuse" in item.expect)).toBe(true);
    }
  });

  it("passes on the fake provider: search reaches an expected section for each question", async () => {
    const failures: string[] = [];
    for (const item of supportGoldenSet) {
      if (!("sections" in item.expect)) continue;
      const expected = item.expect.sections;
      const { assistant } = harness([
        (request) => toolStep("search_guide", { query: String(request.input.question) }),
        (request) => {
          const results =
            (request.input.tool_results as { result: { id: string }[] }[])[0]?.result ?? [];
          return answerStep(
            "See these sections.",
            results.slice(0, 2).map((result) => result.id),
          );
        },
      ]);
      const reply = await assistant.answer(ask(item.question, item.language));
      const cited = reply.mode === "assistant" ? reply.sections.map((section) => section.id) : [];
      if (!cited.some((id) => expected.includes(id)))
        failures.push(`${item.id}: ${cited.join(",")}`);
    }
    expect(failures).toEqual([]);
  });

  it("ranks the fallback's sections from a plain question", () => {
    expect(rankGuideSections(helpGuide("fr"), "Comment exporter mon CV en PDF ?")[0]?.id).toBe(
      "review",
    );
    expect(rankGuideSections(helpGuide("en"), "the and how")).toEqual([]);
  });
});
