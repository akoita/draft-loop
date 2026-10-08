import type { JsonObject, ModelRequest } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";

import { buildBoundedCallRequest } from "./canonical-profile-extraction-bounded-calls.js";
import {
  planCanonicalProfileExtractionBoundedTextWindows,
  planCanonicalProfileExtractionCalls,
} from "./canonical-profile-extraction-plan.js";
import { canonicalProfileExtractionWindowCharacters } from "./canonical-profile-extraction-size-windows.js";
import { planCanonicalProfileExtractionStructureWindows } from "./canonical-profile-extraction-structure.js";

type Window = {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly headingPath?: readonly string[];
};

function expectContiguous(text: string, windows: readonly Window[], limit: number) {
  let priorEnd = 0;
  for (const window of windows) {
    expect(window.start).toBe(priorEnd);
    expect(window.end).toBeGreaterThan(window.start);
    expect(window.end - window.start).toBeLessThanOrEqual(limit);
    expect(window.text).toBe(text.slice(window.start, window.end));
    priorEnd = window.end;
  }
  expect(priorEnd).toBe(text.length);
}

function body(label: string, characters: number): string {
  const line = `${label} delivered a synthetic platform migration for Fictional Works Ltd.\n`;
  return `${line.repeat(Math.ceil(characters / line.length)).slice(0, characters - 1)}\n`;
}

