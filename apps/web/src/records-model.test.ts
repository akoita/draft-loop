import { describe, expect, it } from "vitest";

import type { ApiSchemas } from "./api-client.js";
import {
  accountLabel,
  assignableMembers,
  assignMemberRequest,
  canManageMembers,
  createRecordMemory,
  currentRecordId,
  isOnePersonPlan,
  memberLabel,
  newRecordNameProblem,
  noRecordNotice,
  recordIdFromName,
  recordIds,
  recordLabel,
  recordNames,
  sharesAccess,
  tidyRecordName,
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

  it("reads the names people gave the records, and shows the id without one", () => {
    const names = recordNames({
      workspaces: [{ id: "record-a" }, { id: "record-b", name: "Fictional search" }],
    });

    expect([...names]).toEqual([["record-b", "Fictional search"]]);
    expect(recordLabel("record-b", names)).toBe("Fictional search");
    expect(recordLabel("record-a", names)).toBe("record-a");
  });

  it("takes a plain name of up to 80 characters for a new record", () => {
    const names = new Map([["record-b", "Fictional search"]]);

    expect(tidyRecordName("  Product   roles\t2026 ")).toBe("Product roles 2026");
    expect(newRecordNameProblem("Product roles 2026", names)).toBeUndefined();
    expect(newRecordNameProblem("a".repeat(80), names)).toBeUndefined();
    expect(newRecordNameProblem("", names)).toBe("Give the new job search a name.");
    expect(newRecordNameProblem("a".repeat(81), names)).toBe("Use up to 80 characters.");
    expect(newRecordNameProblem("fictional SEARCH", names)).toContain("has that name already");
  });

  it("makes a safe, unused record id from a name", () => {
    expect(recordIdFromName("Product roles 2026", [])).toBe("product-roles-2026");
    expect(recordIdFromName("Été à Genève: design!", [])).toBe("ete-a-geneve-design");
    expect(recordIdFromName("求職", [])).toBe("record");
    expect(recordIdFromName("Search", ["search", "search-2"])).toBe("search-3");
    const long = recordIdFromName(`${"word ".repeat(15)}end`, []);
    expect(long.length).toBeLessThanOrEqual(48);
    expect(long).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/u);
  });

  it("lets owners, admins and the owner token manage members", () => {
    expect(canManageMembers({ kind: "owner" })).toBe(true);
    expect(canManageMembers(member("owner"))).toBe(true);
    expect(canManageMembers(member("admin"))).toBe(true);
    expect(canManageMembers(member("member"))).toBe(false);
    expect(noRecordNotice(member("admin"))).toContain("Start the first one");
    expect(noRecordNotice(member("member"))).toContain("No job search is shared with you");
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

describe("who the screen is for (#2861)", () => {
  const onPlan = (
    candidateRecords: number | null,
    seats: number | null,
    extra: Partial<Extract<ApiSchemas["Me"], { kind: "member" }>> = {},
  ): ApiSchemas["Me"] => ({
    kind: "member",
    organisationId: "org-alder",
    memberId: "member-ada",
    role: "owner",
    email: "ada@alder.example.test",
    plan: { candidateRecords, seats },
    ...extra,
  });

  it("treats a plan for one person and one job search as solo, until it holds more", () => {
    expect(isOnePersonPlan(onPlan(1, 1), [])).toBe(true);
    expect(isOnePersonPlan(onPlan(1, 1), ["my-job-search"])).toBe(true);
    // A plan changed after two job searches were made keeps the picker, so none is lost.
    expect(isOnePersonPlan(onPlan(1, 1), ["a", "b"])).toBe(false);
    expect(isOnePersonPlan(onPlan(3, 1), ["a"])).toBe(false);
    expect(isOnePersonPlan(onPlan(25, null), ["a"])).toBe(false);
    const { plan: _plan, ...noPlan } = onPlan(1, 1) as Extract<
      ApiSchemas["Me"],
      { kind: "member" }
    >;
    expect(isOnePersonPlan(noPlan, [])).toBe(false);
    expect(isOnePersonPlan({ kind: "owner" }, [])).toBe(false);
  });

  it("shares access only on plans for more than one person", () => {
    expect(sharesAccess(onPlan(3, 1))).toBe(false);
    expect(sharesAccess(onPlan(25, null))).toBe(true);
    expect(sharesAccess(onPlan(25, 5))).toBe(true);
    expect(sharesAccess({ kind: "owner" })).toBe(true);
  });

  it("names the team in the account menu only on plans for several people", () => {
    const coach = onPlan(25, null, { organisationName: "Alder coaching" });
    expect(accountLabel(coach, false)).toBe("ada@alder.example.test · Alder coaching");
    expect(accountLabel(onPlan(1, 1, { organisationName: "ada" }), true)).toBe(
      "ada@alder.example.test",
    );
    expect(accountLabel(onPlan(25, null), false)).toBe("ada@alder.example.test");
  });
});
