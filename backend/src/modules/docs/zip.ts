import * as zlib from "node:zlib";
import { promisify } from "node:util";

/**
 * Just enough ZIP for Word documents and the account export.
 *
 * A .docx is a zip of a few XML files, and the export (DATA-09) is a zip of
 * every page someone owns. Node already has the hard part — DEFLATE, in
 * zlib. What is left is the container: a local header before each file, a
 * central directory listing them, and a record saying where that directory
 * starts. Writing those by hand keeps a whole compression library out of
 * the image.
 *
 * `zip` builds a small archive in memory (a .docx). `zipStream` writes one
 * file at a time as the reader takes them, deflating off the main thread,
 * so a large account's export neither sits in memory whole nor holds up
 * other requests; past 65,535 files or 4 GB it writes the zip64 records
 * every current unzip tool reads. No directories, no encryption, no data
 * descriptors: each file is deflated, or stored when deflating would make
 * it bigger, before its header is written.
 */

export type ZipEntry = { name: string; body: string | Buffer };

/** CRC-32 as zip wants it: zlib's own when this Node has it (22.2+). */
const nativeCrc = (zlib as { crc32?: (data: Buffer) => number }).crc32;

/** The table for the fallback, built once. */
const TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  if (nativeCrc) return nativeCrc(buffer) >>> 0;
  let c = -1;
  for (const byte of buffer) c = TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Zip's own date format: DOS time and date, two bytes each. */
function dosStamp(at: Date) {
  const time =
    (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1);
  const date =
    ((at.getFullYear() - 1980) << 9) |
    ((at.getMonth() + 1) << 5) |
    at.getDate();
  return { time, date };
}

const U16 = 0xffff;
const U32 = 0xffffffff;

/** One file, ready to write: its name, bytes as stored, and their facts. */
type Packed = {
  name: Buffer;
  body: Buffer;
  size: number;
  crc: number;
  deflated: boolean;
};

/** Below this, deflating isn't worth the header it saves. */
const TINY = 64;

const deflateRawAsync = promisify(zlib.deflateRaw);

function packWith(entry: ZipEntry, packed: Buffer | null): Packed {
  const raw = Buffer.isBuffer(entry.body)
    ? entry.body
    : Buffer.from(entry.body, "utf8");
  // A tiny file can come out bigger deflated; then it is stored as it is.
  const deflated = !!packed && packed.length < raw.length;
  if (raw.length >= U32)
    throw new RangeError("A file this big can't be zipped");
  return {
    name: Buffer.from(entry.name, "utf8"),
    body: deflated ? packed! : raw,
    size: raw.length,
    crc: crc32(raw),
    deflated,
  };
}

function localHeader(p: Packed, time: number, date: number) {
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); // local file header
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // names are UTF-8
  local.writeUInt16LE(p.deflated ? 8 : 0, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(p.crc, 14);
  local.writeUInt32LE(p.body.length, 18);
  local.writeUInt32LE(p.size, 22);
  local.writeUInt16LE(p.name.length, 26);
  local.writeUInt16LE(0, 28); // no extra field
  return local;
}

/**
 * The file's line in the central directory. A file that starts past 4 GB
 * carries its offset in a zip64 extra field instead.
 */
function centralHeader(p: Packed, offset: number, time: number, date: number) {
  const far = offset >= U32;
  const extra = far ? Buffer.alloc(12) : Buffer.alloc(0);
  if (far) {
    extra.writeUInt16LE(0x0001, 0); // zip64 extended information
    extra.writeUInt16LE(8, 2);
    extra.writeBigUInt64LE(BigInt(offset), 4);
  }
  const head = Buffer.alloc(46);
  head.writeUInt32LE(0x02014b50, 0); // central directory header
  head.writeUInt16LE(far ? 45 : 20, 4); // version made by
  head.writeUInt16LE(far ? 45 : 20, 6); // version needed
  head.writeUInt16LE(0x0800, 8);
  head.writeUInt16LE(p.deflated ? 8 : 0, 10);
  head.writeUInt16LE(time, 12);
  head.writeUInt16LE(date, 14);
  head.writeUInt32LE(p.crc, 16);
  head.writeUInt32LE(p.body.length, 20);
  head.writeUInt32LE(p.size, 24);
  head.writeUInt16LE(p.name.length, 28);
  head.writeUInt16LE(extra.length, 30);
  head.writeUInt32LE(0, 38); // external attributes
  head.writeUInt32LE(far ? U32 : offset, 42);
  return Buffer.concat([head, p.name, extra]);
}

/**
 * The records that close the archive: where the central directory starts,
 * how big it is and how many files it lists, with the zip64 pair first
 * when any of those is past what the classic record can hold.
 */
function closing(count: number, start: number, size: number): Buffer {
  const wide = count >= U16 || start >= U32 || size >= U32;
  const parts: Buffer[] = [];
  if (wide) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0); // zip64 end of central directory
    record.writeBigUInt64LE(44n, 4); // size of the rest of this record
    record.writeUInt16LE(45, 12); // version made by
    record.writeUInt16LE(45, 14); // version needed
    record.writeUInt32LE(0, 16); // this disk
    record.writeUInt32LE(0, 20); // the disk the directory starts on
    record.writeBigUInt64LE(BigInt(count), 24);
    record.writeBigUInt64LE(BigInt(count), 32);
    record.writeBigUInt64LE(BigInt(size), 40);
    record.writeBigUInt64LE(BigInt(start), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0); // zip64 end of central directory locator
    locator.writeUInt32LE(0, 4);
    locator.writeBigUInt64LE(BigInt(start + size), 8);
    locator.writeUInt32LE(1, 16); // one disk in all
    parts.push(record, locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(Math.min(count, U16), 8);
  end.writeUInt16LE(Math.min(count, U16), 10);
  end.writeUInt32LE(Math.min(size, U32), 12);
  end.writeUInt32LE(Math.min(start, U32), 16);
  parts.push(end);
  return Buffer.concat(parts);
}

