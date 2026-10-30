import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import * as core from "@orbyn/core";
const require = createRequire(import.meta.url),
  mobileRequire = createRequire(
    new URL("../../mobile/package.json", import.meta.url),
  );
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const notice = (n: number, patch: Partial<core.Notice> = {}): core.Notice => ({
  id: id(n),
  title: `Notice ${n}`,
  body: `Authored update ${n}`,
  read: false,
  created_at: "2026-10-30T10:00:00Z",
  ...patch,
});
const rows = [
  notice(1, { kind: "reminder", item_id: id(100) }),
  notice(2, { kind: "deadline", item_id: id(101) }),
  notice(3, {
    kind: "session",
    item_id: id(100),
    ref: `${id(300)}:2026-10-30T10:00:00Z`,
  }),
  notice(4, { kind: "review", ref: `proposal:${id(200)}` }),
  notice(5, { kind: "review", ref: `proposal:${id(201)}` }),
  notice(6, { kind: "import", ref: `doc:${id(400)}` }),
  notice(7, { kind: "mention", ref: `doc:${id(400)}:remark`, read: true }),
  notice(8, { kind: "assistant", ref: `conversation:${id(500)}:${id(501)}` }),
  notice(9, { kind: "assistant", ref: `conversation:${id(500)}:${id(502)}` }),
  notice(10, { title: "Same title" }),
  notice(11, { title: "Same title" }),
];

