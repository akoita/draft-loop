import { ScreensI18nProvider } from "@draft-loop/ui/i18n";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApiClient } from "./api-client.js";
import { readUsageFunnel, type UsageFunnelReport, UsageFunnelView } from "./operator-funnel.js";

function render(node: ReactNode, locale: "en" | "fr" = "en"): string {
  return renderToStaticMarkup(<ScreensI18nProvider locale={locale}>{node}</ScreensI18nProvider>);
}

const steps = {
  signedIn: 2,
  evidence: 1,
  briefReviewed: 1,
  draftFinished: 0,
  approved: 0,
  exported: 0,
  prepared: 0,
};

const funnel: UsageFunnelReport = {
  weeks: [{ weekStart: "2026-11-16", signUps: 3, firsts: steps, activeOrganisations: 2 }],
  cohort: [
    { step: "signedIn", reached: 2, fromPrevious: null },
    { step: "evidence", reached: 1, fromPrevious: 0.5 },
    { step: "briefReviewed", reached: 1, fromPrevious: 1 },
    { step: "draftFinished", reached: 0, fromPrevious: 0 },
    { step: "approved", reached: 0, fromPrevious: 0 },
    { step: "exported", reached: 0, fromPrevious: 0 },
    { step: "prepared", reached: 0, fromPrevious: 0 },
  ],
  organisations: 4,
};

describe("the Usage section (#2834)", () => {
  it("shows where new organisations stop and each week's counts", () => {
    const html = render(<UsageFunnelView state={{ kind: "ready", funnel }} />);

    expect(html).toContain("Where new organisations stop");
    expect(html).toContain('<th scope="row">Added career evidence</th><td>1</td><td>50%</td>');
    expect(html).toContain('<th scope="row">2026-11-16</th><td>3</td>');
    expect(html).toContain("4 organisations read in all.");
  });

  it("speaks French and says when the funnel cannot be read", () => {
    expect(render(<UsageFunnelView state={{ kind: "ready", funnel }} />, "fr")).not.toContain(
      "Where new organisations stop",
    );
    expect(render(<UsageFunnelView state={{ kind: "failed" }} />)).toContain('role="alert"');
  });

  it("asks the API for eight weeks", async () => {
    const calls: unknown[] = [];
    const client: ApiClient = {
      call: (async (route: string, init: unknown) => {
        calls.push([route, init]);
        return funnel;
      }) as ApiClient["call"],
    };
    await expect(readUsageFunnel(client)).resolves.toEqual({ kind: "ready", funnel });
    expect(calls).toEqual([["GET /v1/operator/usage-funnel", { query: { weeks: 8 } }]]);
  });
});
