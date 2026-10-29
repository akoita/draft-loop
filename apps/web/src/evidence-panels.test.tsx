import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApiClient, ApiSchemas } from "./api-client.js";
import { ConsentPanel } from "./consent.js";
import type { Consents } from "./consent-model.js";
import { evidenceHostPanels, FileChecksPanel, type FileGroup } from "./evidence-panels.js";
import { ScreeningNote } from "./screening.js";
import { ReleaseAccess } from "./screening-access.js";
import { type ScreeningStatus, sourceStatus } from "./screening-model.js";
import { syntheticConsents } from "./test-fixtures.js";

const unusedClient: ApiClient = {
  call: async () => {
    throw new Error("not called while rendering");
  },
};

const source = (id: string, displayName: string): ApiSchemas["KnowledgeSource"] => ({
  id,
  knowledgeBaseId: "kb-1",
  displayName,
  kind: "file",
  versionId: `${id}-version`,
  mediaType: "text/markdown",
  sizeBytes: 2048,
  checksum: "0".repeat(64),
  createdAt: "2026-10-23T00:00:00.000Z",
});

const groups: readonly FileGroup[] = [
  {
    base: {
      id: "kb-1",
      displayName: "Sample career facts",
      description: "",
      state: "active",
      createdAt: "2026-10-23T00:00:00.000Z",
      archivedAt: null,
    },
    sources: [source("s1", "sample-career-facts.md"), source("s2", "sample-notes.md")],
  },
];

const statuses: readonly ScreeningStatus[] = [
  {
    kind: "knowledge-source-version",
    knowledgeBaseId: "kb-1",
    sourceId: "s1",
    sourceVersionId: "s1-version",
    resultId: "result-1",
    verdict: "clear",
    signals: [],
    quarantined: false,
  },
  {
    kind: "knowledge-source-version",
    knowledgeBaseId: "kb-1",
    sourceId: "s2",
    sourceVersionId: "s2-version",
    resultId: "result-2",
    verdict: "flagged",
    signals: ["hidden-text"],
    quarantined: true,
  },
];

function fileChecks(canRelease: boolean) {
  return renderToStaticMarkup(
    <ReleaseAccess.Provider value={canRelease}>
      <FileChecksPanel
        groups={groups}
        details={(item) => (
          <ScreeningNote
            client={unusedClient}
            status={sourceStatus(statuses, item)}
            subject={item.displayName}
            onReleased={() => {}}
          />
        )}
      />
    </ReleaseAccess.Provider>,
  );
}

describe("storage permission on the Career evidence page", () => {
  it("is asked above the evidence in sign-in mode only", () => {
    const signIn = evidenceHostPanels(unusedClient, "sign-in", undefined);
    const owner = evidenceHostPanels(unusedClient, "owner", undefined);

    expect(renderToStaticMarkup(signIn.evidenceBefore)).toContain(
      "Reading the candidate&#x27;s consents",
    );
    expect(owner.evidenceBefore).toBeUndefined();
  });

  it("reads as one line once granted, and keeps the withdrawal", () => {
    const html = renderToStaticMarkup(
      <ConsentPanel
        kind="material-storage"
        consents={syntheticConsents}
        providers={["anthropic", "openai"]}
        messages={[]}
        busy={false}
        compact
        onGrant={() => {}}
        onWithdraw={() => {}}
        locale="en-GB"
      />,
    );

    expect(html).toContain("Permission to store this material");
    expect(html).toContain("Granted on");
    expect(html).toContain("Withdraw consent");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("DraftLoop stores the CVs");
  });

  it("asks with the form while no permission is recorded", () => {
    const none: Consents = {
      current: { "material-storage": null, "provider-transmission": null },
      history: [],
    };
    const html = renderToStaticMarkup(
      <ConsentPanel
        kind="material-storage"
        consents={none}
        providers={["anthropic", "openai"]}
        messages={[]}
        busy={false}
        compact
        onGrant={() => {}}
        onWithdraw={() => {}}
      />,
    );

    expect(html).toContain("Permission to store this material");
    expect(html).toContain("Record consent");
  });
});

describe("file checks on the Career evidence page", () => {
  it("is offered in both modes, below the knowledge panel", () => {
    for (const mode of ["owner", "sign-in"] as const) {
      const panels = evidenceHostPanels(unusedClient, mode, undefined);
      expect(panels.evidenceAfter?.({ revision: 0 })).toBeDefined();
    }
  });

  it("lists each file with its screening chip", () => {
    const html = fileChecks(false);

    expect(html).toContain("File checks");
    expect(html).toContain("sample-career-facts.md");
    expect(html).toContain("Screened: clear");
    expect(html).toContain("sample-notes.md");
    expect(html).toContain("Quarantined: flagged");
    expect(html).not.toContain("Release sample-notes.md");
  });

  it("offers the release control for a quarantined file to those who may release", () => {
    const html = fileChecks(true);

    expect(html).toContain("Release sample-notes.md");
    expect(html).not.toContain("Release sample-career-facts.md");
  });

  it("says when the selected bases have no files, and while reading", () => {
    const empty = renderToStaticMarkup(<FileChecksPanel groups={[]} details={() => null} />);
    expect(empty).toContain("No files in the selected knowledge bases yet.");

    const reading = renderToStaticMarkup(
      <FileChecksPanel groups={undefined} details={() => null} />,
    );
    expect(reading).toContain("Reading your files");
  });
});
