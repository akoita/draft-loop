import { Readable } from "node:stream";
import { crc32, deflateRawSync } from "node:zlib";

/** One file to write into the zip. */
export interface ZipFile {
  readonly path: string;
  readonly content: Uint8Array;
}

/** The largest count and offset a zip without ZIP64 records can state. */
const maximumEntries = 0xffff;
const maximumOffset = 0xffffffff;

/** Bit 11: names are UTF-8. */
const utf8Flag = 0x0800;
const stored = 0;
const deflated = 8;

/** The MS-DOS date and time a zip records, in UTC, from 1980 on. */
function dosDateTime(date: Date): { readonly time: number; readonly date: number } {
  const year = Math.max(date.getUTCFullYear(), 1980);
  return {
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      Math.floor(date.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

interface CentralRecord {
  readonly name: Buffer;
  readonly method: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly offset: number;
}

/**
 * Writes files as a zip stream, one entry at a time, so only the current file is held in memory.
 * Each entry is deflated unless that would not make it smaller. Sizes and checksums are known
 * before each entry is written, so no data descriptors are needed. Without ZIP64 records, more
 * than 65,535 entries or 4 GiB fails the stream rather than writing an archive readers would
 * misread.
 */
export function zipStream(files: AsyncIterable<ZipFile>, modifiedAt: Date): Readable {
  const { time, date } = dosDateTime(modifiedAt);
  async function* chunks(): AsyncGenerator<Buffer> {
    const central: CentralRecord[] = [];
    let offset = 0;
    for await (const file of files) {
      if (central.length === maximumEntries) throw new RangeError("Too many files for a zip.");
      const name = Buffer.from(file.path, "utf8");
      const raw = Buffer.from(
        file.content.buffer,
        file.content.byteOffset,
        file.content.byteLength,
      );
      const compressed = deflateRawSync(raw);
      const method = compressed.byteLength < raw.byteLength ? deflated : stored;
      const data = method === deflated ? compressed : raw;
      const crc = crc32(raw);
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(utf8Flag, 6);
      header.writeUInt16LE(method, 8);
      header.writeUInt16LE(time, 10);
      header.writeUInt16LE(date, 12);
      header.writeUInt32LE(crc, 14);
      header.writeUInt32LE(data.byteLength, 18);
      header.writeUInt32LE(raw.byteLength, 22);
      header.writeUInt16LE(name.byteLength, 26);
      header.writeUInt16LE(0, 28);
      if (offset + header.byteLength + name.byteLength + data.byteLength > maximumOffset) {
        throw new RangeError("The files are too large for a zip.");
      }
      central.push({
        name,
        method,
        crc,
        compressedSize: data.byteLength,
        size: raw.byteLength,
        offset,
      });
      yield Buffer.concat([header, name]);
      yield data;
      offset += header.byteLength + name.byteLength + data.byteLength;
    }
    const directoryOffset = offset;
    for (const record of central) {
      const entry = Buffer.alloc(46);
      entry.writeUInt32LE(0x02014b50, 0);
      entry.writeUInt16LE(20, 4);
      entry.writeUInt16LE(20, 6);
      entry.writeUInt16LE(utf8Flag, 8);
      entry.writeUInt16LE(record.method, 10);
      entry.writeUInt16LE(time, 12);
      entry.writeUInt16LE(date, 14);
      entry.writeUInt32LE(record.crc, 16);
      entry.writeUInt32LE(record.compressedSize, 20);
      entry.writeUInt32LE(record.size, 24);
      entry.writeUInt16LE(record.name.byteLength, 28);
      entry.writeUInt32LE(record.offset, 42);
      offset += entry.byteLength + record.name.byteLength;
      if (offset > maximumOffset) throw new RangeError("The files are too large for a zip.");
      yield Buffer.concat([entry, record.name]);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(offset - directoryOffset, 12);
    end.writeUInt32LE(directoryOffset, 16);
    yield end;
  }
  return Readable.from(chunks(), { objectMode: false });
}
