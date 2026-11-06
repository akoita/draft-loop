import { describe, expect, it } from "vitest";

import {
  createDecisionModel,
  type DecisionDataPolicy,
  type DecisionFetch,
  DecisionModelError,
  type DecisionQuestion,
} from "./index.js";

const policy: DecisionDataPolicy = {
  allowTransmission: true,
  allowedVendors: ["typesafe-jev", "openai-decisions", "microsoft-decision-1"],
  sensitiveData: false,
  sensitiveDataAcknowledged: false,
};

// Synthetic input only: a made-up job page, never candidate material.
const input = "Senior widget engineer at Example Corp. This posting has closed.";

const questions: readonly DecisionQuestion[] = [
  {
    kind: "predicate",
    name: "closed",
    instructions: "The page says the job is closed or expired.",
  },
  {
    kind: "choice",
    name: "page",
    instructions: "What kind of page is this?",
    options: { "job-post": "One specific job", "job-list": null },
  },
  {
    kind: "score",
    name: "detail",
    instructions: "How detailed is the job description?",
    levels: ["thin", "fair", "rich"],
  },
];

interface Recorded {
  url: string;
  init: RequestInit;
}

function scripted(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): { fetch: DecisionFetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  return {
    calls,
    fetch: async (url, requestInit) => {
      calls.push({ url, init: requestInit });
      return new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "content-type": "application/json", ...init.headers },
      });
    },
  };
}

const systemOneAnswers = {
  model: "jev-1.14.0",
  answers: {
    closed: { type: "noul", noul: 0.97 },
    page: {
      type: "choice",
      choice: "job-post",
      probabilities: { "job-post": 0.9, "job-list": 0.1 },
      confidence: 0.9,
    },
    detail: {
      type: "score",
      score: 0.4,
      legend: { 0: "thin" },
      probabilities: { 0: 0.6, 1: 0.4, 2: 0 },
      confidence: 0.6,
    },
  },
  usage: { input_tokens: 120, output_tokens: 3 },
};

function requestBody(call: Recorded | undefined): unknown {
  return JSON.parse(String(call?.init.body));
}

