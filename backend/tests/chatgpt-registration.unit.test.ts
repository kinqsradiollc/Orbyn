import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  mkdtemp,
  rm,
  readdir,
  readFile,
  stat,
  writeFile,
  rename,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
const { createChatgptRegistrationStore: create } = createRequire(
  import.meta.url,
)("../../desktop/chatgpt-registration.cjs");
const { exchangeChatgptCode } = createRequire(import.meta.url)(
  "../../desktop/chatgpt-oauth.cjs",
);

test("an expired code leaves the issued registration available for a fresh attempt", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "orbyn-registration-"));
  try {
    const options = {
      directory,
      apiBaseUrl: "https://fixture.invalid",
      userId: randomUUID(),
    };
    const store = await create(options);
    assert.deepEqual(await store.list(), []);
    const first = await store.read();
    const saved = await store.retain("oaiapp_fixture", first.revision);
    await assert.rejects(
      exchangeChatgptCode(
        {
          clientId: saved.clientId,
          code: "expired-fixture-code",
          verifier: "v".repeat(43),
          redirectUri: "http://127.0.0.1:12345/auth/callback",
        },
        {
          fetch: async () =>
            new Response(JSON.stringify({ error: "invalid_grant" }), {
              status: 400,
            }),
        },
      ),
      (error: any) => error.code === "AUTH_CODE_EXPIRED",
    );
    assert.deepEqual(await (await create(options)).read(), saved);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("registration survives a restart and retains issued IDs before code exchange", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "orbyn-registration-"));
  try {
    const options = {
      directory,
      apiBaseUrl: "https://fixture.invalid/api",
      userId: randomUUID(),
    };
    const store = await create(options);
    const first = await store.read();
    assert.equal(first.clientId, null);
    const retained = await store.retain("oaiapp_fixture", first.revision);
    assert.equal(retained.hostId, first.hostId);
    assert.notEqual(retained.revision, first.revision);
    assert.deepEqual(await (await create(options)).read(), retained);
    assert.deepEqual(
      await store.retain("oaiapp_fixture", retained.revision),
      retained,
    );
    await assert.rejects(
      store.retain("oaiapp_replacement", retained.revision),
      /changed/,
    );
    await assert.rejects(
      store.retain("oaiapp_fixture", first.revision),
      /changed/,
    );
    assert.throws(() =>
      store.retain("dynamic_agent_client", retained.revision),
    );
    const [name] = (await readdir(directory)).filter((name) =>
      name.endsWith(".json"),
    );
    const file = path.join(directory, name);
    const saved = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(Object.keys(saved).sort(), [
      "clientId",
      "hostId",
      "namespace",
      "registrationId",
      "revision",
      "userId",
      "version",
    ]);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    delete saved.registrationId;
    await writeFile(file, JSON.stringify(saved));
    assert.deepEqual(await (await create(options)).read(), retained);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("registrations isolate accounts and servers and reject corrupt or symlinked metadata", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "orbyn-registration-"));
  try {
    const options = {
      directory,
      apiBaseUrl: "https://fixture.invalid/api",
      userId: randomUUID(),
    };
    const store = await create(options);
    const first = await store.read();
    const [name] = (await readdir(directory)).filter((name) =>
      name.endsWith(".json"),
    );
    const file = path.join(directory, name);
    const original = await readFile(file);
    const other = await create({ ...options, userId: randomUUID() });
    assert.equal((await other.read()).hostId, first.hostId);
    const server = await create({
      ...options,
      apiBaseUrl: "https://other.invalid/api",
    });
    assert.equal((await server.read()).hostId, first.hostId);
    await writeFile(
      file,
      JSON.stringify({
        ...JSON.parse(original.toString()),
        userId: randomUUID(),
      }),
    );
    await assert.rejects(store.read(), /unavailable/);
    await writeFile(file, original);
    await rename(file, `${file}.target`);
    await symlink(`${file}.target`, file);
    await assert.rejects(store.read(), /unavailable/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent issued registrations have one winner", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "orbyn-registration-"));
  try {
    const store = await create({
      directory,
      apiBaseUrl: "https://fixture.invalid",
      userId: randomUUID(),
    });
    const first = await store.read();
    const result = await Promise.allSettled([
      store.retain("oaiapp_a", first.revision),
      store.retain("oaiapp_b", first.revision),
    ]);
    assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(result.filter((r) => r.status === "rejected").length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("multiple ChatGPT registrations coexist under the same Orbyn account", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "orbyn-registration-"));
  try {
    const options = {
      directory,
      apiBaseUrl: "https://fixture.invalid",
      userId: randomUUID(),
    };
    const firstId = randomUUID(),
      secondId = randomUUID();
    const first = await create({ ...options, registrationId: firstId });
    const second = await create({ ...options, registrationId: secondId });
    const a = await first.read(),
      b = await second.read();
    await first.retain("oaiapp_first", a.revision);
    await second.retain("oaiapp_second", b.revision);
    assert.equal((await first.read()).clientId, "oaiapp_first");
    assert.equal((await second.read()).clientId, "oaiapp_second");
    const listed = await first.list();
    assert.equal(listed.length, 2);
    assert.deepEqual(
      new Set(listed.map((r: any) => r.registrationId)),
      new Set([firstId, secondId]),
    );
    assert.deepEqual(Object.keys(listed[0]).sort(), [
      "binding",
      "clientId",
      "hostId",
      "registrationId",
      "revision",
    ]);
    const foreign = await create({ ...options, userId: randomUUID() });
    await foreign.read();
    assert.equal((await first.list()).length, 2);
    assert.deepEqual(
      await (await create({ ...options, registrationId: firstId })).read(),
      await first.read(),
    );
    await assert.rejects(create({ ...options, registrationId: "../escape" }));
    const files = (await readdir(directory)).filter((name) =>
      name.endsWith(".json"),
    );
    const records = await Promise.all(
      files.map(async (name) => ({
        name,
        value: JSON.parse(await readFile(path.join(directory, name), "utf8")),
      })),
    );
    const aFile = records.find((r) => r.value.registrationId === firstId)!;
    const bFile = records.find((r) => r.value.registrationId === secondId)!;
    await writeFile(
      path.join(directory, bFile.name),
      JSON.stringify(aFile.value),
    );
    await assert.rejects(second.read(), /unavailable/);
    await assert.rejects(first.list(), /unavailable/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verified connection metadata remains bound to its owner, issued client and identity", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "orbyn-registration-"));
  try {
    const options = {
      directory,
      apiBaseUrl: "https://fixture.invalid",
      userId: randomUUID(),
    };
    const store = await create(options);
    assert.equal(await store.connection(), null);
    const first = await store.read();
    const retained = await store.retain("oaiapp_fixture", first.revision);
    const binding = {
      user_id: options.userId,
      connection_id: randomUUID(),
      issuer: "https://auth.openai.com",
      subject: "fixture-subject",
      client_id: "oaiapp_fixture",
    };
    const linked = await store.linkVerifiedConnection(
      binding,
      retained.revision,
    );
    assert.deepEqual(await store.connection(), binding);
    assert.deepEqual(await (await create(options)).connection(), binding);
    assert.deepEqual((await store.list())[0].binding, binding);
    await assert.rejects(
      store.linkVerifiedConnection(binding, retained.revision),
      /changed/,
    );
    await assert.rejects(
      store.linkVerifiedConnection(
        { ...binding, subject: "other" },
        linked.revision,
      ),
      /changed/,
    );
    await assert.rejects(
      store.linkVerifiedConnection(
        { ...binding, client_id: "oaiapp_other" },
        linked.revision,
      ),
      /changed/,
    );
    assert.throws(() =>
      store.linkVerifiedConnection(
        { ...binding, user_id: randomUUID() },
        linked.revision,
      ),
    );
    assert.deepEqual(await store.connection(), binding);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("separate store instances serialize competing registration writes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "orbyn-registration-"));
  try {
    const options = {
      directory,
      apiBaseUrl: "https://fixture.invalid",
      userId: randomUUID(),
    };
    const first = await create(options),
      second = await create(options);
    const value = await first.read();
    const results = await Promise.allSettled([
      first.retain("oaiapp_first", value.revision),
      second.retain("oaiapp_second", value.revision),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    assert.deepEqual(await first.read(), await second.read());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("active selection persists, rejects unverified slots and fences competing choices", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "orbyn-selection-"));
  try {
    const options = {
      directory,
      apiBaseUrl: "https://fixture.invalid",
      userId: randomUUID(),
    };
    const aId = randomUUID(),
      bId = randomUUID();
    const a = await create({ ...options, registrationId: aId });
    const b = await create({ ...options, registrationId: bId });
    assert.deepEqual(await a.selection(), {
      registrationId: null,
      revision: null,
    });
    await assert.rejects(a.select(aId, null), /Connect/);
    for (const [store, client] of [
      [a, "oaiapp_a"],
      [b, "oaiapp_b"],
    ] as const) {
      const initial = await store.read();
      const retained = await store.retain(client, initial.revision);
      await store.linkVerifiedConnection(
        {
          user_id: options.userId,
          connection_id: randomUUID(),
          issuer: "https://auth.openai.com",
          subject: client,
          client_id: client,
        },
        retained.revision,
      );
    }
    const outcomes = await Promise.allSettled([
      a.select(aId, null),
      b.select(bId, null),
    ]);
    assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((r) => r.status === "rejected").length, 1);
    const selected = await a.selection();
    assert.equal(selected.registrationId, aId);
    const active = await b.activeConnection();
    assert.equal(active.status, "selected");
    assert.equal(active.registrationId, aId);
    assert.deepEqual(active.binding, await a.connection());
    assert.deepEqual(await (await create(options)).selection(), selected);
    const cleared = await b.select(null, selected.revision);
    assert.equal(cleared.registrationId, null);
    assert.deepEqual(await a.activeConnection(), {
      status: "unselected",
      revision: cleared.revision,
    });
    const chosenAgain = await a.select(aId, cleared.revision);
    await assert.rejects(a.select(aId, selected.revision), /changed/);
    const files = (await readdir(directory)).filter((name) =>
      name.endsWith(".json"),
    );
    for (const name of files) {
      const value = JSON.parse(
        await readFile(path.join(directory, name), "utf8"),
      );
      if (value.registrationId === aId) await rm(path.join(directory, name));
    }
    assert.deepEqual(await b.activeConnection(), {
      status: "unavailable",
      registrationId: aId,
      revision: chosenAgain.revision,
    });
    assert.deepEqual(await a.selection(), chosenAgain);
    const foreign = await create({ ...options, userId: randomUUID() });
    assert.deepEqual(await foreign.selection(), {
      registrationId: null,
      revision: null,
    });
    await assert.rejects(foreign.select(aId, null), /Connect/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("local model preferences persist by verified registration with optimistic updates", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "orbyn-model-preference-"),
  );
  try {
    const options = {
      directory,
      apiBaseUrl: "https://fixture.invalid",
      userId: randomUUID(),
      registrationId: randomUUID(),
    };
    const store = await create(options);
    await assert.rejects(store.modelPreference(), /Connect/);
    const initial = await store.read();
    const retained = await store.retain("oaiapp_fixture", initial.revision);
    const binding = {
      user_id: options.userId,
      connection_id: randomUUID(),
      issuer: "https://auth.openai.com",
      subject: "fixture",
      client_id: "oaiapp_fixture",
    };
    await store.linkVerifiedConnection(binding, retained.revision);
    const first = await store.modelPreference();
    assert.deepEqual(first, { binding, model: null, version: 0 });
    const other = await create(options);
    const result = await Promise.allSettled([
      store.saveModelPreference({ ...first, model: "fixture-model" }),
      other.saveModelPreference({ ...first, model: "other-model" }),
    ]);
    assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(result.filter((r) => r.status === "rejected").length, 1);
    const saved = await other.modelPreference();
    assert.equal(saved.model, "fixture-model");
    assert.equal(saved.version, 1);
    assert.deepEqual(await (await create(options)).modelPreference(), saved);
    await assert.rejects(
      store.saveModelPreference({
        ...saved,
        binding: { ...binding, subject: "another" },
      }),
      /account changed/,
    );
    const cleared = await store.saveModelPreference({ ...saved, model: null });
    assert.equal(cleared.model, null);
    assert.equal(cleared.version, 2);
    const separate = await create({ ...options, registrationId: randomUUID() });
    const separateInitial = await separate.read();
    const separateRetained = await separate.retain(
      "oaiapp_separate",
      separateInitial.revision,
    );
    const separateBinding = {
      ...binding,
      connection_id: randomUUID(),
      subject: "separate",
      client_id: "oaiapp_separate",
    };
    await separate.linkVerifiedConnection(
      separateBinding,
      separateRetained.revision,
    );
    assert.deepEqual(await separate.modelPreference(), {
      binding: separateBinding,
      model: null,
      version: 0,
    });
    const selected = await store.select(options.registrationId, null);
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(
      store.saveModelPreference(
        { ...cleared, model: "cancelled-model" },
        { signal: abort.signal, selectionRevision: selected.revision },
      ),
    );
    assert.deepEqual(await store.modelPreference(), cleared);
    const switched = store.select(null, selected.revision);
    const staleSave = store.saveModelPreference(
      { ...cleared, model: "stale-model" },
      { selectionRevision: selected.revision },
    );
    await switched;
    await assert.rejects(staleSave, /account changed/);
    assert.deepEqual(await store.modelPreference(), cleared);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
