import { beforeEach, describe, expect, it } from "vitest";

import {
  authorRevisionKey,
  forgetAuthorRevision,
  maxAuthorRevisionEntries,
  rememberAuthorRevision,
  resetAuthorRevisionMemoryForTests,
  takeAuthorRevision,
} from "./author-revision-memory.js";

function revision(label: string) {
  return { rejectedProposal: { label }, report: [] };
}

describe("author revision memory", () => {
  beforeEach(() => resetAuthorRevisionMemoryForTests());

  it("returns a remembered revision once", () => {
    const key = authorRevisionKey("run-1", 2);
    rememberAuthorRevision(key, revision("first"));
    rememberAuthorRevision(key, revision("latest"));

    expect(key).toBe("run-1:2");
    expect(takeAuthorRevision(key)).toEqual(revision("latest"));
    expect(takeAuthorRevision(key)).toBeUndefined();
  });

  it("isolates runs and rounds", () => {
    rememberAuthorRevision(authorRevisionKey("run-1", 1), revision("run-1"));

    expect(takeAuthorRevision(authorRevisionKey("run-2", 1))).toBeUndefined();
    expect(takeAuthorRevision(authorRevisionKey("run-1", 2))).toBeUndefined();
    expect(takeAuthorRevision(authorRevisionKey("run-1", 1))).toEqual(revision("run-1"));
  });

  it("forgets a revision on request", () => {
    const key = authorRevisionKey("run-1", 1);
    rememberAuthorRevision(key, revision("rejected"));
    forgetAuthorRevision(key);

    expect(takeAuthorRevision(key)).toBeUndefined();
  });

  it("evicts the oldest entry beyond its bound", () => {
    for (let index = 0; index <= maxAuthorRevisionEntries; index += 1) {
      rememberAuthorRevision(authorRevisionKey(`run-${index}`, 1), revision(`${index}`));
    }

    expect(takeAuthorRevision(authorRevisionKey("run-0", 1))).toBeUndefined();
    expect(takeAuthorRevision(authorRevisionKey("run-1", 1))).toEqual(revision("1"));
    expect(takeAuthorRevision(authorRevisionKey(`run-${maxAuthorRevisionEntries}`, 1))).toEqual(
      revision(`${maxAuthorRevisionEntries}`),
    );
  });
});
