import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountMenu, accountInitial } from "./account-menu.js";

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

  it("opens the account page from the menu, and holds no delete itself", () => {
    const html = renderToStaticMarkup(
      <AccountMenu
        me={{ ...coach, plan: { candidateRecords: 1, seats: 1 } }}
        onePerson={true}
        yourData={<p>your data here</p>}
        onAccount={() => {}}
        onSignOut={() => {}}
      />,
    );

    expect(html).toMatch(/your data here[\s\S]*>Account settings<\/button>[\s\S]*Sign out/u);
    expect(html).not.toContain("Delete");
    expect(html).not.toContain("<dialog");
  });

  it("links the privacy policy, terms and legal notice in a new tab (#2462)", () => {
    const html = renderToStaticMarkup(
      <AccountMenu me={coach} onePerson={false} onSignOut={() => {}} />,
    );

    for (const page of ["privacy", "terms", "notice"]) {
      expect(html).toContain(`<a href="/legal/${page}" target="_blank" rel="noopener">`);
    }
    expect(html).toMatch(/Sign out<\/button>[\s\S]*account-menu-legal/u);
  });

  it("links the provider's sign-in security page in a new tab, to set up a passkey", () => {
    const page = "https://id.example.test/realms/draft-loop/account/account-security/signing-in";
    const html = renderToStaticMarkup(
      <AccountMenu me={coach} onePerson={false} signInSecurity={page} onSignOut={() => {}} />,
    );

    expect(html).toMatch(
      new RegExp(
        `<a class="button button-toolbar" href="${page}" target="_blank" rel="noopener noreferrer"[^>]*>Sign-in security</a>[\\s\\S]*Sign out`,
        "u",
      ),
    );
    expect(
      renderToStaticMarkup(<AccountMenu me={coach} onePerson={false} onSignOut={() => {}} />),
    ).not.toContain("Sign-in security");
  });

  it("folds into a round button on a phone, with the shell's actions inside the menu", () => {
    const html = renderToStaticMarkup(
      <AccountMenu
        me={coach}
        onePerson={true}
        compact={true}
        shellActions={<span className="service-status">Service is up</span>}
        onSignOut={() => {}}
      />,
    );

    expect(html).toContain('class="account-menu account-menu-compact"');
    expect(html).toContain('<span class="account-avatar" aria-hidden="true">A</span>');
    expect(html).toContain('<span class="sr-only">Account menu: ada@alder.example.test</span>');
    expect(html).not.toContain('class="account-name"');
    expect(html).toMatch(
      /account-menu-body[\s\S]*account-menu-who">ada@alder\.example\.test[\s\S]*account-menu-shell-actions[\s\S]*Service is up[\s\S]*Sign out/u,
    );
  });

  it("names the round button by the first letter of the email", () => {
    expect(accountInitial(coach)).toBe("A");
    expect(accountInitial({ ...coach, email: " zoé@example.test" })).toBe("Z");
    expect(accountInitial({ kind: "owner" })).toBe("•");
  });

  it("offers to confirm operator access once the second step aged out, not before", () => {
    const confirm = () => Promise.resolve();
    const aged = renderToStaticMarkup(
      <AccountMenu
        me={{ ...coach, operatorRole: true }}
        onePerson={false}
        onSignOut={() => {}}
        onOperator={() => {}}
        onConfirmOperator={confirm}
      />,
    );
    expect(aged).toContain("Confirm operator access");
    expect(aged).not.toContain(">Operator<");

    const fresh = renderToStaticMarkup(
      <AccountMenu
        me={{ ...coach, operatorRole: true, operator: true }}
        onePerson={false}
        onSignOut={() => {}}
        onOperator={() => {}}
        onConfirmOperator={confirm}
      />,
    );
    expect(fresh).toContain(">Operator<");
    expect(fresh).not.toContain("Confirm operator access");

    const member = renderToStaticMarkup(
      <AccountMenu me={coach} onePerson={false} onSignOut={() => {}} onConfirmOperator={confirm} />,
    );
    expect(member).not.toContain("Confirm operator access");
  });
});
