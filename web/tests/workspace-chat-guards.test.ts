import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkspaceController } from "../src/app/workspace/controller";

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