async function fixture(platform: "desktop" | "mobile") {
  const { JSDOM } = mobileRequire("jsdom"),
    dom = new JSDOM('<div id="root"></div>', { url: "http://fixture.invalid" });
  const names = [
    "window",
    "document",
    "HTMLElement",
    "IS_REACT_ACT_ENVIRONMENT",
    "fetch",
  ];
  const saved = names.map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  let networkCalls = 0;
  for (const name of names)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value:
        name === "IS_REACT_ACT_ENVIRONMENT"
          ? true
          : name === "fetch"
            ? () => {
                networkCalls++;
                throw new Error("Notification fixture must not use network");
              }
            : dom.window[name],
    });
  const React = require("react"),
    root = require("react-dom/client").createRoot(
      dom.window.document.querySelector("#root"),
    );
  const module = { exports: {} as any };
  const path =
    platform === "desktop"
      ? "../../desktop/src/features/notifications/NotificationsView.tsx"
      : "../../mobile/src/features/tasks/InboxScreen.tsx";
  runInNewContext(
    transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), {
      loader: "tsx",
      jsx: "automatic",
      format: "cjs",
    }).code,
    {
      module,
      exports: module.exports,
      Error,
      require: (name: string) => {
        if (name === "@orbyn/core") return core;
        if (["react", "react/jsx-runtime", "lucide-react"].includes(name))
          return require(name);
        if (name.endsWith("/api"))
          return {
            client: {
              agentQuestions: async () => [],
              mentions: async () => [],
            },
          };
        if (name.endsWith("/live")) return { onLive: () => () => {} };
        if (name.endsWith("/concept-icons"))
          return { CONCEPT_ICON: { project: () => null } };
        if (name.endsWith("/EmptyState"))
          return {
            EmptyState: ({ title, body }: any) =>
              React.createElement("div", null, title, body),
          };
        if (name.endsWith(".css")) return {};
        if (name === "react-native")
          return {
            View: ({ children }: any) =>
              React.createElement("div", null, children),
            Text: ({ children, accessibilityRole }: any) =>
              React.createElement(
                accessibilityRole === "header" ? "h3" : "span",
                { role: accessibilityRole === "alert" ? "alert" : undefined },
                children,
              ),
            StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
          };
        if (name.endsWith("/motion"))
          return {
            Pressable: ({
              children,
              onPress,
              accessibilityLabel,
              disabled,
            }: any) =>
              React.createElement(
                "button",
                {
                  onClick: onPress,
                  "aria-label": accessibilityLabel,
                  disabled,
                },
                children,
              ),
          };
        if (name.endsWith("/SmallAction"))
          return {
            SmallAction: ({ label, disabled, onPress }: any) =>
              React.createElement(
                "button",
                { disabled, onClick: onPress },
                label,
              ),
          };
        if (name.endsWith("/Icon")) return { Icon: () => null };
        if (name.endsWith("/Asks")) return { AsksList: () => null };
        if (name.endsWith("/theme"))
          return {
            colors: {},
            fonts: {},
            radii: {},
            themed: (fn: () => unknown) => fn(),
          };
        if (name.endsWith("/styles")) return { shared: {} };
        throw new Error(`Unexpected notification dependency: ${name}`);
      },
    },
  );
  const read: string[] = [],
    reviews: string[] = [],
    entries: string[] = [],
    pages: string[] = [],
    sessions: string[] = [],
    rescheduled: string[] = [],
    items: string[] = [],
    itemNotices: string[] = [];
  let failReschedule = false;
  const render = async (notices: core.Notice[]) =>
    React.act(async () =>
      root.render(
        React.createElement(
          module.exports[
            platform === "desktop" ? "NotificationsView" : "InboxScreen"
          ],
          {
            notices,
            busy: false,
            onRead: (n: core.Notice) => read.push(n.id),
            onReschedule: async (notice: core.Notice) => {
              rescheduled.push(notice.id);
              if (failReschedule)
                throw new Error(
                  "Couldn’t move this session. Retry the action.",
                );
            },
            onRollForward: async () => {},
            onPlanIt: () => {},
            onOpenCalendar: () => {},
            onOpenItem: (value: string | core.Notice) => {
              if (typeof value === "string") items.push(value);
              else {
                items.push(value.item_id!);
                itemNotices.push(value.id);
              }
            },
            onOpenBooking: () => {},
            onOpenReview: (proposal: string) => reviews.push(proposal),
            onOpenConversation: (...args: unknown[]) =>
              entries.push(String(args[platform === "desktop" ? 1 : 2])),
            onOpenDoc: (...args: unknown[]) =>
              pages.push(String(args[platform === "desktop" ? 0 : 1])),
            onStartSession: async (...args: unknown[]) =>
              sessions.push(
                platform === "desktop"
                  ? String(args[0])
                  : (args[0] as core.Notice).id,
              ),
          },
        ),
      ),
    );
  const buttons = (text: string) =>
    [...dom.window.document.querySelectorAll("button")].filter(
      (button: any) => button.textContent.trim() === text,
    );
  return {
    dom,
    React,
    render,
    buttons,
    read,
    reviews,
    entries,
    pages,
    sessions,
    rescheduled,
    items,
    itemNotices,
    failReschedule: (value: boolean) => {
      failReschedule = value;
    },
    close: async () => {
      await React.act(async () => root.unmount());
      dom.window.close();
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
      assert.equal(networkCalls, 0);
    },
  };
}

test("a failed action stays on its individual desktop notice and retries without acknowledging the whole source", async () => {
  const f = await fixture("desktop");
  try {
    await f.render([
      notice(1, { kind: "conflict", item_id: id(100), ref: id(300) }),
      notice(2, { kind: "conflict", item_id: id(100), ref: id(301) }),
    ]);
    f.failReschedule(true);
    await f.React.act(async () => f.buttons("Reschedule")[0].click());
    const error = f.dom.window.document.querySelector('[role="alert"]');
    assert.match(error.textContent, /Retry the action/);
    assert.equal(
      error.closest(".notice").querySelector("strong").textContent,
      "Notice 1",
    );
    assert.deepEqual(f.read, []);
    f.failReschedule(false);
    await f.React.act(async () => f.buttons("Reschedule")[0].click());
    assert.deepEqual(f.rescheduled, [id(1), id(1)]);
    assert.deepEqual(f.read, [id(1)]);
    assert.equal(f.dom.window.document.querySelectorAll(".notice").length, 2);
    assert.equal(f.dom.window.document.querySelector('[role="alert"]'), null);
  } finally {
    await f.close();
  }
});

