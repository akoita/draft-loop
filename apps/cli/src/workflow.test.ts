import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteStorage } from "@draft-loop/storage";
import { afterEach, describe, expect, it } from "vitest";
import {
  type CliIo,
  exportRun,
  initWorkspace,
  lifecycleRun,
  recordReviewDecision,
  resumeRun,
  runPilot,
  startRun,
  statusRun,
} from "./workflow.js";

const directories: string[] = [];

async function fixtureWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "draft-loop-cli-"));
  directories.push(root);
  const sourceDirectory = join(root, "evidence");
  await mkdir(sourceDirectory);
  await writeFile(
    join(root, "job.md"),
    "TypeScript systems engineer\nKubernetes operations\n",
    "utf8",
  );
  await writeFile(
    join(sourceDirectory, "resume.md"),
    "Synthetic candidate evidence for TypeScript systems engineering and Kubernetes operations.",
    "utf8",
  );
  return root;
}

function io(): { readonly output: string[]; readonly value: CliIo } {
  const output: string[] = [];
  return { output, value: { write: (line) => output.push(line) } };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("phase-0 CLI workflow", () => {
  it("runs the offline happy path, records approval, and exports locally", async () => {
    const root = await fixtureWorkspace();
    const messages = io();
    await initWorkspace(
      {
        root,
        jobDescription: "job.md",
        sources: "evidence",
        fixtureMode: true,
      },
      messages.value,
    );

    const started = await startRun(root, {}, messages.value);
    expect(started.state).toBe("awaiting-approval");
    expect(messages.output.join("\n")).toContain("Provider pairing: author anthropic/");
    expect(messages.output.join("\n")).not.toContain("Synthetic candidate evidence");
    await recordReviewDecision({
      root,
      runId: started.runId,
      kind: "finding",
      targetId: `${started.runId}:finding:0:unsupported-claim`,
      decision: "overridden",
      rationale: "Candidate verified the claim locally.",
    });
    const startedStorage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
    await expect(startedStorage.getLatestRunSnapshot(started.runId)).resolves.toMatchObject({
      state: "awaiting-approval",
      runId: started.runId,
    });
    await expect(startedStorage.listDecisions(started.runId)).resolves.toEqual([
      expect.objectContaining({
        type: "reject-finding",
        actor: "user:desktop",
        payload: expect.objectContaining({
          findingId: `${started.runId}:finding:0:unsupported-claim`,
        }),
      }),
    ]);
    await startedStorage.close();

    const approved = await lifecycleRun(root, "approve", undefined, messages.value);
    expect(approved.state).toBe("approved");
    const outputPath = await exportRun(root, undefined, undefined, messages.value);
    expect(await readFile(outputPath, "utf8")).toContain("## Summary");
    const docxPath = await exportRun(root, undefined, undefined, messages.value, "docx");
    expect((await readFile(docxPath)).subarray(0, 4).toString("hex")).toBe("504b0304");
    const pdfPath = await exportRun(root, undefined, undefined, messages.value, "pdf");
    expect((await readFile(pdfPath, "utf8")).startsWith("%PDF-1.4")).toBe(true);

    const status = await statusRun(root, undefined, messages.value);
    expect(status?.state).toBe("exported");
    expect(messages.output.join("\n")).toContain("approval=approved");
    const approvedStorage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
    await expect(approvedStorage.getLatestRunSnapshot(started.runId)).resolves.toMatchObject({
      state: "exported",
      runId: started.runId,
    });
    await approvedStorage.close();
  });

  it("does not start live providers without an explicit data-policy approval", async () => {
    const root = await fixtureWorkspace();
    await initWorkspace({ root, jobDescription: "job.md", sources: "evidence" });

    await expect(startRun(root)).rejects.toThrow("Provider execution is disabled by default");
  });

  it("records a revision request and resumes the same durable run", async () => {
    const root = await fixtureWorkspace();
    await initWorkspace({ root, jobDescription: "job.md", sources: "evidence", fixtureMode: true });
    const started = await startRun(root);

    const revision = await lifecycleRun(root, "revision", started.runId);
    expect(revision.state).toBe("revising");
    expect(revision.round).toBe(2);

    const resumed = await resumeRun(root);
    expect(resumed.state).toBe("awaiting-approval");
    expect(resumed.round).toBe(2);
  });

  it("runs the offline phase-zero pilot and writes a redacted validation report", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-pilot-"));
    directories.push(root);
    const messages = io();

    const result = await runPilot(root, messages.value);
    const report = await readFile(result.reportPath, "utf8");

    expect(result.report.status).toBe("passed");
    expect(result.report.initialFindingCount).toBe(1);
    expect(result.report.initialErrorCount).toBe(1);
    expect(result.report.revisedArtifactVersion).toBe(2);
    expect(result.report.finalFindingCount).toBe(0);
    expect(result.report.auditEventCount).toBeGreaterThan(0);
    expect(report).toContain("small, consented pilot");
    expect(report).not.toContain("Synthetic candidate evidence");
    expect(report).not.toContain("systemPrompt");

    const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
    await expect(storage.listExecutions(result.report.runId)).resolves.toHaveLength(4);
    await expect(storage.listFindings(result.report.runId)).resolves.toHaveLength(1);
    await expect(storage.listExports(result.report.runId)).resolves.toHaveLength(1);
    await storage.close();
  });
});
