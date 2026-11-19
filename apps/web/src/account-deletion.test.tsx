import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AccountDeletionPanel,
  accountDeletedNotice,
  accountDeletionRefusal,
  isAccountDeletionConfirmed,
} from "./account-deletion.js";
import { ApiRequestError } from "./api-client.js";

describe("account deletion", () => {
  it("asks for the sign-in address typed back and says what goes", () => {
    const html = renderToStaticMarkup(
      <AccountDeletionPanel
        email="ada@example.test"
        busy={false}
        problem={undefined}
        onDelete={() => {}}
      />,
    );
    expect(html).toContain("your sign-in and your beta place, for good");
    expect(html).toContain('<label for="delete-account-confirm">');
    expect(html).toContain("ada@example.test");
    expect(html).toContain('type="email"');
    expect(html).toContain("Delete my account");
    expect(html).not.toContain('role="alert"');
    // One line on the page; the warning and the typed address wait in the dialog.
    const [menu = "", dialog = ""] = html.split("<dialog");
    expect(menu).toContain('class="danger-link">Delete my account…</button>');
    expect(menu).not.toContain("for good");
    expect(dialog).toContain("delete-account-confirm");
  });

  it("keeps the final delete disabled until the sign-in address is typed back", () => {
    const html = renderToStaticMarkup(
      <AccountDeletionPanel
        email="ada@example.test"
        busy={false}
        problem={undefined}
        onDelete={() => {}}
      />,
    );
    expect(html).toContain('<button type="submit" class="danger" disabled="">Delete my account');
    expect(isAccountDeletionConfirmed("", "ada@example.test")).toBe(false);
    expect(isAccountDeletionConfirmed("ada@example", "ada@example.test")).toBe(false);
    expect(isAccountDeletionConfirmed(" Ada@Example.test ", "ada@example.test")).toBe(true);
  });

  it("shows the refusal and a busy button while deleting", () => {
    const html = renderToStaticMarkup(
      <AccountDeletionPanel
        email="ada@example.test"
        busy={true}
        problem="A draft is being written."
        onDelete={() => {}}
      />,
    );
    expect(html).toContain("Deleting your account…");
    expect(html).toContain('role="alert"');
    expect(html).toContain("disabled");
  });

  it("turns the API's refusals into the person's words", () => {
    const refusal = (code: string) => accountDeletionRefusal(new ApiRequestError(409, code, code));
    expect(refusal("run_active")).toContain("A draft is being written");
    expect(refusal("organisation_has_members")).toContain("Other people share");
    expect(refusal("confirmation_mismatch")).toContain("Type the email address");
  });

  it("says goodbye, and says when the sign-in remains for now", () => {
    expect(accountDeletedNotice("deleted")).toContain("Your account and everything");
    expect(accountDeletedNotice("kept")).toContain("could not be removed yet");
  });
});
