// Pure web workspace lifecycle contracts; no browser, account, API or database.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WorkspaceController,
  type FrameLease,
  type FrameOwner,
} from "../../web/src/app/workspace/controller";

const noopOwner = (): FrameOwner => ({
  prepare: async () => true,
  blocksParking: () => false,
});

test("input authority advances immediately but observers run after the input event", async () => {
  const f = fixture();
  try {
    f.controller.register(f.first.lease, noopOwner());
    const scope = f.controller.routeScope(f.first.lease);
    let updates = 0;
    const off = scope.subscribe(() => updates++);
    const before = scope.getSnapshot();
    assert.equal(before.inputEpoch, 0);
    scope.noteInput?.();
    const after = scope.getSnapshot();
    assert.notEqual(after, before);
    assert.equal(after.inputEpoch, 1);
    assert.equal(
      updates,
      0,
      "capture-phase notification can reset controlled input before its change handler",
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.equal(updates, 1);
    scope.setTitle("Saved without user input");
    assert.equal(scope.getSnapshot().inputEpoch, 1);
    off();
  } finally {
    f.close();
  }
});

test("input revokes prepared exit synchronously and coalesces observer updates", async () => {
  const f = fixture();
  try {
    f.controller.register(f.first.lease, noopOwner());
    const scope = f.controller.routeScope(f.first.lease);
    const permit = await f.controller.prepareAll("reload");
    assert.equal(permit.allowed, true);
    let updates = 0;
    const off = scope.subscribe(() => updates++);
    scope.noteInput?.();
    scope.noteInput?.();
    scope.noteInput?.();
    assert.equal(
      permit.current(),
      false,
      "delayed rendering must never delay authority revocation",
    );
    assert.equal(scope.getSnapshot().inputEpoch, 3);
    assert.equal(updates, 0);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.equal(updates, 1);
    off();
  } finally {
    f.close();
  }
});

test("destroy cancels a pending input notification without publishing old account state", async () => {
  const f = fixture();
  f.controller.register(f.first.lease, noopOwner());
  const scope = f.controller.routeScope(f.first.lease);
  let updates = 0;
  scope.subscribe(() => updates++);
  scope.noteInput?.();
  f.close();
  const atClose = updates;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(updates, atClose);
  assert.equal(scope.getSnapshot().visible, false);
});

test("retired frame input cannot invalidate another tab's prepared departure", async () => {
  const f = fixture();
  try {
    f.controller.register(f.first.lease, noopOwner());
    const stale = f.controller.routeScope(f.first.lease);
    const second = await secondTab(f.controller, f.first.lease);
    assert.equal(
      (
        await f.controller.command(second.lease, {
          type: "close",
          key: f.first.lease.tabKey,
        })
      ).kind,
      "committed",
    );
    const permit = await f.controller.prepareAll("reload");
    assert.equal(permit.allowed, true);
    stale.noteInput?.();
    assert.equal(permit.current(), true);
  } finally {
    f.close();
  }
});

test("a dock non-object link opens only its captured working origin", async () => {
  const f = fixture();
  try {
    f.controller.register(f.first.lease, noopOwner());
    assert.equal(
      (await f.controller.peek(f.first.lease, "/app/doc/dock-doc")).kind,
      "committed",
    );
    const dock = f.controller
      .getSnapshot()
      .frames.find((one) => one.lease.pane === "dock")!;
    f.controller.register(dock.lease, noopOwner());
    const scope = f.controller.routeScope(dock.lease);
    assert.equal((await scope.navigate("/app/tasks")).kind, "committed");
    const working = f.controller
      .getSnapshot()
      .frames.find(
        (one) =>
          one.lease.pane === "primary" &&
          one.lease.tabKey === f.first.lease.tabKey,
      )!;
    assert.equal(working.destination.href, "/app/tasks");
    assert.equal(
      f.controller.getSnapshot().dock[0].destination.href,
      "/app/doc/dock-doc",
    );
  } finally {
    f.close();
  }
});

test("dock non-object navigation refuses after captured origin closes", async () => {
  const f = fixture();
  try {
    f.controller.register(f.first.lease, noopOwner());
    const second = await secondTab(f.controller, f.first.lease);
    assert.equal(
      (await f.controller.peek(f.first.lease, "/app/doc/dock-doc")).kind,
      "committed",
    );
    const dock = f.controller
      .getSnapshot()
      .frames.find((one) => one.lease.pane === "dock")!;
    f.controller.register(dock.lease, noopOwner());
    assert.equal(
      (
        await f.controller.command(second.lease, {
          type: "close",
          key: f.first.lease.tabKey,
        })
      ).kind,
      "committed",
    );
    const result = await f.controller.routeScope(dock.lease).activateNavigate!(
      "/app/tasks",
    );
    assert.equal(result.kind, "refused");
    assert.equal(f.controller.getSnapshot().primary.tabs.length, 1);
    assert.equal(
      f.controller
        .getSnapshot()
        .frames.find((one) => one.lease.pane === "primary")!.destination.href,
      "/app/doc/d2",
    );
  } finally {
    f.close();
  }
});
function fixture(
  prepareGlobal?: ConstructorParameters<
    typeof WorkspaceController
  >[0]["prepareGlobal"],
) {
  let generation = 1;
  const controller = new WorkspaceController({
    userId: "fixture-user",
    generation,
    currentGeneration: () => generation,
    initialHref: "/app/doc/d1",
    projectBrowser: () => true,
    prepareGlobal,
  });
  const first = controller.getSnapshot().frames[0];
  const close = () => controller.destroy();
  return {
    controller,
    first,
    close,
    changeAccount() {
      generation++;
    },
  };
}
async function secondTab(controller: WorkspaceController, origin: FrameLease) {
  assert.equal(
    (await controller.open({ origin, href: "/app/doc/d2", target: "new-tab" }))
      .kind,
    "committed",
  );
  const frame = controller
    .getSnapshot()
    .frames.find((frame) => frame.destination.id === "d2")!;
  controller.register(frame.lease, noopOwner());
  return frame;
}

test("save preparation retitles the closing page without superseding its own close", async () => {
  const { controller, first, close } = fixture();
  try {
    controller.register(first.lease, {
      blocksParking: () => false,
      prepare: async () => {
        controller.routeScope(first.lease).setTitle("Saved title");
        return true;
      },
    });
    const second = await secondTab(controller, first.lease);
    assert.equal(
      (
        await controller.command(second.lease, {
          type: "close",
          key: first.lease.tabKey,
        })
      ).kind,
      "committed",
    );
    assert.equal(
      controller.getSnapshot().primary.closed.at(-1)?.history[0].title,
      "Saved title",
    );
  } finally {
    close();
  }
});

test("unrelated retained title updates survive a planned close; reload preparation also remains current", async () => {
  const { controller, first, close } = fixture();
  let second: Awaited<ReturnType<typeof secondTab>>;
  try {
    controller.register(first.lease, {
      blocksParking: () => false,
      prepare: async () => {
        controller.routeScope(second.lease).setTitle("Other saved title");
        return true;
      },
    });
    second = await secondTab(controller, first.lease);
    assert.equal(
      (
        await controller.command(second.lease, {
          type: "close",
          key: first.lease.tabKey,
        })
      ).kind,
      "committed",
    );
    assert.equal(
      controller
        .getSnapshot()
        .frames.find((frame) => frame.destination.id === "d2")?.title,
      "Other saved title",
    );
    assert.equal(
      controller.getSnapshot().primary.tabs[0].history[0].title,
      "Other saved title",
    );
  } finally {
    close();
  }
  const reload = fixture();
  try {
    reload.controller.register(reload.first.lease, {
      blocksParking: () => false,
      prepare: async () => {
        reload.controller
          .routeScope(reload.first.lease)
          .setTitle("Reload saved");
        return true;
      },
    });
    const ready = await reload.controller.prepareAll("reload");
    assert.equal(ready.allowed, true);
    assert.equal(ready.current(), true);
  } finally {
    reload.close();
  }
});

test("a genuine newer navigation supersedes an old pending close", async () => {
  const { controller, first, close } = fixture();
  let resolve: (ok: boolean) => void = () => {
    throw Error("not started");
  };
  let started: () => void = () => {};
  const entered = new Promise<void>((done) => {
    started = done;
  });
  try {
    controller.register(first.lease, {
      blocksParking: () => false,
      prepare: () => {
        started();
        return new Promise<boolean>((done) => {
          resolve = done;
        });
      },
    });
    const second = await secondTab(controller, first.lease);
    const old = controller.command(second.lease, {
      type: "close",
      key: first.lease.tabKey,
    });
    await entered;
    assert.equal(
      (
        await controller.open({
          origin: second.lease,
          href: "/app/calendar",
          target: "new-tab",
        })
      ).kind,
      "committed",
    );
    resolve(true);
    assert.equal((await old).kind, "superseded");
    assert.equal(controller.getSnapshot().primary.tabs.length, 3);
    assert.ok(
      controller
        .getSnapshot()
        .frames.some((frame) => frame.lease === first.lease),
    );
  } finally {
    close();
  }
});

test("owner replacement during preparation still supersedes; metadata changes alone do not", async () => {
  const { controller, first, close } = fixture();
  let resolve: (ok: boolean) => void = () => {
    throw Error("not started");
  };
  let started: () => void = () => {};
  const entered = new Promise<void>((done) => {
    started = done;
  });
  try {
    const unregister = controller.register(first.lease, {
      blocksParking: () => false,
      prepare: () => {
        started();
        return new Promise<boolean>((done) => {
          resolve = done;
        });
      },
    });
    const second = await secondTab(controller, first.lease);
    const old = controller.command(second.lease, {
      type: "close",
      key: first.lease.tabKey,
    });
    await entered;
    unregister();
    controller.register(first.lease, noopOwner());
    resolve(true);
    assert.equal((await old).kind, "superseded");
    assert.equal(controller.getSnapshot().primary.tabs.length, 2);
  } finally {
    close();
  }
});

test("ordinary titles update tab metadata and durable restore before any navigation", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const controller = new WorkspaceController({
    userId: "fixture-user",
    generation: 1,
    currentGeneration: () => 1,
    initialHref: "/app/doc/d1",
    storage,
    projectBrowser: () => true,
  });
  try {
    const frame = controller.getSnapshot().frames[0];
    controller.register(frame.lease, noopOwner());
    controller.routeScope(frame.lease).setTitle("Revised document");
    const state = controller.getSnapshot();
    assert.equal(state.primary.tabs[0].history[0].title, "Revised document");
    assert.equal(state.frames[0].destination.title, "Revised document");
    const raw = values.get("orbyn-web-workspace-v1:fixture-user");
    assert.ok(raw);
    const restored = JSON.parse(JSON.parse(raw).tabs);
    assert.equal(restored.tabs[0].history[0].title, "Revised document");
    assert.equal(
      (
        await controller.open({
          origin: frame.lease,
          href: "/app/calendar",
          target: "new-tab",
        })
      ).kind,
      "committed",
    );
    assert.equal(
      controller.getSnapshot().primary.tabs[0].history[0].title,
      "Revised document",
    );
  } finally {
    controller.destroy();
  }
});

