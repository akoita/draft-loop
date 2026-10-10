import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliUserError } from "./cli-user-error.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";
import { createSourceEvidenceKindService } from "./source-evidence-kind-service.js";

const markdownCv = [
  "# Alex Example",
  "alex@example.test | Paris",
  "",
  "## Summary",
  "Data engineer with a focus on reliable pipelines.",
  "",
  "## Experience",
  "### Fictional Works Ltd - Senior Data Engineer",
  "Jan 2021 - Present",
  "- Led the billing pipeline migration",
  "- Mentored two engineers",
  "- Reduced nightly job time",
  "### Example Analytics - Data Engineer",
  "2018 - 2020",
  "- Built ingestion jobs",
  "- Wrote the on-call runbook",
  "",
  "## Education",
  "University of Example, 2014 - 2018",
  "",
  "## Skills",
  "Python, SQL, Airflow",
  "",
].join("\n");

const transcript = [
  "Interviewer: Thanks for joining. Can you walk me through your last project?",
  "Alex Example: Sure. I led the migration of the billing pipeline.",
  "Interviewer: What was the hardest part?",
  "Alex Example: Coordinating the cutover with three teams.",
  "Interviewer: How did you measure success?",
  "Alex Example: Error rates dropped and the nightly job finished earlier.",
  "",
].join("\n");

describe("source evidence kind service", () => {
  let directory: string;
  let storeRoot: string;
  let knowledgeBaseId: string;
  let cvSourceId: string;
  let transcriptSourceId: string;
  let cvPath: string;
  const knowledge = createCandidateKnowledgeStoreService();
  let tick = 0;
  const service = createSourceEvidenceKindService({
    now: () => new Date(Date.UTC(2030, 0, 1, 0, 0, tick++)).toISOString(),
  });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "draft-loop-evidence-kind-"));
    storeRoot = join(directory, "store");
    tick = 0;
    const view = await knowledge.initializeStore({ storeRoot });
    const base = view.knowledgeBases[0];
    if (base === undefined) throw new Error("expected a default knowledge base");
    knowledgeBaseId = base.id;
    cvPath = join(directory, "alex-cv.md");
    await writeFile(cvPath, markdownCv, "utf8");
    cvSourceId = (
      await knowledge.importKnowledgeSourceFile({
        storeRoot,
        knowledgeBaseId,
        sourcePath: cvPath,
      })
    ).source.id;
    const transcriptPath = join(directory, "interview.txt");
    await writeFile(transcriptPath, transcript, "utf8");
    transcriptSourceId = (
      await knowledge.importKnowledgeSourceFile({
        storeRoot,
        knowledgeBaseId,
        sourcePath: transcriptPath,
      })
    ).source.id;
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const base = () => ({ storeRoot, knowledgeBaseId });
  const kindsBySource = async () =>
    Object.fromEntries(
      (await service.listSourceEvidenceKinds(base())).map((entry) => [entry.sourceId, entry]),
    );

  it("lists the detected kind of every source without writing anything", async () => {
    const entries = await kindsBySource();
    expect(entries[cvSourceId]).toMatchObject({ kind: "cv", origin: "detected" });
    expect(entries[transcriptSourceId]).toMatchObject({ kind: "transcript", origin: "detected" });
    expect(entries[cvSourceId]?.confidence).toBeGreaterThan(0);
    expect(entries[cvSourceId]?.signals?.length).toBeGreaterThan(0);
    expect(JSON.stringify(entries)).not.toContain("billing pipeline");
  });

  it("lets an override win, then returns to detection when cleared", async () => {
    const set = await service.setSourceEvidenceKind({
      ...base(),
      sourceId: cvSourceId,
      kind: "performance-review",
    });
    expect(set).toMatchObject({ sourceId: cvSourceId, kind: "performance-review", origin: "user" });
    expect(set).not.toHaveProperty("confidence");
    const entries = await kindsBySource();
    expect(entries[cvSourceId]).toMatchObject({ kind: "performance-review", origin: "user" });
    expect(entries[transcriptSourceId]).toMatchObject({ kind: "transcript", origin: "detected" });

    const repeated = await service.setSourceEvidenceKind({
      ...base(),
      sourceId: cvSourceId,
      kind: "performance-review",
    });
    expect(repeated.origin).toBe("user");

    const cleared = await service.setSourceEvidenceKind({
      ...base(),
      sourceId: cvSourceId,
      kind: null,
    });
    expect(cleared).toMatchObject({ kind: "cv", origin: "detected" });
    expect((await kindsBySource())[cvSourceId]).toMatchObject({ kind: "cv", origin: "detected" });
  });

  it("rejects an unknown kind, an unknown source and an unknown knowledge base", async () => {
    await expect(
      service.setSourceEvidenceKind({
        ...base(),
        sourceId: cvSourceId,
        kind: "resume" as never,
      }),
    ).rejects.toThrow(CliUserError);
    await expect(
      service.setSourceEvidenceKind({ ...base(), sourceId: "missing", kind: "cv" }),
    ).rejects.toThrow(CliUserError);
    await expect(
      service.setSourceEvidenceKind({
        storeRoot,
        knowledgeBaseId: "missing",
        sourceId: cvSourceId,
        kind: "cv",
      }),
    ).rejects.toThrow(CliUserError);
    await expect(
      service.listSourceEvidenceKinds({ storeRoot, knowledgeBaseId: "missing" }),
    ).rejects.toThrow(CliUserError);
    expect((await kindsBySource())[cvSourceId]?.origin).toBe("detected");
  });

  it("keeps an override across a source refresh and re-detects the new version", async () => {
    await service.setSourceEvidenceKind({ ...base(), sourceId: transcriptSourceId, kind: "notes" });
    const before = (await kindsBySource())[cvSourceId];

    await writeFile(cvPath, transcript, "utf8");
    await knowledge.refreshKnowledgeSourceFromOrigin({
      storeRoot,
      knowledgeBaseId,
      sourceId: cvSourceId,
    });
    const afterRefresh = await kindsBySource();
    expect(afterRefresh[cvSourceId]?.versionId).not.toBe(before?.versionId);
    expect(afterRefresh[cvSourceId]).toMatchObject({ kind: "transcript", origin: "detected" });

    await service.setSourceEvidenceKind({ ...base(), sourceId: cvSourceId, kind: "cv" });
    await writeFile(cvPath, `${markdownCv}\n- Added a final synthetic line\n`, "utf8");
    await knowledge.refreshKnowledgeSourceFromOrigin({
      storeRoot,
      knowledgeBaseId,
      sourceId: cvSourceId,
    });
    const refreshedAgain = await kindsBySource();
    expect(refreshedAgain[cvSourceId]).toMatchObject({ kind: "cv", origin: "user" });
    expect(refreshedAgain[cvSourceId]?.versionId).not.toBe(afterRefresh[cvSourceId]?.versionId);
    expect(refreshedAgain[transcriptSourceId]).toMatchObject({ kind: "notes", origin: "user" });
  });

  it("omits retired sources and refuses to override them", async () => {
    await service.setSourceEvidenceKind({ ...base(), sourceId: cvSourceId, kind: "cv" });
    await knowledge.retireKnowledgeSource({ ...base(), sourceId: cvSourceId });
    const entries = await kindsBySource();
    expect(entries[cvSourceId]).toBeUndefined();
    expect(entries[transcriptSourceId]).toBeDefined();
    await expect(
      service.setSourceEvidenceKind({ ...base(), sourceId: cvSourceId, kind: "notes" }),
    ).rejects.toThrow(CliUserError);
  });
});
