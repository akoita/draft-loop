import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalCandidateProfileFactCategories } from "@draft-loop/domain";
import type { AnthropicClient } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";

import { processCanonicalCandidateProfileExtraction } from "./candidate-profile-extraction.js";
import {
  createLocalApplicationDriver,
  createProviderCanonicalCandidateProfileExtractionPort,
  readWorkspace,
} from "./local.js";

const employerSourceText = "At Acme, I worked as Staff Engineer from 2020 to 2023.";
const skillsSourceText = "A project used TypeScript and React; PostgreSQL is listed as a skill.";

const sourceMaterials = [
  {
    id: "employment-source",
    mediaType: "text/plain",
    checksum: "a".repeat(64),
    text: employerSourceText,
    reference: {
      storeId: "store-one",
      knowledgeBaseId: "knowledge-one",
      sourceId: "employment-document",
      versionId: "version-one",
      kind: "candidate-provided",
    },
  },
  {
    id: "skills-source",
    mediaType: "text/plain",
    checksum: "b".repeat(64),
    text: skillsSourceText,
    reference: {
      storeId: "store-one",
      knowledgeBaseId: "knowledge-one",
      sourceId: "skills-document",
      versionId: "version-two",
      kind: "candidate-provided",
    },
  },
] as const;

const supportedProposal = {
  schemaVersion: 1,
  facts: [
    {
      key: "employer-acme",
      category: "employer",
      subjectKey: "employment-one",
      field: "name",
      value: "Acme",
      evidence: [{ sourceId: "employment-source", quote: "At Acme" }],
    },
    {
      key: "role-staff-engineer",
      category: "role",
      subjectKey: "employment-one",
      field: "title",
      value: "Staff Engineer",
      evidence: [{ sourceId: "employment-source", quote: "Staff Engineer" }],
    },
    {
      key: "employment-dates",
      category: "date",
      subjectKey: "employment-one",
      field: "dates",
      value: "2020 to 2023",
      evidence: [{ sourceId: "employment-source", quote: "from 2020 to 2023" }],
    },
    {
      key: "skill-typescript",
      category: "skill",
      subjectKey: "skill-typescript",
      field: "name",
      value: "TypeScript",
      evidence: [{ sourceId: "skills-source", quote: "used TypeScript and React" }],
    },
    {
      key: "skill-react",
      category: "skill",
      subjectKey: "skill-react",
      field: "name",
      value: "React",
      evidence: [{ sourceId: "skills-source", quote: "used TypeScript and React" }],
    },
    {
      key: "skill-postgresql",
      category: "skill",
      subjectKey: "skill-postgresql",
      field: "name",
      value: "PostgreSQL",
      evidence: [{ sourceId: "skills-source", quote: "PostgreSQL is listed as a skill" }],
    },
  ],
  issues: [],
};

interface CapturedAnthropicRequest {
  readonly system: string;
  readonly max_tokens: number;
  readonly messages: readonly { readonly role: string; readonly content: string }[];
}

describe("canonical candidate profile extraction coverage", () => {
  it("maps employer, employment, and skill facts from separate sources without changing the text", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-profile-coverage-"));
    let captured: CapturedAnthropicRequest | undefined;
    const client: AnthropicClient = {
      messages: {
        create: (parameters) => {
          captured = parameters as unknown as CapturedAnthropicRequest;
          const response = {
            id: "anthropic-profile-coverage-1",
            content: [{ type: "text", text: JSON.stringify(supportedProposal) }],
            model: "claude-sonnet-5-5",
            stop_reason: "end_turn",
            usage: { input_tokens: 1200, output_tokens: 80 },
          };
          return Object.assign(Promise.resolve(response), {
            withResponse: async () => ({
              data: response,
              request_id: "anthropic-profile-coverage-1",
            }),
          }) as ReturnType<AnthropicClient["messages"]["create"]>;
        },
      },
    };

    try {
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "Software engineering role.\n", "utf8");
      const driver = createLocalApplicationDriver();
      await driver.initialize(
        {
          root,
          jobDescription: "job.md",
          sources: "evidence",
          authorCompany: "anthropic",
          authorModel: "claude-sonnet-5-5",
          criticCompany: "openai",
          criticModel: "gpt-6-luna",
        },
        { write: () => undefined },
      );
      const port = createProviderCanonicalCandidateProfileExtractionPort(
        await readWorkspace(root),
        {
          allowProviderData: true,
          providerAuthModeConfiguration: { anthropic: "api-key", openai: "api-key" },
          resolveCredential: async () => "synthetic-anthropic-key",
          providerClientFactories: { anthropic: () => client },
        },
      );

      const result = await processCanonicalCandidateProfileExtraction(port, {
        operationId: "profile-coverage-test",
        sources: sourceMaterials,
        allowProviderData: true,
      });

      expect(captured?.max_tokens).toBe(32768);
      expect(captured?.system).toContain("Supported fact categories are");
      expect(captured?.messages[0]?.content).toBe(
        JSON.stringify({
          sources: sourceMaterials.map(({ id, mediaType, checksum, text }) => ({
            id,
            mediaType,
            checksum,
            text,
          })),
        }),
      );
      expect(captured?.messages[0]?.content).toContain(employerSourceText);
      expect(captured?.messages[0]?.content).toContain(skillsSourceText);

      const employer = result.facts.find((fact) => fact.category === "employer");
      const role = result.facts.find((fact) => fact.category === "role");
      const date = result.facts.find((fact) => fact.category === "date");
      const skills = result.facts.filter((fact) => fact.category === "skill");
      expect([
        employer?.value,
        role?.value,
        date?.value,
        ...skills.map((fact) => fact.value),
      ]).toEqual(["Acme", "Staff Engineer", "2020 to 2023", "TypeScript", "React", "PostgreSQL"]);
      expect(employer?.provenance).toMatchObject([sourceMaterials[0].reference]);
      expect(role?.provenance).toMatchObject([sourceMaterials[0].reference]);
      expect(date?.provenance).toMatchObject([sourceMaterials[0].reference]);
      expect(skills.every((fact) => fact.provenance[0]?.sourceId === "skills-document")).toBe(true);
      expect(employer?.subjectId).toBe(role?.subjectId);
      expect(role?.subjectId).toBe(date?.subjectId);

      const presentCategories = new Set(result.facts.map((fact) => fact.category));
      const omittedCategories = canonicalCandidateProfileFactCategories.filter(
        (category) => !presentCategories.has(category),
      );
      expect(omittedCategories.length).toBeGreaterThan(0);
      for (const category of omittedCategories) {
        expect(
          result.issues.some(
            (issue) => issue.code === "omission" && issue.message.includes(`No ${category} fact`),
          ),
        ).toBe(true);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