test("retitling stays with its exact tab destination and pane", async () => {
  const controller = new WorkspaceController({
    userId: "fixture-user",
    generation: 1,
    currentGeneration: () => 1,
    initialHref: "/app/assistant?chat=one",
    projectBrowser: () => true,
  });
  try {
    const first = controller.getSnapshot().frames[0];
    controller.register(first.lease, noopOwner());
    controller.routeScope(first.lease).setTitle("First chat");
    assert.equal(
      (
        await controller.open({
          origin: first.lease,
          href: "/app/assistant?chat=two",
        })
      ).kind,
      "committed",
    );
    controller.routeScope(first.lease).setTitle("Second chat");
    let state = controller.getSnapshot();
    assert.deepEqual(
      state.primary.tabs[0].history.map((p) => p.title),
      ["First chat", "Second chat"],
    );
    assert.equal(
      (await controller.pair(first.lease, "/app/doc/d2")).kind,
      "committed",
    );
    const secondary = controller
      .getSnapshot()
      .frames.find((f) => f.lease.pane === "secondary")!;
    controller.register(secondary.lease, noopOwner());
    controller.routeScope(secondary.lease).setTitle("Side document");
    assert.equal(
      (await controller.peek(secondary.lease, "/app/doc/d3")).kind,
      "committed",
    );
    const dock = controller
      .getSnapshot()
      .frames.find((f) => f.lease.pane === "dock")!;
    controller.register(dock.lease, noopOwner());
    controller.routeScope(dock.lease).setTitle("Dock document");
    state = controller.getSnapshot();
    assert.deepEqual(
      state.primary.tabs[0].history.map((p) => p.title),
      ["First chat", "Second chat"],
    );
    assert.equal(state.secondary?.tabs[0].history[0].title, "Side document");
    assert.equal(state.dock[0].title, "Dock document");
    assert.equal(state.dock[0].destination.title, "Dock document");
  } finally {
    controller.destroy();
  }
});

