import { describe, expect, it } from "vitest";

import type { ApiSchemas } from "./api-client.js";
import {
  assignableMembers,
  assignMemberRequest,
  canManageMembers,
  createRecordMemory,
  currentRecordId,
  memberLabel,
  newRecordIdProblem,
  noRecordNotice,
  recordIds,
  unassignMemberRequest,
  withRecord,
} from "./records-model.js";

const organisation: ApiSchemas["OrganisationMember"][] = [
  {
    memberId: "member-cy",
    email: "cy@alder.example.test",
    role: "member",
    status: "invited",
    invitedAt: "2026-10-20T00:00:00.000Z",
  },
  {
    memberId: "member-ada",
    email: "ada@alder.example.test",
    role: "owner",
    status: "active",
    invitedAt: "2026-10-01T00:00:00.000Z",
  },
  {
    memberId: "member-bo",
    email: "bo@alder.example.test",
    role: "admin",
    status: "active",
    invitedAt: "2026-10-02T00:00:00.000Z",
  },
];

const assigned: ApiSchemas["RecordMember"][] = [
  {
    memberId: "member-ada",
    email: "ada@alder.example.test",
    role: "owner",
    status: "active",
    assignedAt: "2026-10-21T00:00:00.000Z",
  },
];

const member = (role: "owner" | "admin" | "member"): ApiSchemas["Me"] => ({
  kind: "member",
  organisationId: "org-alder",
  memberId: "member-x",
  role,
});

function fakeStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

describe("candidate records", () => {
  it("lists the reachable records sorted, once each", () => {
    expect(
      recordIds({ workspaces: [{ id: "record-b" }, { id: "record-a" }, { id: "record-b" }] }),
    ).toEqual(["record-a", "record-b"]);
    expect(withRecord(["record-b"], "record-a")).toEqual(["record-a", "record-b"]);
    expect(withRecord(["record-a"], "record-a")).toEqual(["record-a"]);
  });

  it("opens the remembered record while the caller reaches it, else the first", () => {
    expect(currentRecordId(["record-a", "record-b"], "record-b")).toBe("record-b");
    expect(currentRecordId(["record-a", "record-b"], "record-gone")).toBe("record-a");
    expect(currentRecordId(["record-a"], undefined)).toBe("record-a");
    expect(currentRecordId([], "record-a")).toBeUndefined();
  });

  it("checks a new record id with the API's safe-id rule", () => {
    expect(newRecordIdProblem("candidate-ana.2026", [])).toBeUndefined();
    expect(newRecordIdProblem("", [])).toBe("Give the new record an id.");
    expect(newRecordIdProblem("-starts-with-dash", [])).toContain("starting with a letter");
    expect(newRecordIdProblem("has space", [])).toContain("letters, digits");
    expect(newRecordIdProblem("a".repeat(129), [])).toContain("128");
    expect(newRecordIdProblem("record-a", ["record-a"])).toContain("exists already");
  });

  it("lets owners, admins and the owner token manage members", () => {
    expect(canManageMembers({ kind: "owner" })).toBe(true);
    expect(canManageMembers(member("owner"))).toBe(true);
    expect(canManageMembers(member("admin"))).toBe(true);
    expect(canManageMembers(member("member"))).toBe(false);
    expect(noRecordNotice(member("admin"))).toContain("Create the first one");
    expect(noRecordNotice(member("member"))).toContain("No candidate record is assigned to you");
  });

  it("offers the organisation's members not yet assigned, by email", () => {
    expect(assignableMembers(organisation, assigned).map((item) => item.memberId)).toEqual([
      "member-bo",
      "member-cy",
    ]);
    expect(memberLabel(organisation[0] as ApiSchemas["OrganisationMember"])).toBe(
      "cy@alder.example.test · member · invited",
    );
    expect(memberLabel(assigned[0] as ApiSchemas["RecordMember"])).toBe(
      "ada@alder.example.test · owner",
    );
  });

  it("builds the assign and remove requests", () => {
    expect(assignMemberRequest("record-a", "member-bo")).toEqual({
      path: { workspaceId: "record-a", memberId: "member-bo" },
    });
    expect(unassignMemberRequest("record-a", "member-bo")).toEqual({
      path: { workspaceId: "record-a", memberId: "member-bo" },
    });
  });

  it("remembers the tab's record, and keeps it in memory when storage refuses", () => {
    const storage = fakeStorage();
    const memory = createRecordMemory(() => storage);
    expect(memory.read()).toBeUndefined();
    memory.remember("record-b");
    expect(createRecordMemory(() => storage).read()).toBe("record-b");

    const refusing = createRecordMemory(() => {
      throw new Error("storage refused");
    });
    refusing.remember("record-a");
    expect(refusing.read()).toBe("record-a");
  });

  it("ignores a stored value that is no record id", () => {
    const storage = fakeStorage();
    storage.setItem("draft-loop.record", "../not an id");
    expect(createRecordMemory(() => storage).read()).toBeUndefined();
  });
});
