import { describe, expect, it } from "vitest";

import { closeGuidePart, keepsItsPromise, refersBack } from "./interview-guide-holes.js";

const verdicts = (...parts: readonly (readonly [string, boolean])[]) =>
  parts.map(([text, holds]) => ({ sentence: text, text, holds }));

describe("closing a guide's holes (#2849)", () => {
  it("drops a sentence that leans on a dropped one", () => {
    const closed = closeGuidePart(
      verdicts(
        ["You ran the Kafka migration at Example Corp.", false],
        ["Mentoring and hiring are also not stated.", true],
        ["Lead with the reporting rebuild.", true],
      ),
    );
    expect(closed.texts).toEqual(["Lead with the reporting rebuild."]);
    expect(closed.dropped).toEqual([
      "You ran the Kafka migration at Example Corp.",
      "Mentoring and hiring are also not stated.",
    ]);
  });

  it("keeps a sentence that leans on a kept one", () => {
    const closed = closeGuidePart(
      verdicts(["Lead with the reporting rebuild.", true], ["This shows ownership.", true]),
    );
    expect(closed.texts).toEqual(["Lead with the reporting rebuild.", "This shows ownership."]);
  });

  it("renumbers the beats that remain", () => {
    const closed = closeGuidePart(
      verdicts(
        ["First beat: the Kafka migration.", false],
        ["Second beat: the reporting rebuild.", true],
        ["Third beat: why this team.", true],
      ),
    );
    expect(closed.texts).toEqual([
      "First beat: the reporting rebuild.",
      "Second beat: why this team.",
    ]);
  });

  it("renumbers numbered steps and French ordinals", () => {
    expect(
      closeGuidePart(verdicts(["1. Ask about the team.", false], ["2. Ask about the stack.", true]))
        .texts,
    ).toEqual(["1. Ask about the stack."]);
    expect(
      closeGuidePart(
        verdicts(["Premièrement, la migration.", false], ["Deuxièmement, le reporting.", true]),
      ).texts,
    ).toEqual(["Premièrement, le reporting."]);
  });

  it("tells a leaning sentence from one that stands alone", () => {
    expect(refersBack("This shows ownership.")).toBe(true);
    expect(refersBack("Cela montre l’autonomie.")).toBe(true);
    expect(refersBack("Hiring is also open.")).toBe(true);
    expect(refersBack("Show that you owned the rebuild.")).toBe(false);
    expect(refersBack("Thistle Analytics is the client.")).toBe(false);
  });

  it("drops an item that lost most of what its heading promised", () => {
    expect(keepsItsPromise(4, 1)).toBe(false);
    expect(keepsItsPromise(2, 1)).toBe(true);
    expect(keepsItsPromise(1, 0)).toBe(false);
  });
});
