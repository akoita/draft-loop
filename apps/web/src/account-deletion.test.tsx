import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AccountDeletionPanel,
  accountDeletedNotice,
  accountDeletionRefusal,
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
