const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const pending = new Map();

/** Stable installation metadata; host IDs are opaque identifiers, not credentials. */
async function getChatgptHostId(directory) {
  if (typeof directory !== "string" || !path.isAbsolute(directory))
    throw new Error("Invalid ChatGPT host storage.");
  directory = path.resolve(directory);
  if (pending.has(directory)) return pending.get(directory);
  const task = loadHost(directory);
  pending.set(directory, task);
  try {
    return await task;
  } finally {
    if (pending.get(directory) === task) pending.delete(directory);
  }
}

async function loadHost(directory) {
  const filename = path.join(directory, "installation.host");
  const read = async () => {
    let file;
    try {
      const before = await fs.lstat(filename);
      if (!before.isFile() || before.isSymbolicLink() || before.size > 64)
        throw new Error();
      file = await fs.open(
        filename,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      const after = await file.stat();
      if (
        !after.isFile() ||
        after.dev !== before.dev ||
        after.ino !== before.ino ||
        after.size > 64
      )
        throw new Error();
      const bytes = Buffer.alloc(65);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      const value = bytes.subarray(0, bytesRead).toString("utf8").trim();
      if (
        bytesRead > 64 ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          value,
        )
      )
        throw new Error();
      return value;
    } finally {
      await file?.close().catch(() => {});
    }
  };
  try {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error();
    await fs.chmod(directory, 0o700);
    try {
      return await read();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const temporary = path.join(directory, `${randomUUID()}.host.tmp`);
    let file;
    try {
      file = await fs.open(temporary, "wx", 0o600);
      await file.writeFile(randomUUID() + "\n");
      await file.sync();
      await file.close();
      file = null;
      // Publish a complete file without replacing a concurrent process's ID.
      await fs.link(temporary, filename).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
      return await read();
    } finally {
      await file?.close().catch(() => {});
      await fs.unlink(temporary).catch(() => {});
    }
  } catch {
    throw new Error("ChatGPT host metadata is unavailable.");
  }
}

module.exports = { getChatgptHostId };
