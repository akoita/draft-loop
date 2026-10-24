import type {
  ContentScreeningStatus,
  ContentScreeningStore,
  ContentScreeningSubject,
} from "@draft-loop/storage/content-screening";
import { describe, expect, it } from "vitest";

import { HostedKnowledgeIntakeError } from "./hosted-knowledge-intake.js";
import {
  quarantinedRunMaterial,
  type RunMaterialQuarantineReaders,
  type RunMaterialScreeningReaders,
  unscreenedRunMaterial,
} from "./run-material-quarantine.js";

const brief = {
  workspaceId: "history-1",
  brief: { id: "brief-1", sources: [{ id: "posting" }, { id: "notes" }] },
};

function status(subject: ContentScreeningSubject, quarantined = true): ContentScreeningStatus {
  return {
    id: `result-${subject.sourceId}`,
    subject,
    result: {
      verdict: "flagged",
      signals: ["instruction-override"],
      screeners: [{ id: "rules", version: "1" }],
      screenedAt: "2026-10-24T10:00:00.000Z",
    },
    recordedAt: "2026-10-24T10:00:00.000Z",
    quarantined,
  };
}

const jobSource = (sourceId: string): ContentScreeningSubject => ({
  kind: "job-source",
  workspaceId: "history-1",
  briefId: "brief-1",
  sourceId,
});

const knowledgeVersion = (sourceId: string, sourceVersionId: string): ContentScreeningSubject => ({
  kind: "knowledge-source-version",
  knowledgeBaseId: "base-1",
  sourceId,
  sourceVersionId,
});

/** A store that answers from fixed statuses and records which subjects were asked about. */
function readers(
  options: {
    readonly jobSources?: readonly ContentScreeningStatus[];
    readonly knowledge?: readonly ContentScreeningStatus[];
    readonly latest?: Readonly<Record<string, string>>;
    readonly listSources?: RunMaterialQuarantineReaders["listSources"];
  } = {},
) {
  const asked: ContentScreeningSubject[][] = [];
  const store: Pick<ContentScreeningStore, "quarantined" | "listForKnowledgeBase"> = {
    quarantined: async (subjects) => {
      asked.push([...subjects]);
      return options.jobSources ?? [];
    },
    listForKnowledgeBase: async () => options.knowledge ?? [],
  };
  const latest = options.latest ?? {};
  const listSources: RunMaterialQuarantineReaders["listSources"] =
    "listSources" in options
      ? options.listSources
      : async () =>
          Object.entries(latest).map(([sourceId, versionId]) => ({
            source: { id: sourceId },
            latestVersion: { id: versionId },
          })) as never;
  return { asked, readers: { store, listSources } };
}

describe("quarantined run material", () => {
  it("asks about every source of the brief and lists job sources before knowledge", async () => {
    const { asked, readers: setup } = readers({
      jobSources: [status(jobSource("posting"))],
      knowledge: [status(knowledgeVersion("career", "v2"))],
      latest: { career: "v2" },
    });

    const found = await quarantinedRunMaterial(setup, { brief, knowledgeBaseIds: ["base-1"] });

    expect(asked).toEqual([[jobSource("posting"), jobSource("notes")]]);
    expect(found.map(({ id }) => id)).toEqual(["result-posting", "result-career"]);
  });

  it("counts only the latest version of a knowledge source, and only quarantined ones", async () => {
    const { readers: setup } = readers({
      knowledge: [
        status(knowledgeVersion("career", "v1")),
        status(knowledgeVersion("portfolio", "v1"), false),
        status(knowledgeVersion("letters", "v3")),
      ],
      latest: { career: "v2", portfolio: "v1", letters: "v3" },
    });

    const found = await quarantinedRunMaterial(setup, { knowledgeBaseIds: ["base-1"] });

    expect(found.map(({ id }) => id)).toEqual(["result-letters"]);
  });

  it("checks a base once however often it is selected, and skips a base that is gone", async () => {
    let listed = 0;
    const gone = readers({
      knowledge: [status(knowledgeVersion("career", "v1"))],
      listSources: async () => {
        listed += 1;
        throw new HostedKnowledgeIntakeError("knowledge_base_not_found", "No such knowledge base.");
      },
    });

    expect(
      await quarantinedRunMaterial(gone.readers, { knowledgeBaseIds: ["base-1", "base-1"] }),
    ).toEqual([]);
    expect(listed).toBe(1);

    const failing = readers({
      listSources: async () => {
        throw new Error("database unavailable");
      },
    });
    await expect(
      quarantinedRunMaterial(failing.readers, { knowledgeBaseIds: ["base-1"] }),
    ).rejects.toThrow("database unavailable");
  });

  it("asks nothing of knowledge without a source reader, and nothing of job sources without a brief", async () => {
    const { asked, readers: setup } = readers({
      knowledge: [status(knowledgeVersion("career", "v1"))],
      listSources: undefined,
    });

    expect(await quarantinedRunMaterial(setup, { knowledgeBaseIds: ["base-1"] })).toEqual([]);
    expect(asked).toEqual([]);
  });
});

