import { ScreensI18nProvider } from "@draft-loop/ui/i18n";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountMenu } from "./account-menu.js";
import { type ApiClient, ApiRequestError } from "./api-client.js";
import { FeedbackSection, InvitesSection, OperatorPage, WaitlistSection } from "./operator.js";
import {
  canOperate,
  type FeedbackNote,
  inviteFromWaitlist,
  inviteGoesPastCap,
  readFeedback,
  readInvites,
  readWaitlist,
  seatsLeft,
  type WaitlistEntry,
} from "./operator-model.js";

function render(node: ReactNode, locale: "en" | "fr" = "en"): string {
  return renderToStaticMarkup(<ScreensI18nProvider locale={locale}>{node}</ScreensI18nProvider>);
}

const older: WaitlistEntry = {
  entryId: "entry-1",
  email: "ada@example.test",
  consentVersion: "waitlist-2026-11-08",
  joinedAt: "2026-11-10T09:00:00.000Z",
};
const newer: WaitlistEntry = {
  ...older,
  entryId: "entry-2",
  email: "grace@example.test",
  joinedAt: "2026-11-12T09:00:00.000Z",
};

const note: FeedbackNote = {
  noteId: "note-1",
  kind: "note",
  organisationId: "org-alder",
  memberId: "member-ada",
  category: "bug",
  screen: "review",
  text: "The export button\ndoes nothing.",
  transcript: null,
  context: null,
  status: "new",
  issueUrl: null,
  triagedAt: null,
  sentAt: "2026-11-15T10:30:00.000Z",
};

/** A client that answers each route from a table and records what it was asked. */
function fakeClient(answers: Record<string, unknown>, calls: unknown[] = []): ApiClient {
  return {
    call: (async (route: string, init: unknown) => {
      calls.push([route, init]);
      const answer = answers[route];
      if (answer instanceof Error) throw answer;
      return answer;
    }) as ApiClient["call"],
  };
}

const member = {
  kind: "member" as const,
  organisationId: "org-alder",
  memberId: "member-ada",
  role: "owner" as const,
  email: "ada@alder.example.test",
};

describe("who sees the operator page (#2829)", () => {
  it("is the owner token or a member marked as the operator, never another member", () => {
    expect(canOperate({ kind: "owner" })).toBe(true);
    expect(canOperate({ ...member, operator: true })).toBe(true);
    expect(canOperate(member)).toBe(false);
  });

  it("puts Operator in the account menu only for the operator", () => {
    const menu = (me: Parameters<typeof AccountMenu>[0]["me"]) =>
      render(<AccountMenu me={me} onePerson={false} onSignOut={() => {}} onOperator={() => {}} />);

    expect(menu({ ...member, operator: true })).toContain(">Operator</button>");
    expect(menu(member)).not.toContain("Operator");
  });
});

