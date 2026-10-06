import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContextSnapshot } from "@draft-loop/domain";
import type { JsonObject, ModelRequest, ModelResponse } from "@draft-loop/providers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { candidateKnowledgeRuntimeRetrieval } from "./candidate-knowledge-retrieval.js";
import {
  candidateKnowledgeRequestGuard,
  sensitivityRequestRefusedMessage,
} from "./candidate-knowledge-sensitivity-exclusion.js";
import { canonicalProfileExcludedSensitivityTiers } from "./canonical-profile-sensitivity-filter.js";
import { CliUserError } from "./cli-user-error.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";
import { createLocalApplicationDriver } from "./local.js";
import { runSensitivityExclusions } from "./run-sensitivity-exclusions.js";
import {
  excludedSensitivityTiersForConsent,
  excludedSensitivityTiersForWorkspace,
  readSensitiveKnowledgeConsent,
  sensitiveKnowledgeConsentFilename,
  sensitiveKnowledgeConsentInvalidMessage,
  setSensitiveKnowledgeConsent,
} from "./sensitive-knowledge-consent.js";
import { createSensitiveKnowledgeConsentService } from "./sensitive-knowledge-consent-service.js";
import { createSourceSensitivityService } from "./source-sensitivity-service.js";

const neverShareMarker = "alpha7731";
const neverShareLine = `Fictional salary history ${neverShareMarker} for the synthetic former employer.`;
const sensitiveMarker = "zeta4410";
const sensitiveLine = `Synthetic contact detail ${sensitiveMarker} about the fictional person.`;
const normalLine = "Maintained fictional service pipelines with careful reliability work.";

const markdown = [
  "# Fictional Candidate",
  "Opening line about platform engineering and reliable operations.",
  "",
  "## Experience",
  normalLine,
  "",
  "## Compensation",
  neverShareLine,
  "",
  "## Contact",
  sensitiveLine,
  "",
].join("\n");
const neverShareSectionLength = "## Compensation\n".length + neverShareLine.length + 2;
const sensitiveSectionLength = "## Contact\n".length + sensitiveLine.length;

const silent = { write: () => undefined };

