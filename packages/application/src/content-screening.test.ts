import { describe, expect, it } from "vitest";
import {
  type ContentScreener,
  type ContentScreeningInput,
  type ContentScreeningResult,
  type ContentScreeningSignal,
  contentScreeningChunkOverlapChars,
  maximumContentScreeningChars,
  screenWith,
  splitForContentScreening,
} from "./content-screening.js";

const fixedNow = () => "2026-10-24T10:00:00.000Z";

function verdictFor(
  id: string,
  signals: readonly ContentScreeningSignal[],
  verdict?: ContentScreeningResult["verdict"],
): ContentScreeningResult {
  return {
    verdict: verdict ?? (signals.length > 0 ? "flagged" : "clear"),
    signals: [...signals],
    screeners: [{ id, version: "1" }],
    screenedAt: fixedNow(),
  };
}

function scripted(
  id: string,
  respond: (input: ContentScreeningInput) => unknown,
  extra: { provider?: string; model?: string } = {},
): ContentScreener & { readonly calls: ContentScreeningInput[] } {
  const calls: ContentScreeningInput[] = [];
  return {
    identity: { id, version: "1", ...extra },
    calls,
    screen: async (input) => {
      calls.push(input);
      return respond(input) as ContentScreeningResult;
    },
  };
}

const failing = (id: string) =>
  scripted(id, () => {
    throw new Error("secret job text leaked into an error");
  });

const job = { text: "A fictional job post.", kind: "job-source" } as const;

