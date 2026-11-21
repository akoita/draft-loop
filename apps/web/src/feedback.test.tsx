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
import { feedbackCharactersLeft, feedbackReference } from "./feedback-model.js";

function render(node: ReactNode, locale: "en" | "fr" = "en"): string {
  return renderToStaticMarkup(<ScreensI18nProvider locale={locale}>{node}</ScreensI18nProvider>);
}

const idle: FeedbackDialogProps = {
  busy: false,
  sent: false,
  onSubmit: () => {},
  onClose: () => {},
};

describe("the Send feedback dialog (#2844, #2876)", () => {
  it("titles the dialog and asks for a note with optional kind chips, none chosen", () => {
    const html = render(<FeedbackDialog {...idle} />);

    expect(html).toMatch(/<h2 id="[^"]+-title" class="feedback-title">Send feedback<\/h2>/u);
    expect(html).toContain(`maxLength="${maximumFeedbackLength}"`);
    expect(html).toContain('placeholder="What happened? What did you expect?"');
    expect(html).toContain("Kind of note (optional)");
    expect(html).toContain("<legend class=\"feedback-label\">Kind of note (optional)</legend>");
    expect(html).not.toContain("<select");
    for (const kind of ["Something is broken", "An idea", "Something else"]) {
      expect(html).toContain(
        `<button type="button" class="feedback-chip" aria-pressed="false">${kind}</button>`,
      );
    }
    // Far from the limit: no counter, no number in the hint.
    expect(html).not.toContain("characters left");
    expect(html).not.toContain("Up to 2000");
    // Send is never a pale disabled button: an empty note says why instead.
    expect(html).toMatch(/<button type="submit">Send<\/button>/u);
    expect(html).not.toContain("disabled");
    // Cancel then Send, on one row.
    expect(html.indexOf(">Cancel<")).toBeLessThan(html.indexOf(">Send<"));
  });

  it("speaks French when the screen does", () => {
    const html = render(<FeedbackDialog {...idle} />, "fr");

    expect(html).toContain("Envoyer un avis");
    expect(html).toContain("Quelque chose ne marche pas");
    expect(html).not.toContain("Something is broken");
    expect(html).not.toContain("What happened?");
  });

  it("shows a failed send as an alert and keeps the form", () => {
    const html = render(<FeedbackDialog {...idle} problem="The service cannot be reached." />);

    expect(html).toContain('role="alert"');
    expect(html).toContain("The service cannot be reached.");
    expect(html).toContain("<textarea");
  });

  it("marks Send busy while the note is on its way", () => {
    const html = render(<FeedbackDialog {...idle} busy />);

    expect(html).toContain('<button type="submit" aria-disabled="true">Sending…</button>');
  });

  it("thanks the member once the note is sent and gives a reference to quote", () => {
    const html = render(<FeedbackDialog {...idle} sent reference="FB-1A2B3C4D" />);

    expect(html).toContain('role="status"');
    expect(html).toContain("The people who run DraftLoop read every note.");
    expect(html).toContain('<strong class="feedback-reference">FB-1A2B3C4D</strong>');
    expect(html).not.toContain("<textarea");
  });
});

describe("the note's counter and reference (#2876)", () => {
  it("counts the characters left only near the limit", () => {
    expect(feedbackCharactersLeft(0)).toBeUndefined();
    expect(feedbackCharactersLeft(maximumFeedbackLength - 201)).toBeUndefined();
    expect(feedbackCharactersLeft(maximumFeedbackLength - 200)).toBe(200);
    expect(feedbackCharactersLeft(maximumFeedbackLength)).toBe(0);
    expect(feedbackCharactersLeft(maximumFeedbackLength + 5)).toBe(0);
  });

  it("makes a short reference from the note id", () => {
    expect(feedbackReference("1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d")).toBe("FB-1A2B3C4D");
    expect(feedbackReference("ab-cd")).toBe("FB-ABCD");
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

  it("names the server's version above the web build when the server has one", () => {
    const html = render(<FeedbackDialog {...idle} context={context} version="0.26.60" />);

    expect(html).toMatch(
      /<dt>Version<\/dt><dd>0.26.60<\/dd><dt>Web build<\/dt><dd>index-a1b2c3<\/dd>/u,
    );
    expect(render(<FeedbackDialog {...idle} context={context} />)).not.toContain(
      "<dt>Version</dt>",
    );
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
