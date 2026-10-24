import { buffer } from "node:stream/consumers";

import { describe, expect, it } from "vitest";

import { readZip } from "./test-zip.js";
import { zipStream } from "./zip-stream.js";

const modifiedAt = new Date("2026-10-24T10:00:00.000Z");
const encoder = new TextEncoder();

async function* filesOf(files: readonly { path: string; content: Uint8Array }[]) {
  for (const file of files) yield file;
}

describe("zipStream", () => {
  it("writes files that read back whole, deflated or stored", async () => {
    const repeated = encoder.encode(`${"Fictional notes on TypeScript services. ".repeat(200)}\n`);
    const random = new Uint8Array(512).map((_, index) => (index * 7919) % 251);
    const files = [
      { path: "manifest.json", content: encoder.encode('{"format":"example"}\n') },
      { path: "tables/runs.json", content: repeated },
      { path: `objects/${"a".repeat(64)}`, content: random },
      { path: "tables/empty.json", content: new Uint8Array() },
    ];
    const archive = await buffer(zipStream(filesOf(files), modifiedAt));
    expect(archive.byteLength).toBeLessThan(repeated.byteLength);
    const read = readZip(archive);
    expect(read.map((entry) => entry.path)).toEqual(files.map((file) => file.path));
    for (const [index, entry] of read.entries()) {
      expect(new Uint8Array(entry.content)).toEqual(files[index]?.content);
    }
  });

  it("writes an empty zip and fails the stream when the files fail", async () => {
    expect(readZip(await buffer(zipStream(filesOf([]), modifiedAt)))).toEqual([]);
    async function* failing() {
      yield { path: "manifest.json", content: encoder.encode("{}") };
      throw new Error("object changed");
    }
    await expect(buffer(zipStream(failing(), modifiedAt))).rejects.toThrow("object changed");
  });
});