test("missing and refusing feature owners preserve the mounted workspace", async () => {
  const missing = fixture();
  try {
    const opening = missing.controller.getSnapshot();
    assert.equal(
      (
        await missing.controller.open({
          origin: missing.first.lease,
          href: "/app/calendar",
        })
      ).kind,
      "refused",
    );
    assert.equal(missing.controller.getSnapshot(), opening);
  } finally {
    missing.close();
  }
  const denied = fixture();
  try {
    denied.controller.register(denied.first.lease, {
      blocksParking: () => false,
      prepare: async () => false,
    });
    const second = await secondTab(denied.controller, denied.first.lease);
    const opening = denied.controller.getSnapshot();
    assert.equal(
      (
        await denied.controller.command(second.lease, {
          type: "close",
          key: denied.first.lease.tabKey,
        })
      ).kind,
      "refused",
    );
    assert.equal(denied.controller.getSnapshot(), opening);
  } finally {
    denied.close();
  }
});

test("a feature modal prevents parking without disposing or preparing its draft", async () => {
  const f = fixture();
  let prepared = 0;
  try {
    f.controller.register(f.first.lease, {
      blocksParking: () => true,
      prepare: async () => {
        prepared++;
        return true;
      },
    });
    const opening = f.controller.getSnapshot();
    assert.equal(
      (
        await f.controller.open({
          origin: f.first.lease,
          href: "/app/calendar",
          target: "new-tab",
        })
      ).kind,
      "refused",
    );
    assert.equal(f.controller.getSnapshot(), opening);
    assert.equal(prepared, 0);
  } finally {
    f.close();
  }
});

