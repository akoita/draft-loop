import { describe, expect, it } from "vitest";
import type { ApplicationJobResult } from "./application-job-contract.js";
import { createCapabilityPort, type NativeBridge, validateBridgeCommand } from "./bridge.js";
import { bridgeCapabilities } from "./bridge-capabilities.js";

/*
 * Drift proof: real payloads go through the real validator and normalizer, so a field added to an
 * interface but not to the runtime allowlist fails here instead of in the app.
 */

const pasted: ApplicationJobResult = {
  workspaceId: "workspace-1",
  origin: "pasted-text",
  text: "Staff Fullstack Engineer\nTypeScript, React, Node.js",
  truncated: false,
  url: null,
  savedAt: null,
  copySource: null,
  earlier: null,
};

const answers: readonly ApplicationJobResult[] = [
  pasted,
  { ...pasted, origin: "workspace-file" },
  { ...pasted, origin: "local-file", truncated: true },
  { ...pasted, origin: "url", text: null, url: "https://jobs.example.com/staff-engineer" },
  {
    ...pasted,
    origin: "url",
    url: "https://jobs.example.com/staff-engineer",
    savedAt: "2030-01-05T00:00:00.000Z",
    copySource: "page",
    earlier: { text: "Staff Engineer", savedAt: "2030-01-04T00:00:00.000Z" },
  },
  {
    ...pasted,
    origin: "url",
    url: "https://jobs.example.com/staff-engineer",
    savedAt: "2030-01-05T00:00:00.000Z",
    copySource: "pasted",
  },
  { ...pasted, origin: "unavailable", text: null },
];

const command = {
  type: "application.job",
  input: { workspaceId: "workspace-1", applicationId: "morpho-staff" },
} as const;

function portReturning(value: unknown) {
  const bridge: NativeBridge = {
    capabilities: [...bridgeCapabilities],
    invoke: async () => ({ ok: true, value }) as never,
  };
  return createCapabilityPort(bridge);
}

describe("application.job bridge command", () => {
  it("is advertised", () => {
    expect(bridgeCapabilities).toContain("application.job");
  });

  it("accepts the documented input, with or without an application", () => {
    expect(validateBridgeCommand(command)).toEqual(command);
    const workspaceOnly = { type: "application.job", input: { workspaceId: "workspace-1" } };
    expect(validateBridgeCommand(workspaceOnly)).toEqual(workspaceOnly);
  });

  it("rejects extra keys, paths and bad ids", () => {
    for (const input of [
      {},
      { applicationId: "morpho-staff" },
      { workspaceId: "workspace-1", path: "/private/job.md" },
      { workspaceId: "workspace-1", applicationId: "../other" },
      { workspaceId: "" },
    ]) {
      expect(() => validateBridgeCommand({ type: "application.job", input })).toThrow();
    }
  });

  it("accepts a real answer for every origin unchanged", async () => {
    for (const answer of answers) {
      await expect(portReturning(answer).execute(command)).resolves.toEqual({
        ok: true,
        value: answer,
      });
    }
  });

  it("rejects an answer with an extra, missing or contradictory field", async () => {
    const { truncated: _omitted, ...withoutTruncated } = pasted;
    for (const answer of [
      { ...pasted, path: "/home/me/job.md" },
      withoutTruncated,
      { ...pasted, origin: "web" },
      { ...pasted, text: null },
      { ...pasted, url: "https://jobs.example.com" },
      { ...pasted, origin: "url", url: null, text: null },
      { ...pasted, origin: "url", url: "file:///etc/passwd", text: null },
      { ...pasted, origin: "url", url: "https://jobs.example.com" },
      { ...pasted, savedAt: "2030-01-05T00:00:00.000Z" },
      { ...pasted, earlier: { text: "x", savedAt: "2030-01-04T00:00:00.000Z" } },
      {
        ...pasted,
        origin: "url",
        url: "https://jobs.example.com",
        savedAt: "2030-01-05T00:00:00.000Z",
        copySource: "page",
        earlier: { text: "x", savedAt: "not a date" },
      },
      {
        ...pasted,
        origin: "url",
        url: "https://jobs.example.com",
        savedAt: "2030-01-05T00:00:00.000Z",
        copySource: "typed",
      },
      { ...pasted, copySource: "page" },
      { ...pasted, origin: "unavailable" },
      { ...pasted, text: "x".repeat(200_001) },
      { ...pasted, workspaceId: "bad id" },
    ]) {
      await expect(portReturning(answer).execute(command)).resolves.toMatchObject({ ok: false });
    }
  });

  it("validates the copy command: an optional pasted text, never a path or an empty text", () => {
    const save = {
      type: "application.job-copy",
      input: { workspaceId: "workspace-1", applicationId: "morpho-staff", text: "Staff\nEngineer" },
    };
    expect(bridgeCapabilities).toContain("application.job-copy");
    expect(validateBridgeCommand(save)).toEqual(save);
    const fetchNow = { type: "application.job-copy", input: { workspaceId: "workspace-1" } };
    expect(validateBridgeCommand(fetchNow)).toEqual(fetchNow);
    for (const input of [
      { workspaceId: "workspace-1", text: "   " },
      { workspaceId: "workspace-1", url: "https://jobs.example.com" },
      { workspaceId: "workspace-1", text: "x".repeat(200_001) },
    ]) {
      expect(() => validateBridgeCommand({ type: "application.job-copy", input })).toThrow();
    }
  });
});
