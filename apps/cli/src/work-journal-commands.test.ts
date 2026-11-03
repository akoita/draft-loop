import { describe, expect, it } from "vitest";

import { createCli } from "./index.js";

// Fictional projects and links only.
function stored(id: string, verdict: "clear" | "flagged" = "clear") {
  return {
    id,
    status: "pending",
    content: {
      title: "Card payments for the Fernhill booking site",
      summary: "Added card payments to the booking flow with a hosted checkout page.",
      period: { start: "2026-10-12", end: "2026-10-30" },
      project: { name: "Fernhill bookings", visibility: "private" },
      technologies: ["TypeScript", "Stripe"],
      category: "payments",
      candidate_role: ["implemented"],
      links: [{ kind: "pull-request", url: "https://git.example.test/fernhill/bookings/pull/42" }],
      metrics: [],
    },
    possible_duplicate_of: [],
    screening: { verdict },
  };
}

/** A fake work journal API: two pending notes, the second quarantined. */
function stubServer() {
  const notes = new Map([
    ["wjn_fixture_0001", stored("wjn_fixture_0001")],
    ["wjn_fixture_0002", stored("wjn_fixture_0002", "flagged")],
  ]);
  const reviews: unknown[] = [];
  const fetch = async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const headers = init.headers as Record<string, string>;
    if (headers.authorization !== "Bearer fixture-token") {
      return Response.json({ error: { code: "unauthorized", message: "No." } }, { status: 401 });
    }
    if (url.pathname === "/v1/workspaces/owner" && init.method === "GET") {
      return Response.json({ id: "owner", knowledgeBaseIds: ["kb-1"] });
    }
    if (url.pathname === "/v1/workspaces/owner/work-journal/notes") {
      return Response.json({
        notes: [...notes.values()]
          .filter((note) => note.status === url.searchParams.get("status"))
          .map((note) => ({
            id: note.id,
            title: note.content.title,
            project: note.content.project.name,
            period: note.content.period,
            status: note.status,
          })),
      });
    }
    const match = /^\/v1\/workspaces\/owner\/work-journal\/notes\/([^/]+)(\/review)?$/u.exec(
      url.pathname,
    );
    const note = notes.get(match?.[1] ?? "");
    if (note === undefined) {
      return Response.json({ error: { code: "note_not_found", message: "No." } }, { status: 404 });
    }
    if (match?.[2] === undefined) return Response.json(note);
    const body = JSON.parse(String(init.body)) as { action: string; tier?: string };
    reviews.push(body);
    if (body.action === "approve" && note.screening.verdict !== "clear") {
      return Response.json(
        { error: { code: "note_quarantined", message: "Screening holds this note." } },
        { status: 409 },
      );
    }
    const status = body.action === "approve" ? "approved" : "discarded";
    const reviewed = { ...note, status, approval: { tier: body.tier ?? "sensitive" } };
    notes.set(note.id, reviewed);
    return Response.json(reviewed);
  };
  return { fetch, reviews };
}

function cli(server: ReturnType<typeof stubServer>) {
  const lines: string[] = [];
  const program = createCli({
    io: { write: (line: string) => lines.push(line) },
    serverImport: {
      fetch: server.fetch,
      environment: { DRAFT_LOOP_SERVER_TOKEN: "fixture-token" },
    },
  });
  program.exitOverride();
  const run = (...args: string[]) =>
    program.parseAsync(["node", "draft-loop", "work-journal", ...args]);
  return { lines, run };
}

describe("work-journal commands", () => {
  it("lists, shows and approves a note into the workspace's selected knowledge base", async () => {
    const server = stubServer();
    const { lines, run } = cli(server);
    await run("list");
    expect(lines).toContain(
      "wjn_fixture_0001  2026-10-12 to 2026-10-30  Card payments for the Fernhill booking site (Fernhill bookings)",
    );
    await run("show", "wjn_fixture_0001");
    expect(lines).toContain(
      "Link (pull-request): https://git.example.test/fernhill/bookings/pull/42",
    );
    await run("approve", "wjn_fixture_0001");
    expect(server.reviews).toEqual([{ action: "approve", knowledge_base_id: "kb-1" }]);
    expect(lines.at(-1)).toBe(
      "Approved wjn_fixture_0001 as career evidence in kb-1 (sensitive tier).",
    );
  });

  it("refuses to approve a quarantined note and discards it instead", async () => {
    const server = stubServer();
    const { lines, run } = cli(server);
    await run("show", "wjn_fixture_0002");
    expect(lines.join("\n")).toContain("Screening: flagged, so it cannot be approved");
    await expect(
      run("approve", "wjn_fixture_0002", "--knowledge-base", "kb-1", "--tier", "normal"),
    ).rejects.toThrow("The server answered 409 (note_quarantined).");
    await run("discard", "wjn_fixture_0002");
    expect(lines.at(-1)).toBe("Discarded wjn_fixture_0002; an agent cannot record it again.");
  });

  it("checks the tier and the merge's summary choice before calling the server", async () => {
    const server = stubServer();
    const { run } = cli(server);
    await expect(run("approve", "wjn_fixture_0001", "--tier", "secret")).rejects.toThrow(
      "--tier takes normal, sensitive or never-share.",
    );
    await expect(
      run("merge", "wjn_fixture_0001", "--into", "wjn_fixture_0002", "--keep-summary", "both"),
    ).rejects.toThrow("--keep-summary takes into or this.");
    expect(server.reviews).toEqual([]);
  });
});
