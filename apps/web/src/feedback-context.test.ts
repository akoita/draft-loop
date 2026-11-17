import { afterEach, describe, expect, it } from "vitest";

import { createApiClient } from "./api-client.js";
import {
  browserFamily,
  type FeedbackPage,
  feedbackContextFor,
  osFamily,
  recordApiFailure,
  recordApiPath,
  resetFeedbackContext,
  webBuildOf,
} from "./feedback-context.js";

const firefoxOnLinux = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
const safariOnIphone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const page: FeedbackPage = {
  pathname: "/",
  hash: "#review",
  entryScript: "/assets/index-a1b2c3.js",
  userAgent: firefoxOnLinux,
  width: 1280,
  height: 800,
  language: "fr-FR",
  theme: "light",
};

afterEach(resetFeedbackContext);

describe("a feedback note's context (#2875)", () => {
  it("names the page, build and coarse browser facts, never the query or the user agent", () => {
    const context = feedbackContextFor({ ...page, hash: "#review?name=Jane" });

    expect(context).toEqual({
      route: "/#review",
      webBuild: "index-a1b2c3",
      browser: {
        family: "Firefox",
        os: "Linux",
        viewport: "1280x800",
        language: "fr-FR",
        theme: "light",
      },
    });
    expect(JSON.stringify(context)).not.toContain("Mozilla");
  });

  it("keeps the last five API errors and the last failed request id, without bodies", () => {
    for (let index = 1; index <= 7; index += 1) {
      recordApiFailure(
        { code: "not_found", message: `Error ${index}.`, requestId: `request-${index}` },
        new Date(`2026-11-16T10:0${index}:00.000Z`),
      );
    }
    recordApiFailure({ code: "<bad code>", message: "y".repeat(500), requestId: "has spaces" });

    const context = feedbackContextFor(page);

    expect(context?.recentErrors?.map(({ code, message }) => `${code}:${message.length}`)).toEqual([
      "not_found:8",
      "not_found:8",
      "not_found:8",
      "not_found:8",
      "unknown:200",
    ]);
    expect(context?.recentErrors?.[0]?.message).toBe("Error 4.");
    expect(context?.lastFailedRequestId).toBe("request-7");
  });

  it("follows the record, application and run the screen last called for", () => {
    recordApiPath({ workspaceId: "record-1", applicationId: "application-2" });
    recordApiPath({ workspaceId: "record-1", runId: "run-3" });
    expect(feedbackContextFor(page)?.ids).toEqual({
      recordId: "record-1",
      applicationId: "application-2",
      runId: "run-3",
    });

    recordApiPath({ workspaceId: "record-9" });
    expect(feedbackContextFor(page)?.ids).toEqual({ recordId: "record-9" });
  });

  it("drops the errors rather than send a context past its bound", () => {
    for (let index = 0; index < 5; index += 1) {
      recordApiFailure({ code: "invalid_input", message: "\u0001".repeat(200) });
    }

    const context = feedbackContextFor(page);

    expect(context?.recentErrors).toBeUndefined();
    expect(context?.route).toBe("/#review");
  });

  it("reads browser and system families from common user agents", () => {
    expect([browserFamily(safariOnIphone), osFamily(safariOnIphone)]).toEqual(["Safari", "iOS"]);
    expect(webBuildOf(null)).toBeUndefined();
  });

  it("is fed by the API client's refusals", async () => {
    const client = createApiClient({
      fetch: (async () =>
        new Response(JSON.stringify({ error: { code: "not_found", message: "No such run." } }), {
          status: 404,
          headers: { "content-type": "application/json", "x-request-id": "request-42" },
        })) as typeof fetch,
    });

    await expect(
      client.call("GET /v1/workspaces/{workspaceId}/runs/{runId}", {
        path: { workspaceId: "record-1", runId: "run-7" },
      }),
    ).rejects.toThrow("No such run.");

    const context = feedbackContextFor(page);
    expect(context?.recentErrors).toEqual([
      { code: "not_found", message: "No such run.", at: expect.any(String) },
    ]);
    expect(context?.lastFailedRequestId).toBe("request-42");
    expect(context?.ids).toEqual({ recordId: "record-1", runId: "run-7" });
  });
});