test("an account transition invalidates a pending close and its old scope", async () => {
  const f = fixture();
  let resolve!: (ok: boolean) => void;
  let entered!: () => void;
  const started = new Promise<void>((done) => (entered = done));
  try {
    f.controller.register(f.first.lease, {
      blocksParking: () => false,
      prepare: () => {
        entered();
        return new Promise((done) => (resolve = done));
      },
    });
    const second = await secondTab(f.controller, f.first.lease);
    const oldScope = f.controller.routeScope(f.first.lease);
    const pending = f.controller.command(second.lease, {
      type: "close",
      key: f.first.lease.tabKey,
    });
    await started;
    f.changeAccount();
    resolve(true);
    assert.equal((await pending).kind, "superseded");
    assert.equal(f.controller.getSnapshot().frames.length, 0);
    assert.equal((await oldScope.navigate("/app/calendar")).kind, "superseded");
  } finally {
    f.close();
  }
});

test("hidden and retired scopes cannot navigate a newer active tab", async () => {
  const f = fixture();
  try {
    f.controller.register(f.first.lease, noopOwner());
    const old = f.controller.routeScope(f.first.lease);
    const second = await secondTab(f.controller, f.first.lease);
    let opening = f.controller.getSnapshot();
    assert.equal((await old.navigate("/app/calendar")).kind, "refused");
    assert.equal(f.controller.getSnapshot(), opening);
    assert.equal(
      (
        await f.controller.command(second.lease, {
          type: "close",
          key: f.first.lease.tabKey,
        })
      ).kind,
      "committed",
    );
    opening = f.controller.getSnapshot();
    assert.equal((await old.navigate("/app/calendar")).kind, "superseded");
    assert.equal(f.controller.getSnapshot(), opening);
  } finally {
    f.close();
  }
});