describe("screenWith", () => {
  it("is clear when every screener is clear, and records every identity", async () => {
    const rules = scripted("rules", () => verdictFor("rules", []));
    const model = scripted("model", () => verdictFor("model", []), {
      provider: "anthropic",
      model: "claude-haiku-5-5",
    });
    const result = await screenWith([rules, model], job, fixedNow);
    expect(result).toEqual({
      verdict: "clear",
      signals: [],
      screeners: [
        { id: "rules", version: "1" },
        { id: "model", version: "1", provider: "anthropic", model: "claude-haiku-5-5" },
      ],
      screenedAt: "2026-10-24T10:00:00.000Z",
    });
    expect(rules.calls).toEqual([job]);
    expect(model.calls).toEqual([job]);
  });

  it("is flagged with merged, sorted signals when any screener flags", async () => {
    const result = await screenWith(
      [
        scripted("rules", () => verdictFor("rules", ["instruction-override"])),
        scripted("model", () => verdictFor("model", [])),
        scripted("extra", () => verdictFor("extra", ["exfiltration-link", "instruction-override"])),
      ],
      { text: "x", kind: "candidate-source" },
      fixedNow,
    );
    expect(result.verdict).toBe("flagged");
    expect(result.signals).toEqual(["exfiltration-link", "instruction-override"]);
    expect(result.screeners.map((screener) => screener.id)).toEqual(["rules", "model", "extra"]);
  });

  it("fails closed when a screener throws, without leaking the error", async () => {
    const result = await screenWith(
      [scripted("rules", () => verdictFor("rules", [])), failing("model")],
      job,
      fixedNow,
    );
    expect(result.verdict).toBe("unscreened");
    expect(result.signals).toEqual(["screener-unavailable"]);
    expect(result.screeners.map((screener) => screener.id)).toEqual(["rules", "model"]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("lets a flag win over a failure and lists both", async () => {
    const result = await screenWith(
      [failing("model"), scripted("rules", () => verdictFor("rules", ["hidden-text"]))],
      job,
      fixedNow,
    );
    expect(result.verdict).toBe("flagged");
    expect(result.signals).toEqual(["hidden-text", "screener-unavailable"]);
  });

  it("treats an invalid result as unavailable", async () => {
    for (const invalid of [
      null,
      "clear",
      { verdict: "clear" },
      { ...verdictFor("rules", []), verdict: "flagged" },
      { ...verdictFor("rules", []), excerpt: "quoted text" },
    ]) {
      const result = await screenWith([scripted("rules", () => invalid)], job, fixedNow);
      expect(result.verdict).toBe("unscreened");
      expect(result.signals).toEqual(["screener-unavailable"]);
    }
  });

  it("treats a screener's own unscreened result as unavailable", async () => {
    const result = await screenWith(
      [scripted("model", () => verdictFor("model", ["screener-unavailable"], "unscreened"))],
      job,
      fixedNow,
    );
    expect(result.verdict).toBe("unscreened");
    expect(result.signals).toEqual(["screener-unavailable"]);
  });

  it("keeps screener-unavailable alongside a flag from the same screener", async () => {
    const result = await screenWith(
      [scripted("rules", () => verdictFor("rules", ["role-change", "screener-unavailable"]))],
      job,
      fixedNow,
    );
    expect(result.verdict).toBe("flagged");
    expect(result.signals).toEqual(["role-change", "screener-unavailable"]);
  });

  it("is unscreened when there are no screeners", async () => {
    const result = await screenWith([], job, fixedNow);
    expect(result.verdict).toBe("unscreened");
    expect(result.signals).toEqual(["screener-unavailable"]);
    expect(result.screeners).toEqual([]);
  });

  it("screens long text in chunks and flags when any chunk flags", async () => {
    const text = "a".repeat(maximumContentScreeningChars * 2 + 10);
    const rules = scripted("rules", (input) =>
      verdictFor("rules", input.text.length < maximumContentScreeningChars ? ["role-change"] : []),
    );
    const result = await screenWith([rules], { text, kind: "candidate-source" }, fixedNow);
    expect(rules.calls.length).toBeGreaterThan(2);
    expect(rules.calls.every((call) => call.text.length <= maximumContentScreeningChars)).toBe(
      true,
    );
    expect(rules.calls.every((call) => call.kind === "candidate-source")).toBe(true);
    expect(result.verdict).toBe("flagged");
    expect(result.signals).toEqual(["role-change"]);
    expect(result.screeners).toHaveLength(1);
  });

  it("is unscreened when one chunk of a long text fails", async () => {
    let call = 0;
    const model = scripted("model", () => {
      call += 1;
      if (call === 2) {
        throw new Error("rate limited");
      }
      return verdictFor("model", []);
    });
    const text = "a".repeat(maximumContentScreeningChars + 1);
    const result = await screenWith([model], { text, kind: "job-source" }, fixedNow);
    expect(result.verdict).toBe("unscreened");
  });

  it("stamps the current time by default", async () => {
    const before = Date.now();
    const result = await screenWith([scripted("rules", () => verdictFor("rules", []))], job);
    expect(Date.parse(result.screenedAt)).toBeGreaterThanOrEqual(before);
  });
});

describe("splitForContentScreening", () => {
  it("returns text within the cap as one chunk", () => {
    expect(splitForContentScreening("")).toEqual([""]);
    const exact = "b".repeat(maximumContentScreeningChars);
    expect(splitForContentScreening(exact)).toEqual([exact]);
  });

  it("covers all text with overlapping chunks no longer than the cap", () => {
    const text = Array.from({ length: maximumContentScreeningChars * 3 }, (_, i) =>
      String.fromCharCode(97 + (i % 26)),
    ).join("");
    const chunks = splitForContentScreening(text);
    expect(chunks.every((chunk) => chunk.length <= maximumContentScreeningChars)).toBe(true);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks[0]).toBe(text.slice(0, maximumContentScreeningChars));
    expect(text.endsWith(chunks.at(-1) ?? "\0")).toBe(true);
    for (let i = 1; i < chunks.length; i += 1) {
      const previous = chunks[i - 1] ?? "";
      expect(chunks[i]?.startsWith(previous.slice(-contentScreeningChunkOverlapChars))).toBe(true);
    }
  });

  it("never splits a surrogate pair", () => {
    const text = `${"a".repeat(maximumContentScreeningChars - 1)}${"😀".repeat(3000)}`;
    for (const chunk of splitForContentScreening(text)) {
      expect(chunk.isWellFormed()).toBe(true);
    }
  });
});
