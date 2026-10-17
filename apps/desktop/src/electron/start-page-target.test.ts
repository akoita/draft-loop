import type { ApplicationService } from "@draft-loop/application";
import { describe, expect, it, vi } from "vitest";

import { applyStartPageTarget, policyContentWithPageTarget } from "./start-page-target.js";

const policy = "# Policy\n\nTone: direct\nPage target: two-page\n\n## Rules\n\n- No em dashes.\n";

describe("start page target", () => {
  it("rewrites only the page target line, and leaves a matching target alone", () => {
    expect(policyContentWithPageTarget(policy, "one-page")).toBe(
      policy.replace("Page target: two-page", "Page target: one-page"),
    );
    expect(policyContentWithPageTarget(policy, "two-page")).toBeUndefined();
    expect(policyContentWithPageTarget("Tone: direct\n", "one-page")).toBe(
      "Tone: direct\nPage target: one-page\n",
    );
  });

  it("saves a changed target as a new policy version and skips an unchanged one", async () => {
    const descriptor = { id: "workspace-1" };
    const service = {
      getWritingPolicy: vi.fn(async () => ({ policy: { content: policy } })),
      configureWritingPolicy: vi.fn(async () => descriptor),
    } as unknown as Pick<ApplicationService, "configureWritingPolicy" | "getWritingPolicy">;
    await expect(applyStartPageTarget(service, "/workspace", "two-page")).resolves.toBeUndefined();
    expect(service.configureWritingPolicy).not.toHaveBeenCalled();
    await expect(applyStartPageTarget(service, "/workspace", "one-page")).resolves.toBe(descriptor);
    expect(service.configureWritingPolicy).toHaveBeenCalledOnce();
  });
});
