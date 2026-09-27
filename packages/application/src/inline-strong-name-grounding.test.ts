import { describe, expect, it } from "vitest";

import { supportsInlineStrongMultiwordName } from "./inline-strong-name-grounding.js";

describe("inline strong multiword name grounding", () => {
  it.each([
    ["**FLUX** RPC", "FLUX RPC"],
    ["A source documents **FLUX** **RPC** together.", "FLUX RPC"],
    ["**FLUX**\t**RPC**", "FLUX RPC"],
    ["**FLUX** RPC was built with **written in Arbor**.", "FLUX RPC"],
    ["**FLUX** RPC (Full Link Utility) was built with **written in Arbor**.", "FLUX RPC"],
  ])("matches exact same-line names with whole-word strong markers: %s", (evidence, name) => {
    expect(supportsInlineStrongMultiwordName(evidence, name)).toBe(true);
  });

  it.each([
    ["**FLUXX** RPC", "FLUX RPC"],
    ["**FLUX** systems RPC", "FLUX RPC"],
    ["**FLUX**\nRPC", "FLUX RPC"],
    ["\\**FLUX** RPC", "FLUX RPC"],
    ["**FLUX RPC", "FLUX RPC"],
    ["***FLUX*** RPC", "FLUX RPC"],
    ["`**FLUX** RPC`", "FLUX RPC"],
    ["C**FLUX** RPC", "FLUX RPC"],
    ["**FLUX**ER RPC", "FLUX RPC"],
    ["**FLUX** R-P-C", "FLUX RPC"],
    ["**2020** **2021**", "2020 2021"],
  ])("rejects changed, joined, numeric, or malformed values: %s", (evidence, name) => {
    expect(supportsInlineStrongMultiwordName(evidence, name)).toBe(false);
  });
});