describe("the waitlist", () => {
  it("is read newest first, though the API lists it oldest first", async () => {
    const client = fakeClient({ "GET /v1/operator/waitlist": { entries: [older, newer] } });

    const state = await readWaitlist(client);

    expect(state).toEqual({ kind: "ready", value: [newer, older] });
  });

  it("shows each entry with an Invite button", () => {
    const html = render(
      <WaitlistSection state={{ kind: "ready", value: [newer, older] }} onInvite={() => {}} />,
    );

    expect(html.indexOf("grace@example.test")).toBeLessThan(html.indexOf("ada@example.test"));
    expect(html).toContain('aria-label="Invite ada@example.test"');
    expect(html).toContain("Joined 12 Nov 2026, 09:00 UTC");
  });

  it("says when nobody waits, while it reads, and when reading fails", () => {
    expect(
      render(<WaitlistSection state={{ kind: "ready", value: [] }} onInvite={() => {}} />),
    ).toContain("Nobody is waiting.");
    expect(render(<WaitlistSection state={{ kind: "loading" }} onInvite={() => {}} />)).toContain(
      'role="status"',
    );
    const failed = render(
      <WaitlistSection state={{ kind: "failed", message: "Refused." }} onInvite={() => {}} />,
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Refused.");
  });

  it("speaks French when the screen does", () => {
    const html = render(
      <WaitlistSection state={{ kind: "ready", value: [] }} onInvite={() => {}} />,
      "fr",
    );

    expect(html).toContain("Liste d&#x27;attente");
    expect(html).toContain("Personne n&#x27;attend.");
    expect(html).not.toContain("Nobody is waiting.");
  });
});

describe("inviting from the waitlist", () => {
  it("posts to the entry's invite route and shows the code once", async () => {
    const calls: unknown[] = [];
    const client = fakeClient(
      {
        "POST /v1/operator/waitlist/{entryId}/invite": {
          invite: {
            inviteId: "invite-1",
            email: older.email,
            createdAt: "2026-11-17T08:00:00.000Z",
            state: "open",
          },
          code: "BETA-CODE-1234",
        },
      },
      calls,
    );

    const outcome = await inviteFromWaitlist(client, older);

    expect(calls).toEqual([
      ["POST /v1/operator/waitlist/{entryId}/invite", { path: { entryId: "entry-1" } }],
    ]);
    expect(outcome).toEqual({ kind: "invited", email: older.email, code: "BETA-CODE-1234" });
    const html = render(
      <WaitlistSection
        state={{ kind: "ready", value: [] }}
        outcome={outcome}
        onInvite={() => {}}
      />,
    );
    expect(html).toContain("<code>BETA-CODE-1234</code>");
    expect(html).toContain("it is shown only once");
  });

  it("shows a refusal as an alert", async () => {
    const client = fakeClient({
      "POST /v1/operator/waitlist/{entryId}/invite": new ApiRequestError(
        404,
        "not_found",
        "No waitlist entry has that id.",
      ),
    });

    const outcome = await inviteFromWaitlist(client, older);

    expect(outcome.kind).toBe("failed");
    const html = render(
      <WaitlistSection
        state={{ kind: "ready", value: [] }}
        outcome={outcome}
        onInvite={() => {}}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("No invite for ada@example.test");
  });

  it("disables every Invite button while one invite is being created", () => {
    const html = render(
      <WaitlistSection
        state={{ kind: "ready", value: [newer, older] }}
        inviting="entry-1"
        onInvite={() => {}}
      />,
    );

    expect(html.match(/disabled=""/gu)).toHaveLength(2);
    expect(html).toContain("Inviting…");
  });
});

const seats = { redeemed: 8, open: 2, cap: 10, capSource: "operator" as const, deploymentCap: 25 };

describe("inviting past the cap (#2998)", () => {
  it("counts open invites against the cap", () => {
    expect(inviteGoesPastCap({ redeemed: 8, open: 1, cap: 10 })).toBe(false);
    expect(inviteGoesPastCap({ redeemed: 8, open: 2, cap: 10 })).toBe(true);
    expect(inviteGoesPastCap({ redeemed: 0, open: 0, cap: 0 })).toBe(true);
    expect(seatsLeft({ redeemed: 8, open: 1, cap: 10 })).toBe(1);
    expect(seatsLeft({ redeemed: 11, open: 2, cap: 10 })).toBe(0);
  });

  it("shows the seats above the waitlist and says when the cap is reached", () => {
    const html = render(
      <WaitlistSection
        state={{ kind: "ready", value: [older] }}
        seats={seats}
        onInvite={() => {}}
      />,
    );

    expect(html).toContain(
      "8 of 10 seats used, 2 invites not used yet, 0 left. The cap is reached.",
    );
  });

  it("asks to confirm before an invite past the cap, in place of the button", () => {
    const html = render(
      <WaitlistSection
        state={{ kind: "ready", value: [newer, older] }}
        seats={seats}
        confirming="entry-1"
        onInvite={() => {}}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain(
      "This invite goes past the cap of 10 seats: 8 are used and 2 invites are not used yet. ada@example.test cannot sign up until a seat frees or you raise the cap.",
    );
    expect(html).toContain("Invite anyway");
    expect(html).not.toContain('aria-label="Invite ada@example.test"');
    // The other entry's button waits until the operator answers.
    expect(html.match(/disabled=""/gu)).toHaveLength(1);
  });

  it("speaks French when the screen does", () => {
    const html = render(
      <WaitlistSection
        state={{ kind: "ready", value: [older] }}
        seats={seats}
        confirming="entry-1"
        onInvite={() => {}}
      />,
      "fr",
    );

    expect(html).toContain("Inviter quand même");
    expect(html).toContain("Le plafond est atteint.");
  });
});

describe("the invites", () => {
  const list = {
    redeemed: 3,
    open: 1,
    cap: 50,
    capSource: "deployment" as const,
    deploymentCap: 50,
    invites: [
      {
        inviteId: "invite-1",
        email: "ada@example.test",
        createdAt: "2026-11-01T08:00:00.000Z",
        state: "redeemed" as const,
        redeemedAt: "2026-11-02T08:00:00.000Z",
      },
      {
        inviteId: "invite-2",
        email: "grace@example.test",
        createdAt: "2026-11-03T08:00:00.000Z",
        state: "revoked" as const,
        revokedAt: "2026-11-04T08:00:00.000Z",
      },
      {
        inviteId: "invite-3",
        email: "lin@example.test",
        createdAt: "2026-11-05T08:00:00.000Z",
        state: "open" as const,
      },
    ],
  };

  it("are read newest first with the cap and seats left", async () => {
    const state = await readInvites(fakeClient({ "GET /v1/operator/beta-invites": list }));

    expect(state.kind === "ready" && state.value.invites.map((invite) => invite.inviteId)).toEqual([
      "invite-3",
      "invite-2",
      "invite-1",
    ]);
    expect(seatsLeft({ redeemed: 3, open: 1, cap: 50 })).toBe(46);
    expect(seatsLeft({ redeemed: 60, open: 0, cap: 50 })).toBe(0);
  });

  it("show each invite's state and the seats left", () => {
    const html = render(<InvitesSection state={{ kind: "ready", value: list }} />);

    expect(html).toContain("3 of 50 seats used, 1 invites not used yet, 46 left.");
    expect(html).toContain("This cap comes from the deployment setting.");
    expect(html).toContain("Sent, not used yet");
    expect(html).toContain("Redeemed 2 Nov 2026, 08:00 UTC");
    expect(html).toContain("Revoked 4 Nov 2026, 08:00 UTC");
  });

  it("say so when none was sent", () => {
    const html = render(
      <InvitesSection
        state={{
          kind: "ready",
          value: { ...seats, invites: [], redeemed: 0, open: 0, cap: 50 },
        }}
      />,
    );

    expect(html).toContain("No invite sent yet.");
    expect(html).toContain("0 of 50 seats used, 0 invites not used yet, 50 left.");
    expect(html).toContain("The operator set this cap.");
  });
});

describe("the feedback", () => {
  it("is read newest first", async () => {
    const later = { ...note, noteId: "note-2", sentAt: "2026-11-16T10:30:00.000Z" };
    const state = await readFeedback(
      fakeClient({ "GET /v1/operator/feedback": { notes: [note, later] } }),
    );

    expect(state.kind === "ready" && state.value.map((each) => each.noteId)).toEqual([
      "note-2",
      "note-1",
    ]);
  });

  it("shows each note's kind, screen and text, with no control to change it", () => {
    const support: FeedbackNote = {
      ...note,
      noteId: "note-2",
      kind: "support",
      category: null,
      transcript: [
        { role: "member", text: "How do I export?" },
        { role: "assistant", text: "Open the review." },
      ],
    };
    const html = render(<FeedbackSection state={{ kind: "ready", value: [note, support] }} />);

    expect(html).toContain("Something is broken");
    expect(html).toContain("from review");
    expect(html).toContain("The export button\ndoes nothing.");
    expect(html).toContain("Support ticket");
    expect(html).toContain("How do I export?");
    expect(html).not.toContain("<button");
  });

  it("says so when there is none, and shows a failed read", async () => {
    expect(render(<FeedbackSection state={{ kind: "ready", value: [] }} />)).toContain(
      "No feedback yet.",
    );
    const failed = await readFeedback(
      fakeClient({ "GET /v1/operator/feedback": new ApiRequestError(401, "unauthorised", "No.") }),
    );
    expect(failed.kind).toBe("failed");
  });
});

describe("the operator page", () => {
  it("opens on its three sections, reading, with a way back", () => {
    const html = render(<OperatorPage client={fakeClient({})} onClose={() => {}} />);

    expect(html).toContain("<h1");
    expect(html).toContain("Back to DraftLoop");
    expect(html).toContain("Waitlist");
    expect(html).toContain("Invites");
    expect(html).toContain("Feedback");
    expect(html.match(/role="status"/gu)).toHaveLength(3);
  });
});