test("same object query transitions keep the frame and honor its form guards", async () => {
  const f = fixture();
  let prepared = 0;
  try {
    f.controller.register(f.first.lease, {
      blocksParking: () => false,
      prepare: async () => {
        prepared++;
        return true;
      },
    });
    const scope = f.controller.routeScope(f.first.lease),
      initial = scope.getSnapshot().activation;
    const remove = scope.addGuard((to) => !to.includes("blocked"));
    assert.equal((await scope.navigate("/app/doc/d1#blocked")).kind, "refused");
    remove();
    assert.equal(
      (await scope.navigate("/app/doc/d1?mode=write#part")).kind,
      "committed",
    );
    assert.equal(f.controller.getSnapshot().frames[0].lease, f.first.lease);
    assert.equal(scope.getSnapshot().hash, "#part");
    assert.ok(scope.getSnapshot().activation > initial);
    assert.equal(prepared, 0);
  } finally {
    f.close();
  }
});

test("dock full-open refuses to redirect after its captured origin closes", async () => {
  const f = fixture();
  try {
    f.controller.register(f.first.lease, noopOwner());
    const second = await secondTab(f.controller, f.first.lease);
    assert.equal(
      (await f.controller.peek(f.first.lease, "/app/doc/d3")).kind,
      "committed",
    );
    const dock = f.controller
      .getSnapshot()
      .frames.find((x) => x.lease.pane === "dock")!;
    f.controller.register(dock.lease, noopOwner());
    assert.equal(
      (
        await f.controller.command(second.lease, {
          type: "close",
          key: f.first.lease.tabKey,
        })
      ).kind,
      "committed",
    );
    const opening = f.controller.getSnapshot();
    assert.equal(
      (await f.controller.openDockObject(dock.lease)).kind,
      "refused",
    );
    assert.equal(f.controller.getSnapshot(), opening);
  } finally {
    f.close();
  }
});

test("global departure prepares hidden and dock owners and expires on a new guard", async () => {
  const f = fixture(),
    calls: string[] = [];
  const owner = (label: string): FrameOwner => ({
    blocksParking: () => false,
    prepare: async (reason) => {
      calls.push(label + ":" + reason);
      return true;
    },
  });
  try {
    f.controller.register(f.first.lease, owner("first"));
    assert.equal(
      (
        await f.controller.open({
          origin: f.first.lease,
          href: "/app/doc/d2",
          target: "new-tab",
        })
      ).kind,
      "committed",
    );
    const second = f.controller
      .getSnapshot()
      .frames.find((x) => x.destination.id === "d2")!;
    f.controller.register(second.lease, owner("second"));
    assert.equal(
      (await f.controller.peek(second.lease, "/app/doc/d3")).kind,
      "committed",
    );
    const dock = f.controller
      .getSnapshot()
      .frames.find((x) => x.lease.pane === "dock")!;
    f.controller.register(dock.lease, owner("dock"));
    const ready = await f.controller.prepareAll("reload");
    assert.equal(ready.allowed, true);
    assert.deepEqual(calls, ["first:reload", "second:reload", "dock:reload"]);
    assert.equal(ready.current(), true);
    f.controller.routeScope(second.lease).addGuard(() => true);
    assert.equal(ready.current(), false);
  } finally {
    f.close();
  }
});

