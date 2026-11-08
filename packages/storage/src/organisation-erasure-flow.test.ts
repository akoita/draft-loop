import { describe, expect, it } from "vitest";

import { eraseOrganisation, type TenantErasure } from "./organisation-erasure-flow.js";
import type { OrganisationClosure, RecordClosure } from "./record-erasure.js";

function fakeErasure(options: {
  readonly closure?: OrganisationClosure;
  readonly records?: Record<string, RecordClosure>;
}) {
  const calls: string[] = [];
  const erasure: TenantErasure = {
    objectPrefix: "tenant-a/",
    organisation: {
      close: async () => {
        calls.push("organisation.close");
        return options.closure ?? { state: "closing", resumed: false };
      },
      isClosing: async () => true,
      listRecords: async () => Object.keys(options.records ?? {}),
      eraseRemainder: async () => {
        calls.push("organisation.eraseRemainder");
        return { rowsRemoved: 3 };
      },
    },
    records: {
      close: async (workspaceId) => {
        calls.push(`records.close ${workspaceId}`);
        return options.records?.[workspaceId] ?? { state: "missing" };
      },
      isClosed: async () => true,
      erase: async (workspaceId) => {
        calls.push(`records.erase ${workspaceId}`);
        return { rowsRemoved: 10, objectKeys: [] };
      },
    },
    blobs: {
      removeObject: async (key) => {
        calls.push(`blobs.removeObject ${key}`);
        return true;
      },
      removePrefix: async (prefix) => {
        calls.push(`blobs.removePrefix ${prefix}`);
        return 2;
      },
    },
  };
  return { erasure, calls };
}

describe("eraseOrganisation", () => {
  it("closes, erases each record with its objects, then the prefix and the remainder", async () => {
    const { erasure, calls } = fakeErasure({
      records: {
        "ws-1": { state: "closed", resumed: false, objectKeys: ["tenant-a/ws-1/cv.pdf"] },
        "ws-2": { state: "missing" },
      },
    });

    await expect(eraseOrganisation(erasure)).resolves.toEqual({
      state: "erased",
      records: 1,
      objectsRemoved: 3,
      rowsRemoved: 13,
    });
    expect(calls).toEqual([
      "organisation.close",
      "records.close ws-1",
      "blobs.removeObject tenant-a/ws-1/cv.pdf",
      "records.erase ws-1",
      "records.close ws-2",
      "blobs.removePrefix tenant-a/",
      "organisation.eraseRemainder",
    ]);
  });

  it("stops before erasing anything while a run is active", async () => {
    const organisationRun = fakeErasure({ closure: { state: "run-active" } });
    await expect(eraseOrganisation(organisationRun.erasure)).resolves.toEqual({
      state: "run-active",
    });
    expect(organisationRun.calls).toEqual(["organisation.close"]);

    const recordRun = fakeErasure({ records: { "ws-1": { state: "run-active" } } });
    await expect(eraseOrganisation(recordRun.erasure)).resolves.toEqual({ state: "run-active" });
    expect(recordRun.calls).not.toContain("organisation.eraseRemainder");
  });

  it("answers missing for an unknown organisation unless the tenant is unregistered", async () => {
    await expect(
      eraseOrganisation(fakeErasure({ closure: { state: "missing" } }).erasure),
    ).resolves.toEqual({ state: "missing" });
    await expect(
      eraseOrganisation(fakeErasure({ closure: { state: "missing" } }).erasure, true),
    ).resolves.toMatchObject({ state: "erased" });
  });
});
