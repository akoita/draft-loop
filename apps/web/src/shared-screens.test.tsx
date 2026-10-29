import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { type ApiClient, ApiRequestError } from "./api-client.js";
import { RefusalNotice } from "./shared-screens.js";

const unusedClient: ApiClient = {
  call: async () => {
    throw new Error("not called while rendering");
  },
};

const notice = (refusal: ApiRequestError) =>
  renderToStaticMarkup(
    <RefusalNotice client={unusedClient} refusal={refusal} onDismiss={() => {}} />,
  );

describe("the notice for a refused request", () => {
  it("lists the quarantined job post with a release, under the refusal's own words", () => {
    const html = notice(
      new ApiRequestError(409, "material_quarantined", "Quarantined.", [
        {
          kind: "job-source",
          briefId: "brief-1",
          sourceId: "job-posting",
          resultId: "result-1",
          verdict: "flagged",
          signals: ["instruction-override"],
        },
      ]),
    );

    expect(html).toContain("quarantine-refusal");
    expect(html).toContain("The job brief");
    expect(html).toContain("Quarantined: flagged");
    expect(html).toContain("Release the job brief");
    expect(html).toContain("Dismiss");
  });

  it("shows only the message for any other refusal", () => {
    const html = notice(new ApiRequestError(409, "run_cap_reached", "The daily cap is reached."));

    expect(html).not.toContain("quarantine-refusal");
    expect(html).toContain("Dismiss");
  });
});
