import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApiClient, ApiSchemas } from "./api-client.js";
import { MemberList, MembersPanel, RecordPicker, Records } from "./records.js";
import { createRecordMemory } from "./records-model.js";

const unusedClient: ApiClient = {
  call: async () => {
    throw new Error("not called while rendering");
  },
};

const assigned: ApiSchemas["RecordMember"][] = [
  {
    memberId: "member-ada",
    email: "ada@alder.example.test",
    role: "owner",
    status: "active",
    assignedAt: "2026-10-21T00:00:00.000Z",
  },
];

const assignable: ApiSchemas["OrganisationMember"][] = [
  {
    memberId: "member-cy",
    email: "cy@alder.example.test",
    role: "member",
    status: "invited",
    invitedAt: "2026-10-20T00:00:00.000Z",
  },
];

const listProps = { busy: false, messages: [], onAssign: () => {}, onRemove: () => {} };

describe("record picker", () => {
  it("lists the records with the chosen one selected, and a labelled new-record field", () => {
    const html = renderToStaticMarkup(
      <RecordPicker
        ids={["record-a", "record-b"]}
        chosen="record-b"
        notice="unused"
        onChoose={() => {}}
      />,
    );

    expect(html).toContain('<label for="record-picker">Record</label>');
    expect(html).toContain('<option value="record-b" selected="">record-b</option>');
    expect(html).toContain('<label for="new-record-id">New record id</label>');
    expect(html).toContain("Create record");
  });

  it("marks a new id the Workspace step has not set up yet", () => {
    const html = renderToStaticMarkup(
      <RecordPicker ids={["record-a"]} chosen="record-new" notice="unused" onChoose={() => {}} />,
    );

    expect(html).toContain("record-new (new, set it up in the Workspace step)");
  });

  it("says why there is no record to choose", () => {
    const html = renderToStaticMarkup(
      <RecordPicker
        ids={[]}
        chosen={undefined}
        notice="No candidate record is assigned to you yet."
        onChoose={() => {}}
      />,
    );

    expect(html).toContain("No candidate record is assigned to you yet.");
    expect(html).not.toContain("record-picker");
  });
});

describe("record members", () => {
  it("lets an owner or admin remove members and assign the unassigned ones", () => {
    const html = renderToStaticMarkup(
      <MemberList members={assigned} assignable={assignable} {...listProps} />,
    );

    expect(html).toContain("ada@alder.example.test · owner");
    expect(html).toContain('aria-label="Remove ada@alder.example.test from this record"');
    expect(html).toContain('<label for="assign-member">Assign a member</label>');
    expect(html).toContain(
      '<option value="member-cy" selected="">cy@alder.example.test · member · invited</option>',
    );
  });

  it("shows a member the list read-only", () => {
    const html = renderToStaticMarkup(
      <MemberList members={assigned} assignable={undefined} {...listProps} />,
    );

    expect(html).toContain("ada@alder.example.test · owner");
    expect(html).not.toContain("Remove");
    expect(html).not.toContain("assign-member");
    expect(html).toContain("Owners and admins of your organisation assign members.");
  });

  it("says when everyone is assigned, and shows refusals", () => {
    const html = renderToStaticMarkup(
      <MemberList
        members={assigned}
        assignable={[]}
        {...listProps}
        messages={["Only an organisation's owners and admins assign members."]}
      />,
    );

    expect(html).toContain("Every member of your organisation is assigned to this record.");
    expect(html).toContain('role="alert">Only an organisation&#x27;s owners');
  });

  it("waits for a new record to be set up before listing members", () => {
    const html = renderToStaticMarkup(
      <MembersPanel client={unusedClient} recordId="record-new" exists={false} manage={true} />,
    );

    expect(html).toContain("<summary>Members of this record</summary>");
    expect(html).toContain("Members can be assigned once the record is set up.");
  });

  it("reads the records before showing any step", () => {
    const html = renderToStaticMarkup(
      <Records client={unusedClient} memory={createRecordMemory(() => undefined)}>
        {(recordId) => <p>steps for {recordId}</p>}
      </Records>,
    );

    expect(html).toContain('role="status">Reading your candidate records…</p>');
    expect(html).not.toContain("steps for");
  });
});
