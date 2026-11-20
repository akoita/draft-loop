import { describe, expect, it } from "vitest";

import { phoneLayoutQuery } from "./phone-layout.js";

describe("phone layout", () => {
  it("matches the shared screens' phone breakpoint", () => {
    expect(phoneLayoutQuery).toBe("(max-width: 640px)");
  });
});
