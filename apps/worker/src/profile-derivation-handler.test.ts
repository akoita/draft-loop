import {
  type ApplicationService,
  canonicalCandidateProfileSelectionStaleErrorMessage,
} from "@draft-loop/application";
import type { ProfileDerivationOutcome, ProfileDerivationProgress } from "@draft-loop/run-queue";
import { describe, expect, it, vi } from "vitest";

import {
  createProfileDerivationHandler,
  type ProfileDerivationHandlerOptions,
} from "./profile-derivation-handler.js";

const job = {
  tenantId: "tenant-a",
  workspaceId: "workspace-1",
  profileId: "career",
  providerDataApproved: true,
};

type Derive = ApplicationService["deriveCanonicalCandidateProfile"];

function handler(derive: Derive, options: Partial<ProfileDerivationHandlerOptions> = {}) {
  const outcomes: ProfileDerivationOutcome[] = [];
  const handle = createProfileDerivationHandler({
    serviceFor: () => ({ deriveCanonicalCandidateProfile: derive }),
    workspaceRoot: (queued) => `/tenants/${queued.tenantId}/workspaces/${queued.workspaceId}`,
    allowProviderData: true,
    onOutcome: (_job, outcome) => outcomes.push(outcome),
    ...options,
  });
  const progress: ProfileDerivationProgress[] = [];
  const controller = new AbortController();
  const control = {
    signal: controller.signal,
    reportProgress: (p: ProfileDerivationProgress) => progress.push(p),
  };
  return { handle, control, controller, outcomes, progress };
}

const saved = (version: number) => (async () => ({ profile: { version } })) as unknown as Derive;

describe("profile derivation job handler", () => {
  it("derives the queued profile in the job's workspace and reports its progress", async () => {
    const derive = vi.fn<Derive>(async (command) => {
      command.onProgress?.({ completedCalls: 1, plannedCalls: 2 });
      return (await saved(4)(command)) as Awaited<ReturnType<Derive>>;
    });
    const { handle, control, outcomes, progress } = handler(derive);

    expect(await handle(job, control)).toEqual({ outcome: "derived", version: 4 });
    expect(outcomes).toEqual([{ outcome: "derived", version: 4 }]);
    expect(progress).toEqual([{ completedCalls: 1, plannedCalls: 2 }]);
    expect(derive).toHaveBeenCalledWith(
      expect.objectContaining({
        root: "/tenants/tenant-a/workspaces/workspace-1",
        profileId: "career",
        allowProviderData: true,
        signal: control.signal,
      }),
    );
  });

  it("sends evidence only when both the deployment and the person allowed it", async () => {
    const derive = vi.fn<Derive>(saved(1));
    const refused = handler(derive, { allowProviderData: false });
    await refused.handle(job, refused.control);
    const unapproved = handler(derive);
    await unapproved.handle({ ...job, providerDataApproved: false }, unapproved.control);

    expect(derive.mock.calls.map(([command]) => command.allowProviderData)).toEqual([false, false]);
  });

  it("asks for every source again only when the job says so", async () => {
    const derive = vi.fn<Derive>(saved(1));
    const { handle, control } = handler(derive);

    await handle({ ...job, fullExtraction: true }, control);
    await handle(job, control);

    expect(derive.mock.calls[0]?.[0].fullExtraction).toBe(true);
    expect(derive.mock.calls[1]?.[0]).not.toHaveProperty("fullExtraction");
  });

  it("ends a cancelled derivation as cancelled, saving nothing", async () => {
    const { handle, control, controller } = handler(async (command) => {
      controller.abort();
      throw command.signal?.reason ?? new Error("aborted");
    });

    expect(await handle(job, control)).toEqual({ outcome: "cancelled" });
  });

  it("ends without a provider call when the record's consent does not cover it", async () => {
    const derive = vi.fn<Derive>(saved(1));
    const { handle, control } = handler(derive, { consentFor: async () => false });

    expect(await handle(job, control)).toEqual({ outcome: "consent-required" });
    expect(derive).not.toHaveBeenCalled();
  });

  it("ends without touching an erased record, before checking consent", async () => {
    const derive = vi.fn<Derive>(saved(1));
    const consentFor = vi.fn(async () => true);
    const { handle, control } = handler(derive, { consentFor, recordErased: async () => true });

    expect(await handle(job, control)).toEqual({ outcome: "record-erased" });
    expect(consentFor).not.toHaveBeenCalled();
    expect(derive).not.toHaveBeenCalled();
  });

  it("keeps a failure the person can fix as its fixed message", async () => {
    const { handle, control } = handler(async () => {
      throw new Error(canonicalCandidateProfileSelectionStaleErrorMessage);
    });

    expect(await handle(job, control)).toEqual({
      outcome: "failed",
      message: canonicalCandidateProfileSelectionStaleErrorMessage,
    });
  });

  it("fails the attempt on any other error, so the queue retries it", async () => {
    const { handle, control, outcomes } = handler(async () => {
      throw new Error("connection reset /tenants/tenant-a");
    });

    await expect(handle(job, control)).rejects.toThrow("connection reset");
    expect(outcomes).toEqual([]);
  });
});
