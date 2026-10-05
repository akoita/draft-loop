import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultAntiFormulaicTerms } from "@draft-loop/domain";
import { describe, expect, it } from "vitest";
import {
  activateDefaultWritingPolicy,
  activateWritingPolicyContent,
  defaultWritingPolicyContent,
  withDefaultWritingPolicy,
} from "./default-writing-policy.js";
import { createApplicationService } from "./index.js";
import { createLocalApplicationDriver } from "./local.js";

const silent = { write: () => undefined };

async function newRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "draft-loop-dwp-test-"));
  await mkdir(join(root, "evidence"), { recursive: true });
  await writeFile(join(root, "job.md"), "Build TypeScript tools.\n", "utf8");
  await writeFile(join(root, "evidence", "resume.md"), "Built TypeScript tools.\n", "utf8");
  return root;
}

function service() {
  return withDefaultWritingPolicy(createApplicationService(createLocalApplicationDriver()));
}

async function config(root: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(root, ".draft-loop", "workspace.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

async function policyTempEntries(): Promise<string[]> {
  return (await readdir(tmpdir())).filter((name) => name.startsWith("draft-loop-policy-"));
}

describe("default writing policy", () => {
  it("starts a new real workspace with the default policy active", async () => {
    const root = await newRoot();
    try {
      const descriptor = await service().initialize(
        { root, jobDescription: "job.md", sources: "evidence" },
        silent,
      );
      const saved = await config(root);
      expect(saved.writingPolicyChecksum).toMatch(/^[a-f0-9]{64}$/u);
      expect(saved.writingPolicyPath).toBe(".draft-loop/writing-policy.md");
      expect(descriptor.writingPolicyChecksum).toBe(saved.writingPolicyChecksum);
      expect(await readFile(join(root, ".draft-loop", "writing-policy.md"), "utf8")).toBe(
        defaultWritingPolicyContent,
      );

      const checksum = saved.writingPolicyChecksum as string;
      const exact = await createLocalApplicationDriver().getWritingPolicy?.({
        root,
        checksum,
        includeContent: true,
      });
      expect(exact?.policy?.preferences).toMatchObject({
        tone: "professional",
        verbosity: "concise",
        pageTarget: "two-page",
      });
      const rules = exact?.policy?.rules ?? [];
      expect(rules).toContainEqual(
        expect.objectContaining({ kind: "forbidden-characters", characters: "—" }),
      );
      const terms = rules.flatMap((rule) => (rule.kind === "forbidden-term" ? [rule.term] : []));
      expect(terms).toEqual(expect.arrayContaining([...defaultAntiFormulaicTerms]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("leaves a new fixture workspace without a policy", async () => {
    const root = await newRoot();
    try {
      const descriptor = await service().initialize(
        { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
        silent,
      );
      expect(descriptor.writingPolicyChecksum).toBeUndefined();
      expect((await config(root)).writingPolicyChecksum).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not change an existing workspace when it is read again", async () => {
    const root = await newRoot();
    try {
      const plain = createApplicationService(createLocalApplicationDriver());
      await plain.initialize({ root, jobDescription: "job.md", sources: "evidence" }, silent);
      const before = await readFile(join(root, ".draft-loop", "workspace.json"), "utf8");
      const read = await service().readWorkspace(root);
      expect(read.writingPolicyChecksum).toBeUndefined();
      expect(await readFile(join(root, ".draft-loop", "workspace.json"), "utf8")).toBe(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records the default policy version on a run", async () => {
    const root = await newRoot();
    try {
      const wrapped = service();
      await wrapped.initialize({ root, jobDescription: "job.md", sources: "evidence" }, silent);
      const saved = await config(root);
      // Offline run: flip only the execution mode so no provider is needed.
      await writeFile(
        join(root, ".draft-loop", "workspace.json"),
        `${JSON.stringify({ ...saved, fixtureMode: true })}\n`,
        "utf8",
      );
      const snapshot = await wrapped.start({ root }, silent);
      const projection = await wrapped.readRunWritingPolicy?.({ root, runId: snapshot.runId });
      expect(projection?.effective.checksum).toBe(saved.writingPolicyChecksum);
      expect(projection?.lineage.kind).toBe("workspace");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes its temporary file on success and on failure", async () => {
    const root = await newRoot();
    try {
      await service().initialize({ root, jobDescription: "job.md", sources: "evidence" }, silent);
      const before = await policyTempEntries();
      await activateDefaultWritingPolicy(root, silent);
      expect(await policyTempEntries()).toEqual(before);

      const missing = join(root, "missing-workspace");
      await expect(activateDefaultWritingPolicy(missing, silent)).rejects.toThrow();
      expect(await policyTempEntries()).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("saves edited text as a new activated version and keeps the old one", async () => {
    const root = await newRoot();
    try {
      await service().initialize({ root, jobDescription: "job.md", sources: "evidence" }, silent);
      const first = (await config(root)).writingPolicyChecksum as string;
      const edited = defaultWritingPolicyContent.replace("Tone: professional", "Tone: warm");
      await activateWritingPolicyContent(root, edited, silent);
      const second = (await config(root)).writingPolicyChecksum as string;
      expect(second).not.toBe(first);
      expect(await readFile(join(root, ".draft-loop", "writing-policy.md"), "utf8")).toBe(
        `${edited.trim()}\n`,
      );
      const driver = createLocalApplicationDriver();
      const active = await driver.getWritingPolicy?.({ root, includeContent: true });
      expect(active?.checksum).toBe(second);
      expect(active?.policy?.preferences).toMatchObject({ tone: "warm" });
      const versions = await driver.listWritingPolicyVersions?.({ root });
      expect(versions?.map((version) => version.checksum)).toEqual(
        expect.arrayContaining([first, second]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid text with the application message and saves nothing", async () => {
    const root = await newRoot();
    try {
      await service().initialize({ root, jobDescription: "job.md", sources: "evidence" }, silent);
      const before = await readFile(join(root, ".draft-loop", "workspace.json"), "utf8");
      await expect(activateWritingPolicyContent(root, "Tone: sarcastic\n", silent)).rejects.toThrow(
        /tone/iu,
      );
      await expect(activateWritingPolicyContent(root, "   \n", silent)).rejects.toThrow(
        "The writing policy is empty.",
      );
      await expect(
        activateWritingPolicyContent(root, `${"a".repeat(64 * 1024)}b`, silent),
      ).rejects.toThrow("too large");
      expect(await readFile(join(root, ".draft-loop", "workspace.json"), "utf8")).toBe(before);
      const versions = await createLocalApplicationDriver().listWritingPolicyVersions?.({ root });
      expect(versions).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
