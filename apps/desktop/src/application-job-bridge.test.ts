import type { ApplicationJobResult } from "@draft-loop/ui/application-job-contract";
import {
  createCapabilityPort,
  type NativeBridge,
  validateBridgeCommand,
} from "@draft-loop/ui/bridge";
import { bridgeCapabilities } from "@draft-loop/ui/bridge-capabilities";
import { describe, expect, it } from "vitest";

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
};

const answers: readonly ApplicationJobResult[] = [
  pasted,
  { ...pasted, origin: "workspace-file" },
  { ...pasted, origin: "local-file", truncated: true },
  { ...pasted, origin: "url", text: null, url: "https://jobs.example.com/staff-engineer" },
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
      { ...pasted, origin: "unavailable" },
      { ...pasted, text: "x".repeat(200_001) },
      { ...pasted, workspaceId: "bad id" },
    ]) {
      await expect(portReturning(answer).execute(command)).resolves.toMatchObject({ ok: false });
    }
  });
});
