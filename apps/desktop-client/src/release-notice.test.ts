import { describe, expect, it } from "vitest";

import { compareVersions, newerDesktopRelease, parseVersion } from "./release-notice.js";

function order(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a === undefined || b === undefined) throw new Error("bad version");
  return Math.sign(compareVersions(a, b));
}

describe("versions", () => {
  it("orders releases and pre-releases", () => {
    expect(order("0.9.0", "0.8.0-alpha.5")).toBe(1);
    expect(order("0.9.0-alpha.2", "0.9.0-alpha.10")).toBe(-1);
    expect(order("0.9.0", "0.9.0-alpha.2")).toBe(1);
    expect(order("v1.0.0", "1.0.0")).toBe(0);
    expect(order("0.9.0-alpha", "0.9.0-alpha.1")).toBe(-1);
    expect(order("0.9.0-1", "0.9.0-alpha")).toBe(-1);
    expect(parseVersion("server-v0.13.0")).toBeUndefined();
  });
});

describe("newerDesktopRelease", () => {
  const releases = [
    { tag_name: "server-v0.14.0" },
    { tag_name: "v0.9.0-alpha.2", draft: true },
    { tag_name: "v0.9.0-alpha.1" },
    { tag_name: "v0.8.0-alpha.5" },
  ];

  it("names the newest published desktop tag, never a server or draft one", () => {
    expect(newerDesktopRelease(releases, "0.8.0-alpha.5")).toBe("v0.9.0-alpha.1");
  });

  it("names nothing when the client is current or the answer is odd", () => {
    expect(newerDesktopRelease(releases, "0.9.0-alpha.1")).toBeUndefined();
    expect(newerDesktopRelease({ message: "rate limited" }, "0.8.0")).toBeUndefined();
    expect(newerDesktopRelease(releases, "not a version")).toBeUndefined();
  });
});
