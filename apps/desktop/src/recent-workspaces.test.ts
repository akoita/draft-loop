import { describe, expect, it } from "vitest";
import {
  parseRecentWorkspaceOpenInput,
  parseRecentWorkspacesClearInput,
  parseRecentWorkspacesClearResult,
  parseRecentWorkspacesListInput,
  parseRecentWorkspacesListResult,
} from "./recent-workspaces.js";

const entry = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  name: "CV workspace",
  lastOpenedAt: "2026-10-03T10:00:00.000Z",
};

describe("recent workspace renderer contracts", () => {
  it("accepts only bounded empty, id, list, and clear messages", () => {
    expect(parseRecentWorkspacesListInput({})).toEqual({});
    expect(parseRecentWorkspaceOpenInput({ id: entry.id })).toEqual({ id: entry.id });
    expect(parseRecentWorkspacesClearInput({})).toEqual({});
    expect(parseRecentWorkspacesListResult({ workspaces: [entry] })).toEqual({
      workspaces: [entry],
    });
    expect(parseRecentWorkspacesClearResult({ cleared: true })).toEqual({ cleared: true });
  });

  it("rejects paths, extra fields, unbounded lists, malformed ids and timestamps", () => {
    expect(() => parseRecentWorkspaceOpenInput({ id: entry.id, path: "/private" })).toThrow();
    expect(() => parseRecentWorkspacesListInput({ root: "/private" })).toThrow();
    expect(() =>
      parseRecentWorkspacesListResult({ workspaces: [{ ...entry, path: "/private" }] }),
    ).toThrow();
    expect(() =>
      parseRecentWorkspacesListResult({
        workspaces: Array.from({ length: 11 }, (_, index) => ({
          ...entry,
          id: `123e4567-e89b-12d3-a456-4266141740${String(index).padStart(2, "0")}`,
        })),
      }),
    ).toThrow();
    expect(() => parseRecentWorkspaceOpenInput({ id: "../../secret" })).toThrow();
    expect(() =>
      parseRecentWorkspacesListResult({ workspaces: [{ ...entry, lastOpenedAt: "yesterday" }] }),
    ).toThrow();
    expect(() => parseRecentWorkspacesClearResult({ cleared: true, path: "/private" })).toThrow();
  });

  it("accepts a location that is a bare folder name and rejects separators or extra keys", () => {
    expect(
      parseRecentWorkspacesListResult({ workspaces: [{ ...entry, location: "hc5" }] }),
    ).toEqual({ workspaces: [{ ...entry, location: "hc5" }] });
    for (const location of ["/home/me/hc5", "a/b", "a\\b", "", " hc5", 5]) {
      expect(() =>
        parseRecentWorkspacesListResult({ workspaces: [{ ...entry, location }] }),
      ).toThrow();
    }
    expect(() =>
      parseRecentWorkspacesListResult({ workspaces: [{ ...entry, locationPath: "hc5" }] }),
    ).toThrow();
  });
});
