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
