import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { isEntryPoint } from "./entry-point.js";

describe("isEntryPoint", () => {
  it("matches when the module URL corresponds to argv[1] on POSIX", () => {
    const argv1 = "/home/user/project/apps/cli/src/index.ts";
    const moduleUrl = pathToFileURL(argv1).href;

    expect(isEntryPoint(moduleUrl, argv1)).toBe(true);
  });

  it("matches a Windows path against its file:/// module URL", () => {
    const argv1 = "C:\\Users\\x\\index.ts";
    const toWindowsFileUrl = (path: string): string => pathToFileURL(path, { windows: true }).href;
    const moduleUrl = toWindowsFileUrl(argv1);

    expect(moduleUrl).toBe("file:///C:/Users/x/index.ts");
    expect(isEntryPoint(moduleUrl, argv1, toWindowsFileUrl)).toBe(true);
  });

  it("does not match when the module URL refers to a different file", () => {
    const argv1 = "/home/user/project/apps/cli/src/index.ts";
    const moduleUrl = pathToFileURL("/home/user/project/apps/cli/src/other.ts").href;

    expect(isEntryPoint(moduleUrl, argv1)).toBe(false);
  });

  it("returns false when argv1 is undefined", () => {
    const moduleUrl = pathToFileURL("/home/user/project/apps/cli/src/index.ts").href;

    expect(isEntryPoint(moduleUrl, undefined)).toBe(false);
  });

  it("returns false when argv1 is empty", () => {
    const moduleUrl = pathToFileURL("/home/user/project/apps/cli/src/index.ts").href;

    expect(isEntryPoint(moduleUrl, "")).toBe(false);
  });
});