describe("decision model wrapper", () => {
  it("uses Jev by default and maps the System One format both ways", async () => {
    const vendor = scripted(systemOneAnswers, { headers: { "x-typesafe-request-id": "req_1" } });
    const model = createDecisionModel({ apiKey: "test-key", fetch: vendor.fetch });

    expect(model.identity).toEqual({ vendor: "typesafe-jev", model: "jev-latest" });
    const result = await model.decide({ input, questions, dataPolicy: policy });

    expect(vendor.calls[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(new Headers(vendor.calls[0]?.init.headers).get("authorization")).toBe("Bearer test-key");
    expect(requestBody(vendor.calls[0])).toEqual({
      model: "jev-latest",
      state: input,
      questions: {
        closed: { type: "noul", instructions: "The page says the job is closed or expired." },
        page: {
          type: "choice",
          instructions: "What kind of page is this?",
          criteria: { "job-post": "One specific job", "job-list": null },
        },
        detail: {
          type: "score",
          instructions: "How detailed is the job description?",
          criteria: ["thin", "fair", "rich"],
        },
      },
    });
    expect(result).toEqual({
      vendor: "typesafe-jev",
      model: "jev-1.14.0",
      requestId: "req_1",
      usage: { inputTokens: 120, outputTokens: 3 },
      answers: {
        closed: { kind: "predicate", name: "closed", probability: 0.97 },
        page: {
          kind: "choice",
          name: "page",
          choice: "job-post",
          probabilities: { "job-post": 0.9, "job-list": 0.1 },
          confidence: 0.9,
        },
        detail: {
          kind: "score",
          name: "detail",
          score: 0.4,
          probabilities: [0.6, 0.4, 0],
          confidence: 0.6,
        },
      },
    });
  });

  it("speaks the OpenAI Decisions format", async () => {
    const vendor = scripted({
      model: "gpt-6-luna-2026-10-01",
      answers: [
        { type: "predicate", name: "closed", probability: 0.2 },
        {
          type: "choice",
          name: "page",
          choice: "job-list",
          probabilities: [
            { value: "job-post", probability: 0.3 },
            { value: "job-list", probability: 0.7 },
          ],
          confidence: 0.7,
        },
        { type: "refusal", name: "detail" },
      ],
      usage: { input_tokens: 90, output_tokens: 0, total_tokens: 90 },
    });
    const model = createDecisionModel({
      vendor: "openai-decisions",
      apiKey: "test-key",
      fetch: vendor.fetch,
    });

    const result = await model.decide({ input: { page: input }, questions, dataPolicy: policy });

    expect(vendor.calls[0]?.url).toBe("https://api.openai.com/v1/decisions");
    expect(requestBody(vendor.calls[0])).toEqual({
      model: "gpt-6-luna",
      input: JSON.stringify({ page: input }),
      questions: [
        {
          type: "predicate",
          name: "closed",
          instructions: "The page says the job is closed or expired.",
        },
        {
          type: "choice",
          name: "page",
          instructions: "What kind of page is this?",
          choices: [{ value: "job-post", description: "One specific job" }, { value: "job-list" }],
        },
        {
          type: "score",
          name: "detail",
          instructions: "How detailed is the job description?",
          levels: [{ label: "thin" }, { label: "fair" }, { label: "rich" }],
        },
      ],
    });
    expect(result.model).toBe("gpt-6-luna-2026-10-01");
    expect(result.answers.page).toMatchObject({ kind: "choice", choice: "job-list" });
    expect(result.answers.detail).toEqual({ kind: "refusal", name: "detail" });
  });

  it("sends Microsoft Decision 1 the deployment and a fresh Entra token", async () => {
    const vendor = scripted({ ...systemOneAnswers, model: "Microsoft-Decision-1" });
    const model = createDecisionModel({
      vendor: "microsoft-decision-1",
      endpoint: "https://example-resource.services.ai.azure.com/",
      deployment: "decision-1-eu",
      getAccessToken: async () => "entra-token",
      fetch: vendor.fetch,
    });

    await model.decide({ input, questions, dataPolicy: policy });

    expect(vendor.calls[0]?.url).toBe(
      "https://example-resource.services.ai.azure.com/providers/microsoft/v1/systemone",
    );
    expect(new Headers(vendor.calls[0]?.init.headers).get("authorization")).toBe(
      "Bearer entra-token",
    );
    expect(requestBody(vendor.calls[0])).toMatchObject({ model: "decision-1-eu", state: input });
  });

  it("refuses before sending when the policy does not allow the call", async () => {
    const vendor = scripted(systemOneAnswers);
    const model = createDecisionModel({ apiKey: "test-key", fetch: vendor.fetch });

    for (const dataPolicy of [
      { ...policy, allowTransmission: false },
      { ...policy, allowedVendors: ["openai-decisions" as const] },
      { ...policy, sensitiveData: true },
    ]) {
      await expect(model.decide({ input, questions, dataPolicy })).rejects.toMatchObject({
        code: "policy",
      });
    }
    expect(vendor.calls).toHaveLength(0);
  });

  it("refuses invalid questions before sending", async () => {
    const vendor = scripted(systemOneAnswers);
    const model = createDecisionModel({ apiKey: "test-key", fetch: vendor.fetch });
    const duplicate: DecisionQuestion = {
      kind: "predicate",
      name: "twice",
      instructions: "Asked twice.",
    };
    const invalid: readonly (readonly DecisionQuestion[])[] = [
      [],
      [duplicate, duplicate],
      [{ kind: "choice", name: "one", instructions: "Pick", options: { only: null } }],
      [{ kind: "score", name: "flat", instructions: "Rate", levels: ["low"] }],
    ];
    for (const set of invalid) {
      await expect(
        model.decide({ input, questions: set, dataPolicy: policy }),
      ).rejects.toMatchObject({
        code: "invalid-request",
      });
    }
    expect(vendor.calls).toHaveLength(0);
  });

  it("rejects answers that do not match the questions asked", async () => {
    const mismatches = [
      { ...systemOneAnswers, answers: { closed: systemOneAnswers.answers.closed } },
      {
        ...systemOneAnswers,
        answers: { ...systemOneAnswers.answers, closed: { type: "noul", noul: 1.5 } },
      },
      {
        ...systemOneAnswers,
        answers: {
          ...systemOneAnswers.answers,
          page: { type: "choice", choice: "invented", probabilities: {}, confidence: 0.5 },
        },
      },
      {
        ...systemOneAnswers,
        answers: {
          ...systemOneAnswers.answers,
          closed: { type: "score", score: 1, probabilities: {}, confidence: 1 },
        },
      },
      { model: "jev" },
    ];
    for (const body of mismatches) {
      const model = createDecisionModel({ apiKey: "test-key", fetch: scripted(body).fetch });
      await expect(model.decide({ input, questions, dataPolicy: policy })).rejects.toMatchObject({
        code: "invalid-response",
      });
    }
  });

  it("maps vendor failures to content-free errors", async () => {
    const cases: readonly [number, string, boolean][] = [
      [401, "authentication", false],
      [403, "permission", false],
      [422, "invalid-request", false],
      [429, "rate-limit", true],
      [529, "transient", true],
    ];
    for (const [status, code, retryable] of cases) {
      const vendor = scripted(
        { detail: [{ msg: `echo of ${input}` }] },
        { status, headers: { "retry-after": "2" } },
      );
      const model = createDecisionModel({ apiKey: "test-key", fetch: vendor.fetch });
      const error = await model
        .decide({ input, questions, dataPolicy: policy })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(DecisionModelError);
      expect(error).toMatchObject({ code, retryable, status, vendor: "typesafe-jev" });
      expect((error as Error).message).not.toContain("Example Corp");
    }
  });

  it("reports a timeout and a cancellation apart", async () => {
    const hanging: DecisionFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const timed = createDecisionModel({ apiKey: "test-key", fetch: hanging, timeoutMs: 5 });
    await expect(timed.decide({ input, questions, dataPolicy: policy })).rejects.toMatchObject({
      code: "timeout",
    });

    const controller = new AbortController();
    const cancelled = createDecisionModel({ apiKey: "test-key", fetch: hanging });
    const pending = cancelled.decide({
      input,
      questions,
      dataPolicy: policy,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });

  it("refuses a plain-http endpoint and an empty key at construction", () => {
    expect(() =>
      createDecisionModel({ apiKey: "k", endpoint: "http://api.typesafe.ai/v1/systemone" }),
    ).toThrow(DecisionModelError);
    expect(() => createDecisionModel({ vendor: "openai-decisions", apiKey: " " })).toThrow(
      DecisionModelError,
    );
  });
});
