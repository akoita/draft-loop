import { describe, expect, it } from "vitest";

import { parseServerAddress, thisComputerOrigin } from "./server-address.js";

describe("parseServerAddress", () => {
  it("keeps only the origin of an https server", () => {
    expect(parseServerAddress(" https://draftloop.example/ ")).toEqual({
      ok: true,
      origin: "https://draftloop.example",
    });
  });

  it("assumes https for another computer and http for this one", () => {
    expect(parseServerAddress("draftloop.example")).toEqual({
      ok: true,
      origin: "https://draftloop.example",
    });
    expect(parseServerAddress("127.0.0.1:8080")).toEqual({ ok: true, origin: thisComputerOrigin });
    expect(parseServerAddress("localhost:9000")).toEqual({
      ok: true,
      origin: "http://localhost:9000",
    });
  });

  it("allows plain http only on this computer", () => {
    expect(parseServerAddress("http://[::1]:8080")).toEqual({
      ok: true,
      origin: "http://[::1]:8080",
    });
    expect(parseServerAddress("http://draftloop.example")).toMatchObject({ ok: false });
    expect(parseServerAddress("http://192.168.1.20:8080")).toMatchObject({ ok: false });
  });

  it("refuses other schemes, credentials, paths and empty input", () => {
    for (const input of [
      "",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "ftp://draftloop.example",
      "https://user:secret@draftloop.example",
      "https://draftloop.example/v1",
      "https://draftloop.example/?next=x",
      "https://draftloop.example/#home",
      "https://",
    ]) {
      expect(parseServerAddress(input), input).toMatchObject({ ok: false });
    }
  });
});
