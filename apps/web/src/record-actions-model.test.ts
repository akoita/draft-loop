import { describe, expect, it } from "vitest";

import { ApiRequestError, type ApiSchemas } from "./api-client.js";
import {
  canExportAndDelete,
  deleteRecordRequest,
  deleteRefusal,
  exportFileName,
  exportRequest,
  withoutRecord,
} from "./record-actions-model.js";

const member = (role: "owner" | "admin" | "member"): ApiSchemas["Me"] => ({
  kind: "member",
  organisationId: "org-alder",
  memberId: "member-x",
  role,
});

describe("record export and deletion", () => {
  it("lets the owner token, owners and admins export and delete, and no member", () => {
    expect(canExportAndDelete({ kind: "owner" })).toBe(true);
    expect(canExportAndDelete(member("owner"))).toBe(true);
    expect(canExportAndDelete(member("admin"))).toBe(true);
    expect(canExportAndDelete(member("member"))).toBe(false);
  });

  it("downloads the record's archive under the API's file name", () => {
    expect(exportRequest("candidate-ana")).toEqual({ path: { workspaceId: "candidate-ana" } });
    expect(exportFileName).toBe("draftloop-data.zip");
  });

  it("deletes only once DELETE is typed, and never asks for the internal id", () => {
    for (const typed of ["DELETE", " delete "]) {
      expect(deleteRecordRequest("candidate-ana", typed)).toEqual({
        request: { path: { workspaceId: "candidate-ana" }, body: { confirm: "candidate-ana" } },
      });
    }
    for (const typed of ["", "candidate-ana", "DEL"]) {
      expect(deleteRecordRequest("candidate-ana", typed)).toEqual({
        problem: "Type DELETE to confirm.",
      });
    }
  });

  it("says to stop the run first when a run is active, and passes other refusals on", () => {
    expect(
      deleteRefusal(
        new ApiRequestError(409, "run_active", "A run is queued or running; stop it first."),
      ),
    ).toMatch(/^Stop the run first\. .*in its review/u);
    expect(
      deleteRefusal(
        new ApiRequestError(403, "forbidden", "Only an organisation's owners and admins erase."),
      ),
    ).toBe("Only an organisation's owners and admins erase.");
    expect(deleteRefusal(new TypeError("offline"))).toContain("could not be reached");
  });

  it("drops the deleted record from the list", () => {
    expect(withoutRecord(["candidate-ana", "candidate-ben"], "candidate-ana")).toEqual([
      "candidate-ben",
    ]);
    expect(withoutRecord(["candidate-ben"], "candidate-ana")).toEqual(["candidate-ben"]);
  });
});
