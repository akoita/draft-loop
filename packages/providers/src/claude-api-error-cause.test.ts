import { describe, expect, it } from "vitest";

import { claudeApiErrorCauseDiagnostics } from "./claude-api-error-cause.js";

const allowlistedTokens = [
  "invalid_request_error",
  "authentication_error",
  "permission_error",
  "not_found_error",
  "request_too_large",
  "rate_limit_error",
  "overloaded_error",
  "api_error",
  "timeout_error",
] as const;

describe("claudeApiErrorCauseDiagnostics", () => {
  it.each(allowlistedTokens)("classifies the allowlisted error type %s", (token) => {
    const sentinel = `private-cause-sentinel-${token}`;
    const output = claudeApiErrorCauseDiagnostics(
      `{"type":"error","error":{"type":"${token}","message":"${sentinel}"}}`,
    );

    expect(output).toEqual([{ code: `claude_api_error_type_${token}`, path: "result" }]);
    expect(JSON.stringify(output)).not.toContain(sentinel);
  });

  it("classifies a status prefix and the inner error type without matching the outer type", () => {
    const sentinel = "private-cause-sentinel-status";
    const output = claudeApiErrorCauseDiagnostics(
      `API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"${sentinel}"}}`,
    );

    expect(output).toEqual([
      { code: "claude_api_error_status_400", path: "result" },
      { code: "claude_api_error_type_invalid_request_error", path: "result" },
    ]);
    expect(JSON.stringify(output)).not.toContain(sentinel);
  });

  it("uses only the first status match", () => {
    expect(claudeApiErrorCauseDiagnostics("API Error: 529 then API Error: 500")).toEqual([
      { code: "claude_api_error_status_529", path: "result" },
    ]);
  });

  it.each([
    ["unknown text", "private-cause-sentinel-unknown something went wrong"],
    ["an out-of-range status", "API Error: 600 private-cause-sentinel-range"],
    ["a longer status number", "API Error: 4000 private-cause-sentinel-long"],
    ["an empty string", ""],
  ])("returns no diagnostics for %s", (_label, text) => {
    expect(claudeApiErrorCauseDiagnostics(text)).toEqual([]);
  });

  it.each([undefined, null, 400, { type: "invalid_request_error" }, ["api_error"]])(
    "returns no diagnostics for the non-string result %j",
    (result) => {
      expect(claudeApiErrorCauseDiagnostics(result)).toEqual([]);
    },
  );

  it.each([
    "invalid_request_errors",
    "xoverloaded_error",
    "_api_error",
    "api_error_2",
    "Rate_limit_error",
    "overloaded-error",
  ])("does not match the near-miss token %s", (text) => {
    expect(claudeApiErrorCauseDiagnostics(text)).toEqual([]);
  });

  it("matches tokens bounded by punctuation and string edges", () => {
    expect(claudeApiErrorCauseDiagnostics("overloaded_error:timeout_error")).toEqual([
      { code: "claude_api_error_type_overloaded_error", path: "result" },
      { code: "claude_api_error_type_timeout_error", path: "result" },
    ]);
  });

  it("deduplicates repeated tokens and keeps the allowlist order", () => {
    expect(
      claudeApiErrorCauseDiagnostics(
        "api_error overloaded_error api_error API Error: 529 overloaded_error",
      ),
    ).toEqual([
      { code: "claude_api_error_status_529", path: "result" },
      { code: "claude_api_error_type_overloaded_error", path: "result" },
      { code: "claude_api_error_type_api_error", path: "result" },
    ]);
  });

  it("caps the output at four diagnostics", () => {
    const output = claudeApiErrorCauseDiagnostics(`API Error: 500 ${allowlistedTokens.join(" ")}`);

    expect(output).toEqual([
      { code: "claude_api_error_status_500", path: "result" },
      { code: "claude_api_error_type_invalid_request_error", path: "result" },
      { code: "claude_api_error_type_authentication_error", path: "result" },
      { code: "claude_api_error_type_permission_error", path: "result" },
    ]);
  });

  it("ignores text past the first 4,096 characters", () => {
    const padding = " ".repeat(4_096);
    expect(claudeApiErrorCauseDiagnostics(`${padding}API Error: 400 api_error`)).toEqual([]);
    expect(
      claudeApiErrorCauseDiagnostics(`${" ".repeat(4_096 - "api_error".length)}api_error`),
    ).toEqual([{ code: "claude_api_error_type_api_error", path: "result" }]);
  });

  it("never copies result text into the output", () => {
    const sentinel = "private-cause-sentinel-leak";
    const output = claudeApiErrorCauseDiagnostics(
      `API Error: 429 ${sentinel} rate_limit_error ${sentinel} overloaded_error ${sentinel}`,
    );

    expect(output.length).toBeGreaterThan(0);
    expect(JSON.stringify(output)).not.toContain(sentinel);
    for (const { code, path } of output) {
      expect(code).toMatch(/^claude_api_error_(?:status_[1-5]\d{2}|type_[a-z_]+)$/u);
      expect(path).toBe("result");
    }
  });
});