function section(
  heading: string,
  characters: number,
  label = heading.replace(/^#+\s*/u, ""),
): string {
  return `${heading}\n${body(label, characters)}`;
}

describe("canonical profile extraction structure windows", () => {
  it("packs whole nested sections in document order and never splits a heading from its content", () => {
    const text = [
      "Intro line before any heading.\n",
      section("# Experience", 10),
      section("## Senior Engineer at Fictional Works, 2019-2023", 3_000, "Role A"),
      section("## Staff Engineer at Example Labs, 2023-2025", 3_000, "Role B"),
      section("### Projects", 500, "Project"),
      section("# Education", 2_500, "Degree"),
    ].join("");
    const windows = planCanonicalProfileExtractionStructureWindows(text, 8_192);

    expect(windows).not.toBeNull();
    expectContiguous(text, windows ?? [], 8_192);
    expect(windows?.length).toBeGreaterThan(1);
    for (const window of windows ?? []) {
      expect(window.headingPath).toBeUndefined();
      // Windows begin at a section start, never mid-section.
      expect(window.start === 0 || text.charAt(window.start - 1) === "\n").toBe(true);
      expect(
        window.start === 0 || /^ {0,3}#{1,6}[ \t]/u.test(window.text.split("\n")[0] ?? ""),
      ).toBe(true);
    }
    // A parent heading with no body of its own stays with its first child heading.
    const experienceWindow = windows?.find((window) => window.text.includes("# Experience\n"));
    expect(experienceWindow?.text).toContain("## Senior Engineer at Fictional Works");
    // The first window holds the unheaded preamble and starts at offset zero.
    expect(windows?.[0]?.text.startsWith("Intro line before any heading.")).toBe(true);
    // A window never ends right after a heading line.
    for (const window of windows ?? []) {
      const lines = window.text.trimEnd().split("\n");
      expect(/^ {0,3}#{1,6}[ \t]/u.test(lines.at(-1) ?? "")).toBe(false);
    }
  });

  it("keeps a trailing heading-only section with the section before it", () => {
    const text = `${section("# Skills", 400)}# Appendix\n`;
    const windows = planCanonicalProfileExtractionStructureWindows(text, 8_192);
    expect(windows).toHaveLength(1);
    expect(windows?.[0]?.text).toBe(text);
  });

  it("ignores headings inside fenced code blocks", () => {
    const text = [
      section("# Notes", 100),
      "```sh\n# not a heading\n## also not a heading\n```\n",
      "~~~\n# tilde fence content\n~~~\n",
      "Text after the fences.\n",
      section("# Next", 100),
    ].join("");
    const windows = planCanonicalProfileExtractionStructureWindows(text, 260);

    expect(windows).not.toBeNull();
    expectContiguous(text, windows ?? [], 260);
    expect(windows).toHaveLength(2);
    for (const window of windows ?? []) {
      expect(window.headingPath).toBeUndefined();
      expect(window.text.startsWith("# not a heading")).toBe(false);
      expect(window.text.startsWith("## also not a heading")).toBe(false);
      expect(window.text.startsWith("# tilde fence content")).toBe(false);
    }
    // Only "# Notes" and "# Next" are boundaries, so the fenced block stays inside "# Notes".
    expect(windows?.at(-1)?.text.startsWith("# Next\n")).toBe(true);
    expect(windows?.[0]?.text).toContain("Text after the fences.");
  });

  it("returns null for text without headings and for hash lines that are not ATX headings", () => {
    expect(planCanonicalProfileExtractionStructureWindows("plain\ntext\n", 8_192)).toBeNull();
    expect(
      planCanonicalProfileExtractionStructureWindows(
        "#hashtag\n####### seven\n    # code\n",
        8_192,
      ),
    ).toBeNull();
  });

  it("splits a giant section internally with its heading path and exact offsets", () => {
    const heading = "### Senior Engineer at Fictional Works, 2019-2023";
    const text = [
      section("# Summary", 300),
      `# Experience\n## Platform\n${section(heading, 20_000, "Giant")}`,
      section("# Education", 300),
    ].join("");
    const windows = planCanonicalProfileExtractionStructureWindows(text, 8_192);

    expect(windows).not.toBeNull();
    expectContiguous(text, windows ?? [], 8_192);
    const pieces = windows?.filter((window) => window.headingPath !== undefined) ?? [];
    expect(pieces.length).toBeGreaterThanOrEqual(3);
    for (const piece of pieces) {
      expect(piece.headingPath).toEqual(["Experience", "Platform", heading.slice(4)]);
      // The path is context only: window text is the exact source slice.
      expect(piece.text).toBe(text.slice(piece.start, piece.end));
    }
    expect(pieces[0]?.text.startsWith("# Experience\n## Platform\n### Senior Engineer")).toBe(true);
    // Sections around the giant one are not carried in its windows.
    expect(windows?.[0]?.text).toBe(section("# Summary", 300));
    expect(windows?.at(-1)?.text).toBe(section("# Education", 300));
    expect(windows?.at(-1)?.headingPath).toBeUndefined();
  });

  it("closes heading levels so a sibling does not inherit the previous branch", () => {
    const text = [
      section("# A", 5_000),
      section("## A1", 9_000, "First"),
      section("# B", 9_000, "Second"),
    ].join("");
    const windows = planCanonicalProfileExtractionStructureWindows(text, 8_192);
    const paths = windows?.map((window) => window.headingPath?.join(" > "));
    expect(paths).toContain("A > A1");
    expect(paths).toContain("B");
    expect(paths).not.toContain("A > B");
  });

  it("keeps the unstructured plan exactly as it was for text without headings", () => {
    const text = "Synthetic career line without any heading.\n".repeat(1_000);
    const windows = planCanonicalProfileExtractionBoundedTextWindows(text);
    expect(windows).not.toBeNull();
    expectContiguous(text, windows ?? [], 8_192);
    expect(windows?.every((window) => !("headingPath" in window))).toBe(true);
    expect(windows).toHaveLength(Math.ceil(text.length / 8_192));
  });

  it("derives the window size from the output budget, clamped between 8K and 32K", () => {
    expect(canonicalProfileExtractionWindowCharacters()).toBe(8_192);
    expect(canonicalProfileExtractionWindowCharacters(Number.NaN)).toBe(8_192);
    expect(canonicalProfileExtractionWindowCharacters(0)).toBe(8_192);
    expect(canonicalProfileExtractionWindowCharacters(8_192)).toBe(8_192);
    expect(canonicalProfileExtractionWindowCharacters(16_384)).toBe(8_192);
    expect(canonicalProfileExtractionWindowCharacters(32_768)).toBe(8_192);
    expect(canonicalProfileExtractionWindowCharacters(65_536)).toBe(16_384);
    expect(canonicalProfileExtractionWindowCharacters(1_000_000)).toBe(32_768);
  });

  it("plans larger windows for a larger budget and keeps 8K windows by default", () => {
    const text = Array.from({ length: 12 }, (_, index) =>
      section(`# Section ${index}`, 6_000, `Part${index}`),
    ).join("");
    const source = [{ id: "source-a", text }];
    const small = planCanonicalProfileExtractionCalls(source);
    const large = planCanonicalProfileExtractionCalls(source, 65_536);

    expect(planCanonicalProfileExtractionCalls(source, 8_192)).toEqual(small);
    expect(small).toHaveLength(12);
    expect(large).toHaveLength(6);
    const windows = large?.flatMap((call) => (call.window === undefined ? [] : [call.window]));
    expectContiguous(text, windows ?? [], 16_384);
    expect(windows?.some((window) => window.end - window.start > 8_192)).toBe(true);
  });

  it("matches the previous plan for unstructured sources at every default-budget input", () => {
    const text = "x".repeat(65_537);
    const calls = planCanonicalProfileExtractionCalls([{ id: "source-a", text }], undefined);
    expect(calls).toHaveLength(9);
    expect(calls?.every((call) => call.window?.headingPath === undefined)).toBe(true);
  });

  it("keeps the call cap and the null fallback with structured text", () => {
    // 5,000-unit sections pack one per 8K window: more windows than plain size splitting needs.
    const text = Array.from({ length: 70 }, (_, index) =>
      section(`# Role ${index}`, 5_000, `Role${index}`),
    ).join("");
    const calls = planCanonicalProfileExtractionCalls([{ id: "source-a", text }]);
    expect(calls).toHaveLength(70);

    // 130 sections would need 130 structured windows (over the cap); size windows need fewer.
    const dense = Array.from({ length: 130 }, (_, index) =>
      section(`# Role ${index}`, 4_300, `Role${index}`),
    ).join("");
    const fallback = planCanonicalProfileExtractionCalls([{ id: "source-a", text: dense }]);
    expect(fallback).not.toBeNull();
    expect(fallback?.length).toBeLessThanOrEqual(96);
    expectContiguous(
      dense,
      fallback?.flatMap((call) => (call.window === undefined ? [] : [call.window])) ?? [],
      8_192,
    );

    // Four sources of 200,000 units still exceed the cap even with heading-aligned text.
    const huge = ["a", "b", "c", "d"].map((id) => ({
      id,
      text: Array.from({ length: 200 }, (_, index) =>
        section(`# H${index}`, 1_000, `Huge${index}`),
      ).join(""),
    }));
    expect(planCanonicalProfileExtractionCalls(huge)).toBeNull();
  });

  it("plans a 200K-character, 36-section document in half the calls at a 64K-token budget", () => {
    const text = Array.from({ length: 36 }, (_, index) =>
      section(`# Section ${index}`, 5_500, `Doc${index}`),
    ).join("");
    expect(text.length).toBeGreaterThan(195_000);
    const before = planCanonicalProfileExtractionCalls([{ id: "source-a", text }]);
    const after = planCanonicalProfileExtractionCalls([{ id: "source-a", text }], 65_536);
    expect(after).not.toBeNull();
    // Two whole sections fit each 16,384-character window; none is cut.
    expect(after?.length).toBe(18);
    expect(after?.length).toBeLessThan(before?.length ?? 0);
  });
});

describe("canonical profile bounded call heading path", () => {
  const controls = {
    model: {
      company: "anthropic",
      modelId: "claude-sonnet-5-5",
      role: "author",
      promptTemplateVersion: "structure-test-v1",
    },
    systemPrompt: "Base prompt.",
    maxOutputTokens: 32_768,
    dataPolicy: {
      allowTransmission: true,
      allowedCompanies: ["anthropic"],
      sensitiveData: true,
      sensitiveDataAcknowledged: true,
    },
  } as const;
  const sourceText = `${section("# Experience", 100)}${section("## Senior Engineer at Fictional Works", 100)}`;
  const request = {
    operationId: "operation-structure",
    sources: [
      {
        id: "source-a",
        mediaType: "text/markdown",
        checksum: "a".repeat(64),
        text: sourceText,
      },
    ],
  };

  function build(window: Window): ModelRequest<JsonObject> {
    return buildBoundedCallRequest(
      request,
      controls as never,
      { sourceId: "source-a", window },
      undefined,
    );
  }

  it("sends the heading path as extraction context next to the exact window offsets", () => {
    const start = sourceText.indexOf("## Senior");
    const window = {
      start,
      end: sourceText.length,
      text: sourceText.slice(start),
      headingPath: ["Experience", "Senior Engineer at Fictional Works"],
    };
    const call = build(window);

    expect(call.input.extractionWindow).toEqual({
      sourceId: "source-a",
      start,
      end: sourceText.length,
      sourceLength: sourceText.length,
      headingPath: ["Experience", "Senior Engineer at Fictional Works"],
    });
    expect((call.input.sources as { text: string }[])[0]?.text).toBe(sourceText.slice(start));
    expect(call.systemPrompt).toContain("headingPath");
    expect(call.systemPrompt).toContain("never quote it as evidence");
  });

  it("omits the heading path and its instruction for windows without one", () => {
    const call = build({ start: 0, end: 50, text: sourceText.slice(0, 50) });
    expect(call.input.extractionWindow).not.toHaveProperty("headingPath");
    expect(call.systemPrompt).not.toContain("never quote it as evidence");
  });
});