test("storage errors preserve title and frame state without reporting persistence success", () => {
  const c = new WorkspaceController({
    userId: "fixture-user",
    generation: 1,
    currentGeneration: () => 1,
    initialHref: "/app/doc/d1",
    projectBrowser: () => true,
    storage: {
      getItem: () => {
        throw Error("Storage read denied");
      },
      setItem: () => {
        throw Error("Storage write denied");
      },
    },
  });
  try {
    const frame = c.getSnapshot().frames[0];
    assert.match(c.getSnapshot().storageError, /read denied/);
    c.routeScope(frame.lease).setTitle("Kept title");
    assert.equal(c.getSnapshot().frames[0].lease, frame.lease);
    assert.equal(
      c.getSnapshot().primary.tabs[0].history[0].title,
      "Kept title",
    );
    assert.match(c.getSnapshot().storageError, /write denied/);
    assert.equal(c.retryPersistence(), false);
  } finally {
    c.destroy();
  }
});

// Global lifetime owners remain independently revocable until actual teardown.
test("a global refusal prevents frame disposal preparation", async () => {
  let frames = 0;
  const f = fixture(async () => ({ allowed: false, current: () => true }));
  try {
    f.controller.register(f.first.lease, {
      blocksParking: () => false,
      prepare: async () => {
        frames++;
        return true;
      },
    });
    const permit = await f.controller.prepareAll("sign-out");
    assert.equal(permit.allowed, false);
    assert.equal(frames, 0);
    assert.ok(f.controller.owns(f.first.lease));
  } finally {
    f.close();
  }
});
test("global resource mutation while another frame settles invalidates exit", async () => {
  let revision = 0,
    entered!: () => void;
  const waiting = new Promise<void>((done) => (entered = done)),
    gate = deferred();
  const f = fixture(async () => {
    const opening = revision;
    return { allowed: true, current: () => opening === revision };
  });
  try {
    f.controller.register(f.first.lease, {
      blocksParking: () => false,
      prepare: async () => {
        entered();
        return gate.promise;
      },
    });
    const pending = f.controller.prepareAll("leave-workspace");
    await waiting;
    revision++;
    gate.resolve(true);
    const permit = await pending;
    assert.equal(permit.allowed, false);
    assert.equal(permit.current(), false);
    assert.ok(f.controller.owns(f.first.lease));
  } finally {
    f.close();
  }
});
test("a completed permit remains revocable up to synchronous teardown", async () => {
  let fresh = true;
  const f = fixture(async () => ({ allowed: true, current: () => fresh }));
  try {
    f.controller.register(f.first.lease, {
      blocksParking: () => false,
      prepare: async () => true,
    });
    const permit = await f.controller.prepareAll("reload");
    assert.equal(permit.allowed, true);
    assert.equal(permit.current(), true);
    fresh = false;
    assert.equal(permit.current(), false);
    let teardown = 0;
    if (permit.allowed && permit.current()) teardown++;
    assert.equal(teardown, 0);
  } finally {
    f.close();
  }
});
test("account retirement during global preparation cannot authorize old teardown", async () => {
  const gate = deferred();
  const f = fixture(async () => ({
    allowed: await gate.promise,
    current: () => true,
  }));
  try {
    f.controller.register(f.first.lease, {
      blocksParking: () => false,
      prepare: async () => true,
    });
    const pending = f.controller.prepareAll("sign-out");
    f.changeAccount();
    gate.resolve(true);
    const permit = await pending;
    assert.equal(permit.allowed, false);
    assert.equal(permit.current(), false);
    assert.equal(f.controller.getSnapshot().frames.length, 0);
  } finally {
    f.close();
  }
});
test("save-induced title metadata does not invalidate an otherwise current global exit", async () => {
  const f = fixture(async () => ({ allowed: true, current: () => true }));
  try {
    f.controller.register(f.first.lease, {
      blocksParking: () => false,
      prepare: async () => {
        f.controller.routeScope(f.first.lease).setTitle("Saved document");
        return true;
      },
    });
    const permit = await f.controller.prepareAll("sign-out");
    assert.equal(permit.allowed, true);
    assert.equal(permit.current(), true);
    assert.equal(
      f.controller.getSnapshot().primary.tabs[0].history[0].title,
      "Saved document",
    );
  } finally {
    f.close();
  }
});

function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