/** A small archive, built in memory (a .docx is a handful of files). */
export function zip(entries: ZipEntry[], at = new Date()): Buffer {
  const { time, date } = dosStamp(at);
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = Buffer.isBuffer(entry.body)
      ? entry.body
      : Buffer.from(entry.body, "utf8");
    const p = packWith(
      { name: entry.name, body: raw },
      zlib.deflateRawSync(raw),
    );
    const local = localHeader(p, time, date);
    locals.push(local, p.name, p.body);
    central.push(centralHeader(p, offset, time, date));
    offset += local.length + p.name.length + p.body.length;
  }
  const directory = Buffer.concat(central);
  return Buffer.concat([
    ...locals,
    directory,
    closing(entries.length, offset, directory.length),
  ]);
}

/**
 * An archive written as it is read: each file is deflated in zlib's own
 * threads and handed on before the next is asked for, so only the central
 * directory (a few dozen bytes a file) is held until the end.
 */
export async function* zipStream(
  entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>,
  at = new Date(),
): AsyncGenerator<Buffer> {
  const { time, date } = dosStamp(at);
  const central: Buffer[] = [];
  let offset = 0;
  let count = 0;
  for await (const entry of entries) {
    const raw = Buffer.isBuffer(entry.body)
      ? entry.body
      : Buffer.from(entry.body, "utf8");
    const p = packWith(
      { name: entry.name, body: raw },
      raw.length >= TINY ? await deflateRawAsync(raw) : null,
    );
    const local = localHeader(p, time, date);
    yield Buffer.concat([local, p.name]);
    yield p.body;
    central.push(centralHeader(p, offset, time, date));
    offset += local.length + p.name.length + p.body.length;
    count++;
  }
  const directory = Buffer.concat(central);
  central.length = 0;
  yield directory;
  yield closing(count, offset, directory.length);
}

// ---------------------------------------------------------------- reading

/** A file read back out of a zip. */
export type UnzippedFile = { name: string; body: Buffer };

export class ZipError extends Error {}

const inflateRawAsync = promisify(zlib.inflateRaw);

/**
 * Read the files in a zip (DATA-08: a folder of Markdown notes, a Notion
 * export). Only what imports need: stored and deflated files, found through
 * the central directory, with limits on how many and how big so a crafted
 * archive can't blow up in memory. Directories and zip64 are skipped.
 *
 * Only files `read` wants are unpacked, off the main thread, so a large
 * export full of pictures doesn't hold up other requests; the rest come back
 * with an empty body (their size still counts toward the limit, from the
 * central directory).
 */
export async function unzip(
  archive: Buffer,
  limits: {
    maxFiles: number;
    maxBytes: number;
    keep?: (name: string) => boolean;
    read?: (name: string) => boolean;
  },
): Promise<UnzippedFile[]> {
  // The end-of-central-directory record: in the last 64 KB + 22 bytes.
  let end = -1;
  for (
    let i = archive.length - 22;
    i >= Math.max(0, archive.length - 65_557);
    i--
  )
    if (archive.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new ZipError("This isn't a zip file.");
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  const out: UnzippedFile[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > archive.length || archive.readUInt32LE(at) !== 0x02014b50)
      throw new ZipError("The zip file is damaged.");
    const method = archive.readUInt16LE(at + 10);
    const packed = archive.readUInt32LE(at + 20);
    const size = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const local = archive.readUInt32LE(at + 42);
    const flags = archive.readUInt16LE(at + 8);
    const raw = archive.subarray(at + 46, at + 46 + nameLength);
    // Bit 11: the name is UTF-8; older tools wrote CP437, read as Latin-1.
    const name = raw.toString(flags & 0x800 ? "utf8" : "latin1");
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/") || (limits.keep && !limits.keep(name))) continue;
    if (out.length >= limits.maxFiles)
      throw new ZipError(`The zip has more than ${limits.maxFiles} files.`);
    total += size;
    if (size === U32 || packed === U32 || total > limits.maxBytes)
      throw new ZipError("The zip is too big once unpacked.");
    if (method !== 0 && method !== 8) continue;
    if (limits.read && !limits.read(name)) {
      out.push({ name, body: Buffer.alloc(0) });
      continue;
    }
    if (
      local + 30 > archive.length ||
      archive.readUInt32LE(local) !== 0x04034b50
    )
      throw new ZipError("The zip file is damaged.");
    const start =
      local +
      30 +
      archive.readUInt16LE(local + 26) +
      archive.readUInt16LE(local + 28);
    const data = archive.subarray(start, start + packed);
    let body: Buffer;
    if (method === 0) body = Buffer.from(data);
    else
      try {
        body = await inflateRawAsync(data, {
          maxOutputLength: Math.max(size, 1),
        });
      } catch {
        throw new ZipError("The zip file is damaged.");
      }
    if (body.length !== size) throw new ZipError("The zip file is damaged.");
    out.push({ name, body });
  }
  return out;
}
