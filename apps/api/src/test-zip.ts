import { crc32, inflateRawSync } from "node:zlib";

/**
 * Reads a whole zip for tests: every entry through the central directory, inflated and checked
 * against its CRC-32 and size, in directory order. It throws on anything it does not expect.
 */
export function readZip(archive: Buffer): readonly { path: string; content: Buffer }[] {
  const endOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOffset < 0) throw new Error("No end of central directory.");
  const count = archive.readUInt16LE(endOffset + 10);
  let cursor = archive.readUInt32LE(endOffset + 16);
  const entries: { path: string; content: Buffer }[] = [];
  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Bad central entry.");
    const method = archive.readUInt16LE(cursor + 10);
    const crc = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const size = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const path = archive.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;

    if (archive.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Bad local header.");
    const localName = archive.toString(
      "utf8",
      localOffset + 30,
      localOffset + 30 + archive.readUInt16LE(localOffset + 26),
    );
    if (localName !== path) throw new Error("Local and central names differ.");
    const dataOffset =
      localOffset +
      30 +
      archive.readUInt16LE(localOffset + 26) +
      archive.readUInt16LE(localOffset + 28);
    const data = archive.subarray(dataOffset, dataOffset + compressedSize);
    const content =
      method === 8 ? inflateRawSync(data) : method === 0 ? Buffer.from(data) : undefined;
    if (content === undefined) throw new Error(`Unexpected method ${method}.`);
    if (content.byteLength !== size || crc32(content) !== crc) {
      throw new Error(`Entry ${path} does not match its size or CRC-32.`);
    }
    entries.push({ path, content });
  }
  return entries;
}
