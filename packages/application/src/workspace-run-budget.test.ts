import { describe, expect, it, vi } from "vitest";

import type { WorkspaceConfig } from "./local.js";
import { configureWorkspaceRunBudget } from "./workspace-run-budget.js";

const config = {
  schemaVersion: 1,
  id: "workspace",
  maxRounds: 3,
  maxCostUsd: 3,
  maxDurationMs: 1_800_000,
  authorCompany: "anthropic",
} as unknown as WorkspaceConfig;

describe("workspace run budget", () => {
  it("replaces the stored limits and drops the ones left out (#1993)", async () => {
    const saveWorkspaceConfig = vi.fn(async () => undefined);
    const lines: string[] = [];
    const next = await configureWorkspaceRunBudget(
      "/tenants/owner/workspaces/workspace",
      { root: "/tenants/owner/workspaces/workspace", maxRounds: 2, maxCostUsd: 2 },
      { readWorkspace: async () => config, saveWorkspaceConfig },
      { write: (line) => lines.push(line) },
    );

    expect(next).toEqual({
      schemaVersion: 1,
      id: "workspace",
      maxRounds: 2,
      maxCostUsd: 2,
      authorCompany: "anthropic",
    });
    expect(next).not.toHaveProperty("maxDurationMs");
    expect(saveWorkspaceConfig).toHaveBeenCalledWith("/tenants/owner/workspaces/workspace", next);
    expect(lines).toEqual([
      "Run budget set for workspace workspace: 2 rounds, US$2, duration at the deployment's limit",
    ]);
  });
});