for (const platform of ["desktop", "mobile"] as const) {
  test(`${platform} reminder actions open the exact linked item while row reads remain individual`, async () => {
    const f = await fixture(platform);
    const reminders = [
      notice(21, { kind: "reminder", item_id: id(100) }),
      notice(22, { item_id: id(100) }),
      notice(23, { kind: "reminder", item_id: "not-an-item" }),
      notice(24, { kind: "reminder" }),
    ];
    try {
      await f.render(reminders);
      assert.equal(
        f.buttons("Open task or event").length,
        2,
        "Only valid linked reminders expose navigation",
      );
      await f.React.act(async () => f.buttons("Open task or event")[0].click());
      assert.deepEqual(f.items, [id(100)]);
      assert.deepEqual(f.itemNotices, platform === "mobile" ? [id(21)] : []);
      assert.deepEqual(
        f.read,
        platform === "desktop" ? [id(21)] : [],
        "Mobile delegates acknowledgement to its existing notice action owner",
      );
      f.read.length = 0;
      const row = [...f.dom.window.document.querySelectorAll("button")].find(
        (button: any) =>
          platform === "desktop"
            ? button.className === "notice-main" &&
              button.querySelector("strong")?.textContent === "Notice 22"
            : button.getAttribute("aria-label") === "Notice 22, unread",
      );
      assert.ok(row);
      await f.React.act(async () => row.click());
      assert.deepEqual(f.read, [id(22)]);
      assert.deepEqual(
        f.items,
        [id(100)],
        "Reading the row must not implicitly navigate",
      );
      assert.equal(
        reminders[1].read,
        false,
        "Component callbacks do not mutate or acknowledge the entire source",
      );
    } finally {
      await f.close();
    }
  });
  test(`${platform} source groups keep every notice, decision and exact entry/page/session action available`, async () => {
    const f = await fixture(platform);
    try {
      await f.render(rows);
      const headings = [...f.dom.window.document.querySelectorAll("h3")];
      assert.deepEqual(
        headings.map((node: any) => node.textContent),
        ["Task or event", "Page", "Conversation"],
      );
      assert.ok(
        headings[0].parentElement!.textContent!.includes(
          "2 updates · 2 unread",
        ),
      );
      assert.equal(
        f.dom.window.document.querySelectorAll(
          platform === "desktop"
            ? ".notice"
            : 'button[aria-label^="Notice"],button[aria-label^="Same title"]',
        ).length,
        rows.length,
      );
      await f.React.act(async () => {
        f.buttons("Review").forEach((button: any) => button.click());
      });
      assert.deepEqual(f.reviews, [id(200), id(201)]);
      await f.React.act(async () => {
        f.buttons("Open conversation").forEach((button: any) => button.click());
      });
      assert.deepEqual(f.entries, [id(501), id(502)]);
      const page =
        platform === "desktop"
          ? [...f.dom.window.document.querySelectorAll(".notice-main")].find(
              (button: any) =>
                button.querySelector("strong")?.textContent === "Notice 6",
            )
          : f.buttons("Open page")[0];
      assert.ok(page);
      await f.React.act(async () => page.click());
      assert.equal(f.pages[0], id(400));
      await f.React.act(async () => f.buttons("Start")[0].click());
      assert.equal(f.sessions[0], platform === "desktop" ? id(300) : id(3));
      f.read.length = 0;
      const same = [...f.dom.window.document.querySelectorAll("button")].filter(
        (button: any) =>
          platform === "desktop"
            ? button.className === "notice-main" &&
              button.querySelector("strong")?.textContent === "Same title"
            : button.getAttribute("aria-label") === "Same title, unread",
      );
      assert.equal(same.length, 2);
      await f.React.act(async () => same[0].click());
      assert.deepEqual(
        f.read,
        [id(10)],
        "Reading one notice must never acknowledge its neighbors",
      );
      await f.render(
        rows.map((row) => (row.id === id(1) ? { ...row, read: true } : row)),
      );
      const heading = [...f.dom.window.document.querySelectorAll("h3")].find(
        (node: any) => node.textContent === "Task or event",
      );
      assert.ok(
        heading!.parentElement!.textContent!.includes("2 updates · 1 unread"),
      );
    } finally {
      await f.close();
    }
  });
}
