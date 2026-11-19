import { describe, expect, it } from "vitest";
import { jobPageKey } from "./job-page-duplicate.js";

describe("jobPageKey", () => {
  it("matches the same page whatever its host case, fragment or trailing slash", () => {
    const key = jobPageKey("https://jobs.example.test/1");
    expect(jobPageKey("https://Jobs.Example.test/1/")).toBe(key);
    expect(jobPageKey("  https://jobs.example.test/1#apply ")).toBe(key);
    expect(jobPageKey("https://jobs.example.test/2")).not.toBe(key);
    expect(jobPageKey("https://jobs.example.test/1?ref=a")).not.toBe(key);
  });

  it("compares an address that does not parse as typed", () => {
    expect(jobPageKey(" not a url ")).toBe("not a url");
  });
});
