import { ScreensI18nProvider } from "@draft-loop/ui/i18n";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApiClient } from "./api-client.js";
import {
  FeedbackDialog,
  type FeedbackDialogProps,
  feedbackScreen,
  maximumFeedbackLength,
  sendFeedback,
} from "./feedback.js";
import type { FeedbackClientContext } from "./feedback-context.js";

function render(node: ReactNode, locale: "en" | "fr" = "en"): string {
  return renderToStaticMarkup(<ScreensI18nProvider locale={locale}>{node}</ScreensI18nProvider>);
}

const idle: FeedbackDialogProps = {
  busy: false,
  sent: false,
  onSubmit: () => {},
  onClose: () => {},
};

describe("the Send feedback dialog (#2844)", () => {
  it("asks for a note of at most 2,000 characters and an optional kind, in English", () => {
    const html = render(<FeedbackDialog {...idle} />);

    expect(html).toContain("Send feedback");
    expect(html).toContain(`maxLength="${maximumFeedbackLength}"`);
    expect(html).toContain('<option value="" selected="">Not sure</option>');
    expect(html).toContain('<option value="bug">Something is broken</option>');
    expect(html).toContain("Up to 2000 characters.");
    // Nothing typed yet: Send waits for a note.
    expect(html).toMatch(/<button type="submit" disabled="">Send<\/button>/u);
  });

  it("speaks French when the screen does", () => {
    const html = render(<FeedbackDialog {...idle} />, "fr");

    expect(html).toContain("Envoyer un avis");
    expect(html).toContain("Quelque chose ne marche pas");
    expect(html).not.toContain("Something is broken");
  });

  it("shows a failed send as an alert and keeps the form", () => {
    const html = render(<FeedbackDialog {...idle} problem="The service cannot be reached." />);

    expect(html).toContain('role="alert"');
    expect(html).toContain("The service cannot be reached.");
    expect(html).toContain("<textarea");
  });

  it("thanks the member once the note is sent", () => {
    const html = render(<FeedbackDialog {...idle} sent />);

    expect(html).toContain('role="status"');
    expect(html).toContain("The people who run DraftLoop read every note.");
    expect(html).not.toContain("<textarea");
  });
});

describe("sending a note", () => {
  it("names the screen from the page fragment, keeping only safe characters", () => {
    expect(feedbackScreen("")).toBe("home");
    expect(feedbackScreen("#work-journal")).toBe("work-journal");
    expect(feedbackScreen("#<script>alert(1)</script>")).toBe("scriptalert1/script");
  });

  it("posts the note with its screen and leaves an unset kind out", async () => {
    const calls: unknown[] = [];
    const client: ApiClient = {
      call: (async (route: string, init: unknown) => {
        calls.push([route, init]);
        return {};
      }) as ApiClient["call"],
    };

    await sendFeedback(client, {
      text: "Export works well.",
      category: undefined,
      screen: "review",
    });
    await sendFeedback(client, { text: "Crash.", category: "bug", screen: "home" });

    expect(calls).toEqual([
      ["POST /v1/feedback", { body: { text: "Export works well.", screen: "review" } }],
      ["POST /v1/feedback", { body: { text: "Crash.", screen: "home", category: "bug" } }],
    ]);
  });
});

const context: FeedbackClientContext = {
  route: "/#review",
  webBuild: "index-a1b2c3",
  ids: { recordId: "record-1", runId: "run-7" },
  recentErrors: [{ code: "not_found", message: "No such run.", at: "2026-11-16T09:59:00.000Z" }],
  lastFailedRequestId: "3f0c2a8e-1b2c-4d5e-8f90-123456789abc",
  browser: {
    family: "Firefox",
    os: "Linux",
    viewport: "1280x800",
    language: "fr-FR",
    theme: "dark",
  },
};

describe("What we include (#2875)", () => {
  it("lists every value the note sends in a closed fold, and what it never sends", () => {
    const html = render(<FeedbackDialog {...idle} context={context} />);

    expect(html).toContain('<details class="feedback-context"><summary>What we include</summary>');
    for (const value of [
      "/#review",
      "index-a1b2c3",
      "record-1",
      "run-7",
      "not_found: No such run. (2026-11-16T09:59:00.000Z)",
      "3f0c2a8e-1b2c-4d5e-8f90-123456789abc",
      "Firefox, Linux, 1280x800, fr-FR, dark theme",
    ]) {
      expect(html).toContain(value);
    }
    expect(html).toContain("The server adds its version and your organisation&#x27;s plan.");
    expect(html).toContain("Never included: screenshots, page text, your CV or job descriptions.");
    expect(html).not.toContain("<details open");
  });

  it("says None for what the screen has not seen, in French too", () => {
    const html = render(<FeedbackDialog {...idle} context={{ route: "/" }} />, "fr");

    expect(html).toContain("Ce que nous joignons");
    expect(html).toContain("<dd>Aucun</dd>");
    expect(html).not.toContain("What we include");
  });

  it("posts the context with the note", async () => {
    const calls: unknown[] = [];
    const client: ApiClient = {
      call: (async (route: string, init: unknown) => {
        calls.push([route, init]);
        return {};
      }) as ApiClient["call"],
    };

    await sendFeedback(client, { text: "Blank page.", category: "bug", screen: "review", context });

    expect(calls).toEqual([
      [
        "POST /v1/feedback",
        { body: { text: "Blank page.", screen: "review", category: "bug", context } },
      ],
    ]);
  });
});
