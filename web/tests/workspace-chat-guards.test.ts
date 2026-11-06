import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkspaceController } from "../src/app/workspace/controller";
import {
  sessionsToUnmount,
  shouldCollapseForFocus,
} from "../src/app/workspace/project-chat-policy";

function workspace() {
  const controller = new WorkspaceController({
    userId: "chat-guard-fixture",
    generation: 1,
    currentGeneration: () => 1,
    initialHref: "/app/projects",
    projectBrowser: () => true,
  });
  const register = () => {
    const frame = controller
      .getSnapshot()
      .frames.find(
        (entry) =>
          entry.lease.pane === "primary" &&
          entry.lease.tabKey === controller.getSnapshot().primary.active,
      )!;
    controller.register(frame.lease, {
      prepare: async () => true,
      blocksParking: () => false,
    });
    return frame;
  };
  return { controller, register };
}

test("persistent chat survives internal navigation but guards workspace disposal", async () => {
  const { controller, register } = workspace();
  try {
    const initial = register();
    const destinations: string[] = [];
    const off = controller.registerWorkspaceGuard(async (destination) => {
      destinations.push(destination);
      return false;
    });
    const result = await controller
      .routeScope(initial.lease)
      .navigate("/app/calendar");
    assert.equal(result.kind, "committed");
    register();
    assert.deepEqual(
      destinations,
      [],
      "route changes must retain chat without asking to discard drafts",
    );
    assert.equal((await controller.prepareAll("reload")).allowed, false);
    assert.equal((await controller.prepareAll("sign-out")).allowed, false);
    assert.deepEqual(destinations, ["", ""]);
    off();
    assert.equal((await controller.prepareAll("reload")).allowed, true);
  } finally {
    controller.destroy();
  }
});

test("replacing a chat guard during preparation invalidates the disposal permit", async () => {
  const { controller, register } = workspace();
  try {
    register();
    let finish!: (allowed: boolean) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    const off = controller.registerWorkspaceGuard(async () => {
      entered();
      return gate;
    });
    const pending = controller.prepareAll("sign-out");
    await started;
    off();
    controller.registerWorkspaceGuard(async () => true);
    finish(true);
    const permit = await pending;
    assert.equal(permit.allowed, false);
    assert.equal(permit.current(), false);
  } finally {
    controller.destroy();
  }
});

test("new chat input while a frame saves invalidates workspace disposal", async () => {
  const { controller } = workspace();
  try {
    const frame = controller.getSnapshot().frames[0];
    let finish!: (allowed: boolean) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    controller.register(frame.lease, {
      blocksParking: () => false,
      prepare: async () => {
        entered();
        return gate;
      },
    });
    controller.registerWorkspaceGuard(async () => true);
    const pending = controller.prepareAll("reload");
    await started;
    controller.noteWorkspaceInput();
    finish(true);
    const permit = await pending;
    assert.equal(permit.allowed, false);
    assert.equal(permit.current(), false);
  } finally {
    controller.destroy();
  }
});

const box = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
});

test("focus collapses the dock only for tabbed controls under the panel", () => {
  const panel = box(400, 500, 960, 840);
  const check = (
    target: ReturnType<typeof box>,
    options: { viaTab?: boolean; container?: boolean } = {},
  ) =>
    shouldCollapseForFocus({
      panel,
      target,
      viaTab: options.viaTab ?? true,
      container: options.container ?? false,
    });
  assert.equal(check(box(500, 600, 600, 640)), true);
  assert.equal(check(box(300, 450, 500, 560)), true);
  assert.equal(check(box(0, 0, 300, 200)), false);
  assert.equal(check(box(500, 600, 600, 640), { viaTab: false }), false);
  // A narrowed frame body that no longer spans the panel is still a container.
  assert.equal(check(box(0, 0, 700, 860), { container: true }), false);
});

test("session pruning keeps selected, busy and unsent sessions", () => {
  const pick = (
    mounted: string[],
    options: { busy?: string[]; dirty?: string[]; selected?: string } = {},
  ) =>
    sessionsToUnmount({
      mounted,
      recent: ["a", "b", "c", "d", "e"],
      selected: options.selected ?? mounted[mounted.length - 1],
      busy: new Set(options.busy),
      dirty: new Set(options.dirty),
    });
  assert.deepEqual(pick(["a", "b", "c"]), []);
  assert.deepEqual(pick(["a", "b", "c", "d"]), ["a"]);
  assert.deepEqual(pick(["a", "b", "c", "d", "e"]), ["a", "b"]);
  assert.deepEqual(pick(["a", "b", "c", "d"], { dirty: ["a"] }), ["b"]);
  assert.deepEqual(pick(["a", "b", "c", "d"], { busy: ["a"], selected: "b" }), [
    "c",
  ]);
  assert.deepEqual(
    pick(["a", "b", "c", "d"], { dirty: ["a", "b", "c"] }),
    [],
    "every candidate dirty keeps all",
  );
  assert.deepEqual(pick(["a", "b", "c", "d", "e"], { dirty: ["a"] }), [
    "b",
    "c",
  ]);
  // Never-selected sessions are the oldest.
  assert.deepEqual(
    sessionsToUnmount({
      mounted: ["x", "a", "b", "c"],
      recent: ["a", "b", "c"],
      selected: "c",
      busy: new Set(),
      dirty: new Set(),
    }),
    ["x"],
  );
});
