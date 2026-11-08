import { describe, expect, it } from "vitest";

import {
  clientErrorReport,
  scrubErrorBuild,
  scrubErrorMessage,
  scrubErrorRoute,
  scrubErrorStack,
} from "./client-error-report.js";

describe("scrubErrorMessage", () => {
  it("removes quoted text, addresses, queries and numbers", () => {
    expect(
      scrubErrorMessage(
        `Unexpected token "Senior engineer at Acme" from jane.doe@example.com in https://x.test/a?q=secret after 2024`,
      ),
    ).toBe("Unexpected token … from [address] in https://x.test/a after #");
    expect(scrubErrorMessage("Cannot read properties of undefined (reading 'name')")).toBe(
      "Cannot read properties of undefined (reading …)",
    );
  });

  it("caps the length", () => {
    expect(scrubErrorMessage("a ".repeat(500)).length).toBe(200);
  });
});

describe("scrubErrorStack", () => {
  it("keeps Chrome and Firefox frames as paths with no origin or query", () => {
    const chrome = [
      "TypeError: Cannot read 'Jane Doe'",
      "    at renderCard (https://draftloop.test/assets/index-a1B2.js?v=1:12:34)",
      "    at async Promise.all (index 0)",
      "    at https://draftloop.test/assets/index-a1B2.js:56:7",
    ].join("\n");
    expect(scrubErrorStack(chrome)).toEqual([
      "renderCard /assets/index-a1B2.js:12:34",
      "/assets/index-a1B2.js:56:7",
    ]);
    expect(scrubErrorStack("onClick@https://draftloop.test/assets/x.js#frag:3:4\n")).toEqual([
      "onClick /assets/x.js:3:4",
    ]);
  });

  it("accepts its own output and caps the frames", () => {
    const frames = scrubErrorStack(
      Array.from({ length: 30 }, (_, i) => `    at f${i} (https://h.test/a.js:${i}:1)`).join("\n"),
    );
    expect(frames).toHaveLength(20);
    expect(scrubErrorStack(frames.join("\n"))).toEqual(frames);
    expect(scrubErrorStack(undefined)).toEqual([]);
  });
});

describe("scrubErrorRoute and scrubErrorBuild", () => {
  it("replaces ids and drops the query", () => {
    expect(scrubErrorRoute("/workspaces/ws_9f3/applications/123/review?tab=cv#x")).toBe(
      "/workspaces/:id/applications/:id/review",
    );
    expect(scrubErrorRoute("")).toBe("/");
  });

  it("keeps only a script path as the build", () => {
    expect(scrubErrorBuild("https://h.test/assets/index-a1B2.js")).toBe("/assets/index-a1B2.js");
    expect(scrubErrorBuild("<script>")).toBe("unknown");
  });
});

it("builds one report from raw parts", () => {
  expect(
    clientErrorReport({
      kind: "unhandled_rejection",
      message: "Failed 'x'",
      stack: ["at f (https://h.test/a.js:1:2)"],
      route: "/a/B1",
      build: "/assets/i.js",
    }),
  ).toEqual({
    kind: "unhandled_rejection",
    message: "Failed …",
    stack: ["f /a.js:1:2"],
    route: "/a/:id",
    build: "/assets/i.js",
  });
});
