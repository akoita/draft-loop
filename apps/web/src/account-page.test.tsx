import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountPage } from "./account-page.js";

describe("account page", () => {
  it("shows the download first, then the deletes in a marked danger zone", () => {
    const html = renderToStaticMarkup(
      <AccountPage
        email="ada@example.test"
        yourData={<p>download here</p>}
        dangerZone={<p>deletes here</p>}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("Signed in as ada@example.test");
    expect(html).toContain(">Back to Redakloop</button>");
    expect(html).toMatch(/Your data<\/h2><p>download here[\s\S]*danger-zone/u);
    const [, danger = ""] = html.split("danger-zone");
    expect(danger).toContain("Danger zone</h2>");
    expect(danger).toContain("cannot be undone");
    expect(danger).toContain("<p>deletes here</p>");
  });

  it("leaves out the sections the person may not use", () => {
    const html = renderToStaticMarkup(<AccountPage onClose={() => {}} />);

    expect(html).not.toContain("Your data");
    expect(html).not.toContain("Danger zone");
  });
});
