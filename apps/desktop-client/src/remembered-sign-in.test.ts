import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createRememberedSignIns,
  rememberedSignInFilename,
  type TokenCipher,
} from "./remembered-sign-in.js";

/** Reverses the bytes: enough to show the file never holds the token as written. */
function fakeCipher(available = true): TokenCipher {
  return {
    isAvailable: () => available,
    encrypt: (text) => Buffer.from(text, "utf8").reverse(),
    decrypt: (data) => Buffer.from(data).reverse().toString("utf8"),
  };
}

const token = "synthetic-owner-token-0123456789abcdef";

describe("remembered sign-ins", () => {
  it("keeps one encrypted token per server", () => {
    const directory = mkdtempSync(join(tmpdir(), "draftloop-sign-in-"));
    const signIns = createRememberedSignIns(directory, fakeCipher());
    signIns.remember("https://a.example", token);
    signIns.remember("http://127.0.0.1:8080", "other-token");
    expect(signIns.read("https://a.example")).toBe(token);
    expect(signIns.read("http://127.0.0.1:8080")).toBe("other-token");
    expect(signIns.read("https://b.example")).toBeNull();
    expect(readFileSync(join(directory, rememberedSignInFilename), "utf8")).not.toContain(token);
    signIns.forget("https://a.example");
    expect(signIns.read("https://a.example")).toBeNull();
    expect(signIns.read("http://127.0.0.1:8080")).toBe("other-token");
  });

  it("remembers nothing without a keychain", () => {
    const directory = mkdtempSync(join(tmpdir(), "draftloop-sign-in-"));
    const signIns = createRememberedSignIns(directory, fakeCipher(false));
    signIns.remember("https://a.example", token);
    expect(signIns.read("https://a.example")).toBeNull();
  });

  it("reads a token it cannot decrypt as none", () => {
    const directory = mkdtempSync(join(tmpdir(), "draftloop-sign-in-"));
    const cipher = fakeCipher();
    createRememberedSignIns(directory, cipher).remember("https://a.example", token);
    const broken = createRememberedSignIns(directory, {
      ...cipher,
      decrypt: () => {
        throw new Error("keychain changed");
      },
    });
    expect(broken.read("https://a.example")).toBeNull();
  });
});