describe("unscreened run material", () => {
  /** Results as the store lists them: the latest of each subject, clear or not. */
  function screened(
    options: {
      readonly record?: readonly ContentScreeningSubject[];
      readonly knowledge?: readonly ContentScreeningSubject[];
      readonly latest?: Readonly<Record<string, string>>;
      readonly listSources?: RunMaterialScreeningReaders["listSources"];
    } = {},
  ): RunMaterialScreeningReaders {
    const statuses = (subjects: readonly ContentScreeningSubject[] = []) =>
      subjects.map((subject) => ({ ...status(subject, false), quarantined: false }));
    return {
      store: {
        listForRecord: async (workspaceId) =>
          statuses(options.record).filter(
            ({ subject }) => subject.kind === "job-source" && subject.workspaceId === workspaceId,
          ),
        listForKnowledgeBase: async () => statuses(options.knowledge),
      },
      listSources:
        "listSources" in options
          ? options.listSources
          : async () =>
              Object.entries(options.latest ?? {}).map(([sourceId, versionId]) => ({
                source: { id: sourceId },
                latestVersion: { id: versionId },
              })) as never,
    };
  }

  it("lists the brief's sources that have no result, then the latest knowledge versions that have none", async () => {
    const found = await unscreenedRunMaterial(
      screened({
        record: [jobSource("posting")],
        knowledge: [knowledgeVersion("career", "v1"), knowledgeVersion("letters", "v3")],
        latest: { career: "v2", letters: "v3" },
      }),
      { brief, knowledgeBaseIds: ["base-1", "base-1"] },
    );

    expect(found).toEqual([jobSource("notes"), knowledgeVersion("career", "v2")]);
  });

  it("does not count another brief's results of the same record", async () => {
    const other: ContentScreeningSubject = {
      kind: "job-source",
      workspaceId: "history-1",
      briefId: "brief-2",
      sourceId: "posting",
    };

    const found = await unscreenedRunMaterial(screened({ record: [other] }), {
      brief,
      knowledgeBaseIds: [],
    });

    expect(found).toEqual([jobSource("posting"), jobSource("notes")]);
  });

  it("finds nothing when everything has a result, a base is gone, or no source reader is given", async () => {
    expect(
      await unscreenedRunMaterial(
        screened({ record: [jobSource("posting"), jobSource("notes")] }),
        { brief, knowledgeBaseIds: [] },
      ),
    ).toEqual([]);
    const gone = screened({
      listSources: async () => {
        throw new HostedKnowledgeIntakeError("knowledge_base_not_found", "No such knowledge base.");
      },
    });
    expect(await unscreenedRunMaterial(gone, { knowledgeBaseIds: ["base-1"] })).toEqual([]);
    expect(
      await unscreenedRunMaterial(screened({ listSources: undefined }), {
        knowledgeBaseIds: ["base-1"],
      }),
    ).toEqual([]);
  });
});
