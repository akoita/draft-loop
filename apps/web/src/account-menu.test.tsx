import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountMenu } from "./account-menu.js";

const coach = {
  kind: "member" as const,
  organisationId: "org-alder",
  memberId: "member-ada",
  role: "owner" as const,
  email: "ada@alder.example.test",
  organisationName: "Alder coaching",
  plan: { candidateRecords: 25, seats: null },
};

describe("account menu (#2861)", () => {
  it("says who is signed in and which team they act for, with sign-out inside", () => {
    const html = renderToStaticMarkup(
      <AccountMenu me={coach} onePerson={false} onSignOut={() => {}} />,
    );

    expect(html).toContain(
      '<span class="account-name">ada@alder.example.test · Alder coaching</span>',
    );
    expect(html).toMatch(/account-menu-body[\s\S]*Sign out<\/button>/u);
  });

  it("names no team on a plan for one person, and holds their data", () => {
    const html = renderToStaticMarkup(
      <AccountMenu
        me={{ ...coach, plan: { candidateRecords: 1, seats: 1 } }}
        onePerson={true}
        yourData={<p>your data here</p>}
        onSignOut={() => {}}
      />,
    );

    expect(html).toContain('<span class="account-name">ada@alder.example.test</span>');
    expect(html).not.toContain("Alder coaching");
    expect(html).toContain("<p>your data here</p>");
  });
});
