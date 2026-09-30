import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatgptModelPicker } from "@orbyn/api-client";
import {
  chatgptModelBinding,
  type ChatgptModelBinding,
  type ChatgptModelPreference,
} from "@orbyn/core";

const binding: ChatgptModelBinding = {
  user_id: "00000000-0000-4000-8000-000000000001",
  connection_id: "00000000-0000-4000-8000-000000000002",
  issuer: "https://auth.openai.com",
  subject: "account-a",
  client_id: "oaiapp_fixture_a",
};
const models = [
  { slug: "model-a", display_name: "Model A" },
  { slug: "model-b", display_name: "Model B" },
];
function fixture(
  options: {
    saved?: ChatgptModelPreference;
    catalog?: () => Promise<typeof models>;
  } = {},
) {
  let saved = options.saved ?? {
    binding: { ...binding },
    model: "model-a",
    version: 1,
  };
  const writes: ChatgptModelPreference[] = [];
  const picker = new ChatgptModelPicker({
    binding,
    models: async () => (options.catalog ? options.catalog() : models),
    store: {
      read: async () => saved,
      write: async (preference) => {
        writes.push(preference);
        assert.equal(preference.version, saved.version);
        saved = { ...preference, version: preference.version + 1 };
        return saved;
      },
    },
  });
  return { picker, writes };
}
test("settings and composer observe one account's catalog and versioned default", async () => {
  const { picker, writes } = fixture();
  let settings = 0;
  let composer = 0;
  const detach = picker.subscribe(() => settings++);
  picker.subscribe(() => composer++);
  await picker.load();
  assert.equal(picker.defaultStatus().status, "available");
  await picker.setDefault("model-b");
  assert.equal(picker.snapshot().preference?.model, "model-b");
  assert.equal(picker.snapshot().preference?.version, 2);
  assert.equal(settings, composer);
  assert.equal(writes[0].version, 1);
  detach();
  picker.close();
  assert.equal(composer, settings + 1);
});
test("a removed default stays unavailable and an unentitled choice cannot be saved", async () => {
  const { picker, writes } = fixture({
    saved: { binding, model: "removed", version: 4 },
  });
  await picker.load();
  assert.deepEqual(picker.defaultStatus(), {
    status: "unavailable",
    slug: "removed",
  });
  await assert.rejects(picker.setDefault("other"), /not available/);
  assert.equal(writes.length, 0);
});
test("preference responses from another user, connection, subject or registration fail closed", async () => {
  for (const key of [
    "user_id",
    "connection_id",
    "subject",
    "client_id",
  ] as const) {
    const foreign = {
      ...binding,
      [key]:
        key.endsWith("_id") && key !== "client_id"
          ? "00000000-0000-4000-8000-000000000003"
          : "another",
    };
    const { picker } = fixture({
      saved: { binding: foreign, model: "model-a", version: 1 },
    });
    await picker.load();
    assert.equal(picker.snapshot().status, "unavailable");
    assert.equal(picker.snapshot().models.length, 0);
  }
});
test("a failed catalog refresh disables choices instead of retaining an entitled-looking stale list", async () => {
  let fail = false;
  const { picker } = fixture({
    catalog: async () => {
      if (fail) throw Error("private-provider-detail");
      return models;
    },
  });
  await picker.load();
  fail = true;
  await picker.load();
  assert.equal(picker.snapshot().status, "unavailable");
  assert.deepEqual(picker.snapshot().models, []);
  assert.equal(picker.defaultStatus().status, "unavailable");
  assert.ok(!picker.snapshot().error?.includes("private-provider-detail"));
});
test("late loads cannot replace a newer load or reopen a closed connection", async () => {
  let release!: (value: typeof models) => void;
  let calls = 0;
  const { picker } = fixture({
    catalog: async () => {
      if (++calls === 1)
        return new Promise((done) => {
          release = done;
        });
      return [models[1]];
    },
  });
  const old = picker.load();
  await picker.load();
  release([models[0]]);
  await old;
  assert.deepEqual(picker.snapshot().models, [models[1]]);
  let finish!: (value: typeof models) => void;
  const closed = fixture({
    catalog: () =>
      new Promise((done) => {
        finish = done;
      }),
  }).picker;
  const pending = closed.load();
  closed.close();
  finish(models);
  await pending;
  assert.equal(closed.snapshot().status, "idle");
  assert.equal(closed.snapshot().preference, null);
});
test("conflicting default writes disable the picker until its preference is reloaded", async () => {
  const picker = new ChatgptModelPicker({
    binding,
    models: async () => models,
    store: {
      read: async () => ({ binding, model: "model-a", version: 1 }),
      write: async () => {
        throw { status: 409 };
      },
    },
  });
  await picker.load();
  await assert.rejects(picker.setDefault("model-b"), /not saved/);
  assert.equal(picker.snapshot().status, "unavailable");
  assert.equal(picker.snapshot().saving, false);
});
test("a concurrent save is rejected and a late receipt cannot reopen a closed connection", async () => {
  let complete!: (value: ChatgptModelPreference) => void;
  const picker = new ChatgptModelPicker({
    binding,
    models: async () => models,
    store: {
      read: async () => ({ binding, model: "model-a", version: 1 }),
      write: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    },
  });
  await picker.load();
  const save = picker.setDefault("model-b");
  await assert.rejects(picker.setDefault("model-a"), /already in progress/);
  picker.close();
  complete({ binding, model: "model-b", version: 2 });
  await save;
  assert.equal(picker.snapshot().status, "idle");
  assert.equal(picker.snapshot().preference, null);
});

test("view snapshots and supplied binding cannot mutate the connection's state", async () => {
  const { picker } = fixture();
  await picker.load();
  const snapshot = picker.snapshot();
  snapshot.models[0].slug = "changed";
  snapshot.preference!.binding.subject = "changed";
  assert.equal(picker.snapshot().models[0].slug, "model-a");
  assert.equal(picker.snapshot().preference!.binding.subject, "account-a");
  assert.throws(() =>
    chatgptModelBinding.parse({
      ...binding,
      client_id: "dynamic_agent_client",
    }),
  );
  assert.throws(() =>
    chatgptModelBinding.parse({ ...binding, access_token: "fixture" }),
  );
});
