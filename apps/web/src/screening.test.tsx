import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { type ApiClient, ApiRequestError } from "./api-client.js";
import {
  BriefScreening,
  QuarantineList,
  ReleaseDialog,
  type ReleaseDialogProps,
  ScreeningNote,
} from "./screening.js";
import { ReleaseAccess } from "./screening-access.js";
import {
  type QuarantinedMaterial,
  type QuarantineRefusal,
  quarantineRefusal,
  type ScreeningStatus,
} from "./screening-model.js";

const unusedClient: ApiClient = {
  call: async () => {
    throw new Error("not called while rendering");
  },
};

const flagged: ScreeningStatus = {
  kind: "job-source",
  briefId: "brief-1",
  sourceId: "job-posting",
  resultId: "result-1",
  verdict: "flagged",
  signals: ["instruction-override"],
  quarantined: true,
};

const released: ScreeningStatus = {
  ...flagged,
  quarantined: false,
  release: { memberId: "member-1", releasedAt: "2026-10-24T10:00:00.000Z" },
};

const clear: ScreeningStatus = { ...flagged, verdict: "clear", signals: [], quarantined: false };

function note(status: ScreeningStatus | undefined, canRelease: boolean) {
  return renderToStaticMarkup(
    <ReleaseAccess.Provider value={canRelease}>
      <ScreeningNote
        client={unusedClient}
        status={status}
        subject="career.md"
        onReleased={() => {}}
      />
    </ReleaseAccess.Provider>,
  );
}

describe("screening badges on sources and briefs", () => {
  it("shows a quarantined flag as text with its signals, and offers owners a release", () => {
    const html = note(flagged, true);

    expect(html).toContain("screening screening-flagged");
    expect(html).toContain("Quarantined: flagged");
    expect(html).toContain("instruction override");
    expect(html).toContain("Release career.md");
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it("offers a member the status but no release", () => {
    const html = note(flagged, false);

    expect(html).toContain("Quarantined: flagged");
    expect(html).not.toContain("Release career.md");
  });

  it("shows released, clear and unscreened text without a release button", () => {
    expect(note(released, true)).toContain("screening-released");
    expect(note(released, true)).not.toContain("Release career.md");
    expect(note(clear, true)).toContain("Screened: clear");
    expect(note(undefined, true)).toContain("screening-none");
    expect(note(undefined, true)).toContain("Not screened");
    expect(note(undefined, true)).not.toContain("<button");
  });

  it("shows the brief's status, or that it was not screened", () => {
    const shown = renderToStaticMarkup(
      <BriefScreening client={unusedClient} statuses={[flagged]} onReleased={() => {}} />,
    );
    const none = renderToStaticMarkup(
      <BriefScreening client={unusedClient} statuses={[]} onReleased={() => {}} />,
    );

    expect(shown).toContain("Release the job brief");
    expect(none).toContain("Not screened");
  });
});

describe("release dialog", () => {
  const props: ReleaseDialogProps = {
    subject: "career.md",
    signals: "instruction override",
    busy: false,
    problem: undefined,
    onSubmit: () => {},
    onCancel: () => {},
  };

  it("is a labelled dialog with a required reason of up to 500 characters", () => {
    const html = renderToStaticMarkup(<ReleaseDialog {...props} />);

    expect(html).toContain("<dialog");
    expect(html).toContain("aria-labelledby=");
    expect(html).toContain("Release career.md</h3>");
    expect(html).toContain("(instruction override)");
    expect(html).toMatch(/<label for="[^"]+-reason">Reason for releasing<\/label>/u);
    expect(html).toMatch(/<textarea id="[^"]+-reason"[^>]* required=""/u);
    expect(html).toContain('maxLength="500"');
    expect(html).toContain("aria-describedby=");
    expect(html).toContain("up to 500 characters");
    expect(html).toContain('<button type="submit">Release</button>');
    expect(html).toContain('<button type="button" class="secondary">Cancel</button>');
    expect(html).not.toContain('role="alert"');
  });

  it("shows a refusal and disables the release while it is sent", () => {
    const html = renderToStaticMarkup(
      <ReleaseDialog
        {...props}
        busy={true}
        problem="A newer screening result replaced this one."
      />,
    );

    expect(html).toContain('role="alert">A newer screening result replaced this one.</p>');
    expect(html).toContain('<button type="submit" disabled="">Releasing…</button>');
  });
});

describe("a run refused for quarantined material", () => {
  const items: QuarantinedMaterial[] = [
    {
      kind: "job-source",
      briefId: "brief-1",
      sourceId: "job-posting",
      resultId: "result-1",
      verdict: "flagged",
      signals: ["instruction-override"],
    },
    {
      kind: "knowledge-source-version",
      knowledgeBaseId: "kb-1",
      sourceId: "source-1",
      sourceVersionId: "version-1",
      resultId: "result-2",
      verdict: "unscreened",
      signals: ["screener-unavailable"],
    },
  ];
  const refusal = quarantineRefusal(
    new ApiRequestError(409, "material_quarantined", "Quarantined.", items),
  ) as QuarantineRefusal;

  function list(canRelease: boolean, released: readonly string[] = []) {
    return renderToStaticMarkup(
      <QuarantineList
        client={unusedClient}
        message={refusal.message}
        items={refusal.items}
        released={new Set(released)}
        canRelease={canRelease}
        allReleased={refusal.items.every((item) => released.includes(item.resultId))}
        onReleased={() => {}}
      />,
    );
  }

  it("says which brief and sources are quarantined, with a release for each to owners", () => {
    const html = list(true);

    expect(html).toContain('role="alert">This run was not started.');
    expect(html).toContain("the job brief and 1 knowledge source");
    expect(html).toContain("The job brief");
    expect(html).toContain("The knowledge source source-1 in kb-1");
    expect(html).toContain("Quarantined: flagged");
    expect(html).toContain("Quarantined: not screened");
    expect(html).toContain("Release the job brief");
    expect(html).toContain("Release the knowledge source source-1 in kb-1");
    expect(html).not.toContain("Ask one of");
  });

  it("tells a member to ask an owner or admin, with no release", () => {
    const html = list(false);

    expect(html).not.toContain("<button");
    expect(html).toContain("Only owners and admins of your organisation release quarantined");
  });

  it("marks released pieces, and says to start again once all are", () => {
    const some = list(true, ["result-1"]);
    const all = list(true, ["result-1", "result-2"]);

    expect(some).toContain("screening-released");
    expect(some).toContain("Release the knowledge source source-1 in kb-1");
    expect(some).not.toContain("Everything is released");
    expect(all).toContain('role="status">Everything is released. Start the run again.');
    expect(all).not.toContain("<button");
  });
});