describe("sensitive knowledge consent", () => {
  const directories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
    );
  });

  async function temporaryDirectory(prefix = "draft-loop-consent-"): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), prefix));
    directories.push(directory);
    return directory;
  }

  async function bareWorkspace(): Promise<string> {
    const root = await temporaryDirectory();
    await mkdir(join(root, ".draft-loop"), { recursive: true });
    await writeFile(join(root, ".draft-loop", "workspace.json"), "{}", "utf8");
    return root;
  }

  const consentFile = (root: string) =>
    join(root, ".draft-loop", sensitiveKnowledgeConsentFilename);

  describe("policy and file", () => {
    it("always excludes never-share and excludes sensitive unless consent is on", () => {
      expect([...excludedSensitivityTiersForConsent(false)].sort()).toEqual([
        "never-share",
        "sensitive",
      ]);
      expect([...excludedSensitivityTiersForConsent(true)]).toEqual(["never-share"]);
      expect(canonicalProfileExcludedSensitivityTiers).toEqual(
        excludedSensitivityTiersForConsent(false),
      );
    });

    it("treats a missing file as no consent", async () => {
      const root = await temporaryDirectory();
      await expect(readSensitiveKnowledgeConsent(root)).resolves.toEqual({
        allowSensitive: false,
        updatedAt: null,
      });
      expect([...(await excludedSensitivityTiersForWorkspace(root))].sort()).toEqual([
        "never-share",
        "sensitive",
      ]);
    });

    it("writes atomically, reads back, and can be reset", async () => {
      const root = await bareWorkspace();
      const allowed = await setSensitiveKnowledgeConsent(
        root,
        true,
        () => "2030-01-02T03:04:05.000Z",
      );
      expect(allowed).toEqual({ allowSensitive: true, updatedAt: "2030-01-02T03:04:05.000Z" });
      expect(JSON.parse(await readFile(consentFile(root), "utf8"))).toEqual({
        schemaVersion: 1,
        allowSensitive: true,
        updatedAt: "2030-01-02T03:04:05.000Z",
      });
      await expect(readSensitiveKnowledgeConsent(root)).resolves.toEqual(allowed);
      expect([...(await excludedSensitivityTiersForWorkspace(root))]).toEqual(["never-share"]);
      await setSensitiveKnowledgeConsent(root, false);
      expect((await readSensitiveKnowledgeConsent(root)).allowSensitive).toBe(false);
      expect((await readdir(join(root, ".draft-loop"))).sort()).toEqual([
        sensitiveKnowledgeConsentFilename,
        "workspace.json",
      ]);
    });

    it("refuses to write outside a workspace or with a non-boolean value", async () => {
      const root = await temporaryDirectory();
      await expect(setSensitiveKnowledgeConsent(root, true)).rejects.toThrow(
        /No DraftLoop workspace found/u,
      );
      const workspace = await bareWorkspace();
      await expect(
        setSensitiveKnowledgeConsent(workspace, "yes" as unknown as boolean),
      ).rejects.toBeInstanceOf(CliUserError);
      await expect(readdir(join(workspace, ".draft-loop"))).resolves.toEqual(["workspace.json"]);
    });

    it.each([
      ["malformed JSON", "{not json"],
      ["an empty file", ""],
      ["an array", "[]"],
      ["a null value", "null"],
      [
        "an unknown schema version",
        '{"schemaVersion":2,"allowSensitive":true,"updatedAt":"2030-01-01T00:00:00.000Z"}',
      ],
      [
        "a non-boolean flag",
        '{"schemaVersion":1,"allowSensitive":"true","updatedAt":"2030-01-01T00:00:00.000Z"}',
      ],
      ["a missing timestamp", '{"schemaVersion":1,"allowSensitive":true}'],
      ["a bad timestamp", '{"schemaVersion":1,"allowSensitive":true,"updatedAt":"yesterday"}'],
      [
        "an unknown field",
        '{"schemaVersion":1,"allowSensitive":true,"updatedAt":"2030-01-01T00:00:00.000Z","x":1}',
      ],
    ])("fails closed with an error for %s", async (_label, content) => {
      const root = await bareWorkspace();
      await writeFile(consentFile(root), content, "utf8");
      const error = await readSensitiveKnowledgeConsent(root).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(CliUserError);
      expect((error as Error).message).toBe(sensitiveKnowledgeConsentInvalidMessage);
      await expect(excludedSensitivityTiersForWorkspace(root)).rejects.toBeInstanceOf(CliUserError);
    });

    it("fails closed when the consent path is not a readable file", async () => {
      const root = await bareWorkspace();
      await mkdir(consentFile(root));
      await expect(readSensitiveKnowledgeConsent(root)).rejects.toBeInstanceOf(CliUserError);
    });
  });

  describe("with a real knowledge base", () => {
    const knowledge = createCandidateKnowledgeStoreService();
    const sensitivity = createSourceSensitivityService();

    async function fixture() {
      const directory = await temporaryDirectory("draft-loop-consent-kb-");
      const storeRoot = join(directory, "store");
      const view = await knowledge.initializeStore({ storeRoot });
      const knowledgeBaseId = view.knowledgeBases[0]?.id ?? "";
      const sourcePath = join(directory, "history.md");
      await writeFile(sourcePath, markdown, "utf8");
      await knowledge.importKnowledgeSourceFile({ storeRoot, knowledgeBaseId, sourcePath });
      await sensitivity.addSensitivityRule({
        storeRoot,
        knowledgeBaseId,
        rule: { tier: "never-share", match: { kind: "heading-contains", text: "compensation" } },
      });
      await sensitivity.addSensitivityRule({
        storeRoot,
        knowledgeBaseId,
        rule: { tier: "sensitive", match: { kind: "heading-contains", text: "contact" } },
      });
      const selection = await knowledge.createKnowledgeSelectionSnapshot({
        selections: [{ storeRoot, knowledgeBaseId }],
      });
      const config = { candidateKnowledgeSelection: { entries: [{ storeRoot, knowledgeBaseId }] } };
      const context = { candidateKnowledgeSelection: selection };
      return { directory, storeRoot, knowledgeBaseId, selection, config, context };
    }

    async function retrievedText(
      root: string,
      subject: Awaited<ReturnType<typeof fixture>>,
    ): Promise<string> {
      const withheld = await runSensitivityExclusions(root, subject.config, subject.context);
      const runtime = candidateKnowledgeRuntimeRetrieval(
        { appendCandidateKnowledgeRetrievalTrace: async (input) => input as never },
        {
          id: "workspace-consent",
          requiredSections: ["Experience"],
          ...subject.config,
        },
        subject.context as ContextSnapshot,
        withheld,
      );
      if (runtime === undefined) throw new Error("Expected retrieval.");
      const result = await runtime.inspect(
        `salary history ${neverShareMarker} contact ${sensitiveMarker} platform reliability`,
      );
      return result.hits.map(({ text }) => text).join("\n");
    }

    async function guardOutcome(root: string, subject: Awaited<ReturnType<typeof fixture>>) {
      const withheld = await runSensitivityExclusions(root, subject.config, subject.context);
      const execute = vi.fn(async () => ({ output: {} }) as unknown as ModelResponse<JsonObject>);
      const adapter = candidateKnowledgeRequestGuard(
        subject.config,
        subject.context,
        withheld,
      )({ execute });
      const send = async (line: string): Promise<"sent" | "refused"> => {
        try {
          await adapter.execute({
            input: { evidence: [line] },
          } as unknown as ModelRequest<JsonObject>);
          return "sent";
        } catch (error) {
          expect((error as Error).message).toBe(sensitivityRequestRefusedMessage);
          return "refused";
        }
      };
      return { send, execute };
    }

    it("run retrieval and the request guard follow the workspace consent", async () => {
      const subject = await fixture();
      const root = await bareWorkspace();

      // Consent off (missing file): both tiers are withheld on both paths.
      let text = await retrievedText(root, subject);
      expect(text).toContain("careful reliability work");
      expect(text).not.toContain(neverShareMarker);
      expect(text).not.toContain(sensitiveMarker);
      let guard = await guardOutcome(root, subject);
      expect(await guard.send(neverShareLine)).toBe("refused");
      expect(await guard.send(sensitiveLine)).toBe("refused");
      expect(await guard.send(normalLine)).toBe("sent");

      // Consent on: sensitive passes both paths, never-share still does not.
      await setSensitiveKnowledgeConsent(root, true);
      text = await retrievedText(root, subject);
      expect(text).toContain(sensitiveMarker);
      expect(text).not.toContain(neverShareMarker);
      guard = await guardOutcome(root, subject);
      expect(await guard.send(neverShareLine)).toBe("refused");
      expect(await guard.send(sensitiveLine)).toBe("sent");

      // Consent withdrawn: sensitive is withheld again.
      await setSensitiveKnowledgeConsent(root, false);
      text = await retrievedText(root, subject);
      expect(text).not.toContain(sensitiveMarker);
      guard = await guardOutcome(root, subject);
      expect(await guard.send(sensitiveLine)).toBe("refused");
    });

    it("stops the run setup on a corrupt consent file and skips the file without a selection", async () => {
      const subject = await fixture();
      const root = await bareWorkspace();
      await writeFile(consentFile(root), "{corrupt", "utf8");
      await expect(runSensitivityExclusions(root, subject.config, subject.context)).rejects.toThrow(
        sensitiveKnowledgeConsentInvalidMessage,
      );
      await expect(runSensitivityExclusions(root, {}, {})).resolves.toBeUndefined();
    });

    it("counts withheld sections and characters under the current and the opposite consent", async () => {
      const subject = await fixture();
      const root = await temporaryDirectory("draft-loop-consent-ws-");
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "Build reliable synthetic tools.\n", "utf8");
      await writeFile(join(root, "evidence", "resume.md"), "Synthetic resume.\n", "utf8");
      const driver = createLocalApplicationDriver();
      await driver.initialize({ root, jobDescription: "job.md", sources: "evidence" }, silent);
      const entry = subject.selection.entries[0];
      if (entry === undefined) throw new Error("Expected a selection entry.");
      const service = createSensitiveKnowledgeConsentService();

      const empty = await service.countWithheldKnowledge(root);
      expect(empty).toMatchObject({ allowSensitive: false, knowledgeBases: [] });
      expect(empty.total.withheldNow).toEqual({ sections: 0, characters: 0 });

      await driver.configureKnowledgeSelection(
        {
          root,
          entries: [
            {
              storeRoot: subject.storeRoot,
              storeId: entry.storeId,
              knowledgeBaseId: subject.knowledgeBaseId,
            },
          ],
        },
        silent,
      );
      const neverShare = { sections: 1, characters: neverShareSectionLength };
      const sensitive = { sections: 1, characters: sensitiveSectionLength };
      const both = { sections: 2, characters: neverShareSectionLength + sensitiveSectionLength };

      const off = await service.countWithheldKnowledge(root);
      expect(off.allowSensitive).toBe(false);
      expect(off.knowledgeBases).toEqual([
        {
          storeId: entry.storeId,
          knowledgeBaseId: subject.knowledgeBaseId,
          neverShare,
          sensitive,
          withheldNow: both,
          withheldIfToggled: neverShare,
        },
      ]);
      expect(off.total).toEqual({
        neverShare,
        sensitive,
        withheldNow: both,
        withheldIfToggled: neverShare,
      });
      // Content-free: no heading or text appears anywhere in the result.
      const serialized = JSON.stringify(off);
      for (const content of [neverShareMarker, sensitiveMarker, "Compensation", "Contact"]) {
        expect(serialized).not.toContain(content);
      }

      await service.setSensitiveKnowledgeConsent(root, true);
      const on = await service.countWithheldKnowledge(root);
      expect(on.allowSensitive).toBe(true);
      expect(on.consentUpdatedAt).not.toBeNull();
      expect(on.total).toEqual({
        neverShare,
        sensitive,
        withheldNow: neverShare,
        withheldIfToggled: both,
      });

      await writeFile(consentFile(root), "{corrupt", "utf8");
      await expect(service.countWithheldKnowledge(root)).rejects.toThrow(
        sensitiveKnowledgeConsentInvalidMessage,
      );
    });

    it("derives a profile under the workspace consent and sends nothing on a corrupt file", async () => {
      const subject = await fixture();
      const root = await temporaryDirectory("draft-loop-consent-derive-");
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "Build reliable synthetic tools.\n", "utf8");
      await writeFile(join(root, "evidence", "resume.md"), "Synthetic resume.\n", "utf8");
      const bodies: string[] = [];
      const transport = vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "consent-derive",
            choices: [
              {
                message: {
                  content: JSON.stringify({ schemaVersion: 1, facts: [], issues: [] }),
                },
              },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
          }),
        };
      });
      const driver = createLocalApplicationDriver({
        providerClientFactories: { local: () => ({ fetch: transport as unknown as typeof fetch }) },
      });
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "local",
          authorModel: "profile-extractor",
          criticCompany: "anthropic",
          criticModel: "claude-sonnet-4-5",
        },
        silent,
      );
      const entry = subject.selection.entries[0];
      await driver.configureKnowledgeSelection(
        {
          root,
          entries: [
            {
              storeRoot: subject.storeRoot,
              storeId: entry?.storeId ?? "",
              knowledgeBaseId: subject.knowledgeBaseId,
            },
          ],
        },
        silent,
      );
      const derive = (profileId: string) =>
        driver.deriveCanonicalCandidateProfile({ root, profileId, allowProviderData: true });
      const sent = () => bodies.join("\n");

      await derive("profile-off");
      expect(sent()).toContain("careful reliability work");
      expect(sent()).not.toContain(neverShareMarker);
      expect(sent()).not.toContain(sensitiveMarker);

      await setSensitiveKnowledgeConsent(root, true);
      bodies.length = 0;
      await derive("profile-on");
      expect(sent()).toContain(sensitiveMarker);
      expect(sent()).not.toContain(neverShareMarker);

      await writeFile(consentFile(root), "{corrupt", "utf8");
      transport.mockClear();
      await expect(derive("profile-corrupt")).rejects.toThrow(
        sensitiveKnowledgeConsentInvalidMessage,
      );
      expect(transport).not.toHaveBeenCalled();

      // A run start reads the same file before any retrieval or provider request.
      await expect(driver.start({ root, allowProviderData: true }, silent)).rejects.toThrow(
        sensitiveKnowledgeConsentInvalidMessage,
      );
      expect(transport).not.toHaveBeenCalled();
    });
  });
});
