import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  stat,
  rename,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const { getChatgptHostId: get } = createRequire(import.meta.url)(
  "../../desktop/chatgpt-host.cjs",
);

test("separate processes converge on one installation ID without replacing it", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "orbyn-host-process-"));
  try {
    const modulePath = createRequire(import.meta.url).resolve(
      "../../desktop/chatgpt-host.cjs",
    );
    const source = `require(${JSON.stringify(modulePath)}).getChatgptHostId(${JSON.stringify(directory)}).then(value=>process.stdout.write(value)).catch(()=>process.exit(1));`;
    const result = await Promise.all(
      Array.from({ length: 4 }, () =>
        promisify(execFile)(process.execPath, ["-e", source], {
          timeout: 10000,
        }),
      ),
    );
    assert.equal(new Set(result.map((r) => r.stdout)).size, 1);
    assert.equal(await get(directory), result[0].stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("installation host ID is stable across concurrent readers and private on disk", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "orbyn-host-"));
  try {
    const values = await Promise.all(
      Array.from({ length: 20 }, () => get(directory)),
    );
    assert.equal(new Set(values).size, 1);
    assert.equal(await get(directory), values[0]);
    const file = path.join(directory, "installation.host");
    assert.equal((await readFile(file, "utf8")).trim(), values[0]);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("corrupt or symlinked host metadata is rejected and never replaced", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "orbyn-host-"));
  try {
    await get(directory);
    const file = path.join(directory, "installation.host");
    await writeFile(file, "invalid-fixture");
    await assert.rejects(get(directory), /unavailable/);
    assert.equal(await readFile(file, "utf8"), "invalid-fixture");
    await rename(file, `${file}.target`);
    await symlink(`${file}.target`, file);
    await assert.rejects(get(directory), /unavailable/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
