import { deflateRawSync } from "node:zlib";

/**
 * Just enough ZIP to write a Word document.
 *
 * A .docx is a zip of a few XML files, and Node already has the hard part —
 * DEFLATE, in zlib. What is left is the container: a local header before
 * each file, a central directory listing them, and a record saying where
 * that directory starts. Writing those by hand keeps a whole compression
 * library out of the image for the sake of one export format.
 *
 * Only what a .docx needs is here: no directories, no encryption, no zip64,
 * no data descriptors. Files are stored deflated, or uncompressed when
 * deflating would make them bigger.
 */

export type ZipEntry = { name: string; body: string | Buffer };

/** CRC-32, as the zip format wants it. The table is built once. */
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

export function zip(entries: ZipEntry[], at = new Date()): Buffer {
  const { time, date } = dosStamp(at);
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.isBuffer(entry.body)
      ? entry.body
      : Buffer.from(entry.body, "utf8");
    const packed = deflateRawSync(raw);
    // A tiny file can come out bigger deflated; then it is stored as it is.
    const deflated = packed.length < raw.length;
    const body = deflated ? packed : raw;
    const sum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(deflated ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // no extra field
    locals.push(local, name, body);

    const entryHeader = Buffer.alloc(46);
    entryHeader.writeUInt32LE(0x02014b50, 0); // central directory header
    entryHeader.writeUInt16LE(20, 4); // version made by
    entryHeader.writeUInt16LE(20, 6); // version needed
    entryHeader.writeUInt16LE(0x0800, 8);
    entryHeader.writeUInt16LE(deflated ? 8 : 0, 10);
    entryHeader.writeUInt16LE(time, 12);
    entryHeader.writeUInt16LE(date, 14);
    entryHeader.writeUInt32LE(sum, 16);
    entryHeader.writeUInt32LE(body.length, 20);
    entryHeader.writeUInt32LE(raw.length, 24);
    entryHeader.writeUInt16LE(name.length, 28);
    entryHeader.writeUInt32LE(0, 38); // external attributes
    entryHeader.writeUInt32LE(offset, 42);
    central.push(entryHeader, name);

    offset += local.length + name.length + body.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
