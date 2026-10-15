import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React from "react";
import { addDays, dayTime } from "@orbyn/core";

function load(
  path: string,
  modules: Record<string, unknown>,
  globals: Record<string, unknown> = {},
) {
  const exports: Record<string, any> = {};
  const source = readFileSync(
    new URL(`../../${path}`, import.meta.url),
    "utf8",
  );
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    }).outputText,
    {
      ...globals,
      exports,
      React,
      require: (name: string) => {
        assert.ok(name in modules, `Unexpected dependency ${name}`);
        return modules[name];
      },
    },
  );
  return exports;
}

test("mobile layout uses the remaining pane and follows its resizes", () => {
  let windowWidth = 1200;
  let measured: number | null = null;
  const hook = load("mobile/src/hooks/usePaneWidth.ts", {
    react: {
      useCallback: (fn: unknown) => fn,
      useState: () => [
        measured,
        (value: number) => {
          measured = value;
        },
      ],
    },
    "react-native": { useWindowDimensions: () => ({ width: windowWidth }) },
  });
  assert.equal(hook.usePaneWidth().width, 1200);
  hook.usePaneWidth().onLayout({ nativeEvent: { layout: { width: 620.2 } } });
  assert.equal(hook.usePaneWidth().width, 620);
  windowWidth = 1500;
  assert.equal(
    hook.usePaneWidth().width,
    620,
    "window width cannot open a split pane",
  );
  hook.usePaneWidth().onLayout({ nativeEvent: { layout: { width: 320 } } });
  assert.equal(hook.usePaneWidth().width, 320);
  for (const width of [0, -1, NaN, Infinity]) {
    hook.usePaneWidth().onLayout({ nativeEvent: { layout: { width } } });
    assert.equal(
      hook.usePaneWidth().width,
      320,
      "hidden or invalid layout retains its last positive width",
    );
  }
});

function pressFixture(reduced = false) {
  const targets: number[] = [];
  class Value {
    value: number;
    constructor(value: number) {
      this.value = value;
    }
    stopAnimation() {}
    setValue(value: number) {
      this.value = value;
    }
  }
  const hook = load("mobile/src/motion/PressableScale.tsx", {
    react: { useRef: (current: unknown) => ({ current }) },
    "react-native": {
      Animated: {
        Value,
        createAnimatedComponent: (component: unknown) => component,
        timing: (value: Value, config: { toValue: number }) => ({
          start() {
            targets.push(config.toValue);
            value.setValue(config.toValue);
          },
        }),
      },
    },
    "@orbyn/core": { motion: { pressScale: 1, fast: 100 } },
    "./easing": { easeOut: undefined },
    "./useReducedMotion": { isReducedMotion: () => reduced },
    "./accessibility": {},
  });
  return { hook, targets };
}

test("layout feedback is stable on web and respects native Reduce Motion", () => {
  for (const [platform, reduced, expected] of [
    ["web", false, 0],
    ["ios", true, 0],
    ["ios", false, 1],
  ] as const) {
    let calls = 0;
    const hook = load("mobile/src/motion/layout.ts", {
      "react-native": {
        Platform: { OS: platform },
        UIManager: {},
        LayoutAnimation: {
          create: () => ({}),
          configureNext: () => {
            calls++;
          },
        },
      },
      "@orbyn/core": { motion: { base: 140 } },
      "./useReducedMotion": { isReducedMotion: () => reduced },
    });
    hook.animateLayout();
    assert.equal(calls, expected, `${platform}, reduced=${reduced}`);
  }
});

test("routine press feedback stays stable without decorative scaling", () => {
  const { hook, targets } = pressFixture();
  const press = hook.usePressScale();
  press.onPressIn();
  press.onPressOut();
  assert.deepEqual(targets, []);
  assert.equal(press.style.transform[0].scale.value, 1);
});

test("an explicit press scale restores its original size on release", () => {
  const { hook, targets } = pressFixture();
  const press = hook.usePressScale(0.96);
  press.onPressIn();
  press.onPressOut();
  assert.deepEqual(targets, [0.96, 1]);
  assert.equal(press.style.transform[0].scale.value, 1);
});

test("reduced motion bypasses even explicitly requested press scaling", () => {
  const { hook, targets } = pressFixture(true);
  const press = hook.usePressScale(0.96);
  press.onPressIn();
  press.onPressOut();
  assert.deepEqual(targets, []);
  assert.equal(press.style.transform[0].scale.value, 1);
});

test("mobile web inputs avoid focus zoom while native inputs keep their compact role", () => {
  for (const platform of ["web", "ios", "android"]) {
    const theme = load("mobile/src/theme/index.ts", {
      "react-native": { Platform: { OS: platform } },
      "./live": {},
      "./ThemeContext": {},
      "@orbyn/core": {},
    });
    assert.equal(theme.inputFontSize, platform === "web" ? 16 : 15);
  }
});

function contrast(a: string, b: string) {
  const luminance = (hex: string) =>
    [1, 3, 5]
      .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
      )
      .reduce(
        (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
        0,
      );
  const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

test("shared mobile text roles remain readable on their normal theme surfaces", () => {
  const core = load("packages/core/src/presentation.ts", {});
  const palettes = load("mobile/src/theme/palette.ts", { "@orbyn/core": core });
  for (const name of ["light", "dark"]) {
    const palette = palettes[name];
    for (const role of ["text", "textSoft", "muted", "faint"]) {
      for (const surface of ["background", "surface", "surfaceMuted"]) {
        assert.ok(
          contrast(palette[role], palette[surface]) >= 4.5,
          `${name}: ${role} on ${surface}`,
        );
      }
    }
    assert.ok(
      contrast(palette.onAccent, palette.accent) >= 4.5,
      `${name}: primary foreground`,
    );
    assert.ok(
      contrast(palette.warning, palette.warningSoft) >= 4.5,
      `${name}: warning`,
    );
    assert.ok(
      contrast(palette.danger, palette.dangerSoft) >= 4.5,
      `${name}: error`,
    );
  }
});

test("inline details keep full content mounted and expose their expanded state", () => {
  let open = false;
  const component = load("mobile/src/components/InlineDetails.tsx", {
    react: {
      ...React,
      useState: () => [
        open,
        (value: boolean) => {
          open = value;
        },
      ],
    },
    "react-native": {
      View: "View",
      Text: "Text",
      StyleSheet: { create: (styles: unknown) => styles },
    },
    "../motion": { Pressable: "Pressable" },
    "./Icon": { Icon: "Icon" },
    "../theme": { colors: {}, fonts: {}, themed: (fn: () => unknown) => fn() },
  });
  const content = React.createElement(
    "Text",
    null,
    "Full saved progress details",
  );
  const render = () =>
    component.InlineDetails({ title: "Progress details", children: content });
  let tree = render();
  let [trigger, body] = tree.props.children;
  assert.equal(trigger.props.accessibilityState.expanded, false);
  assert.equal(trigger.props.style.minHeight, 44);
  assert.equal(body.props.children, content);
  assert.equal(body.props.style[1].display, "none");
  trigger.props.onPress();
  tree = render();
  [trigger, body] = tree.props.children;
  assert.equal(trigger.props.accessibilityState.expanded, true);
  assert.equal(body.props.style[1], false);
  assert.equal(body.props.children, content);
  trigger.props.onPress();
  assert.equal(
    render().props.children[0].props.accessibilityState.expanded,
    false,
  );
});

test("project review keeps complete task details and creation consequences on both clients", () => {
  const project = {
    title: "Prepare the research submission",
    summary: "Keep the existing agreed scope",
    timezone: "UTC",
    start_date: "2026-10-12",
    days: 7,
    deadline: "2026-10-19T17:00:00Z",
    tasks: [
      {
        id: "task-one",
        title:
          "A deliberately long task name that must remain fully readable before approval",
        notes: "Keep the supplied evidence and its source links",
        estimate_minutes: 120,
        due_in_days: 3,
        depends_on: [],
      },
    ],
    blocks: [],
    unplaced: [
      {
        item_id: "task-one",
        reason: "There is not enough time before the deadline",
      },
    ],
    at_risk: [
      { item_id: "task-one", reason: "Duplicate partial-placement warning" },
    ],
  };
  const textOf = (node: any): string => {
    if (node === null || node === undefined || typeof node === "boolean")
      return "";
    if (Array.isArray(node)) return node.map(textOf).join("");
    if (typeof node === "object") return textOf(node.props?.children);
    return String(node);
  };
  for (const platform of ["desktop", "mobile"]) {
    const component = load(
      `${platform}/src/components/ProjectDraftReview.tsx`,
      {
        react: React,
        "@orbyn/core": { addDays, dayTime },
        "./project-draft-review.css": {},
        "react-native": {
          View: "View",
          Text: "Text",
          StyleSheet: { create: (s: unknown) => s },
        },
        "../theme": {
          colors: {},
          fonts: {},
          themed: (fn: () => unknown) => fn(),
        },
      },
    );
    const text = textOf(component.ProjectDraftReview({ project }));
    for (const value of [
      project.tasks[0].title,
      project.tasks[0].notes,
      project.timezone,
      project.unplaced[0].reason,
      "They will still be created",
    ])
      assert.ok(text.includes(value), `${platform}: ${value}`);
    assert.ok(
      !text.includes(project.at_risk[0].reason),
      `${platform}: no duplicate warning`,
    );
  }
});

test("segmented choices keep reachable targets, full labels and fixed count badges", () => {
  let width = 0;
  let selected = "";
  const component = load("mobile/src/components/Segmented.tsx", {
    react: {
      ...React,
      useState: () => [
        width,
        (value: number) => {
          width = value;
        },
      ],
    },
    "react-native": {
      View: "View",
      Text: "Text",
      StyleSheet: { create: (styles: unknown) => styles },
      useWindowDimensions: () => ({ fontScale: 1.5 }),
    },
    "../motion": { Pressable: "Pressable" },
    "../theme": {
      controls: { tap: 44 },
      colors: {},
      fonts: {},
      radii: { input: 8, pill: 999 },
      themed: (fn: () => unknown) => fn(),
    },
  });
  const render = () =>
    component.Segmented({
      options: ["one", "two", "three", "four"],
      value: "one",
      labels: { one: "A long selected choice", two: "Another choice" },
      badges: { one: 123 },
      accessibilityLabel: "Layout",
      onChange: (value: string) => {
        selected = value;
      },
    });
  let tree = render();
  tree.props.onLayout({ nativeEvent: { layout: { width: 180 } } });
  tree = render();
  assert.equal(tree.props.style[1].flexWrap, "wrap");
  const choice = tree.props.children[0];
  assert.equal(choice.props.accessibilityState.checked, true);
  assert.equal(
    choice.props.children[0].props.children,
    "A long selected choice",
  );
  assert.equal(
    choice.props.style[0].minHeight +
      choice.props.hitSlop.top +
      choice.props.hitSlop.bottom,
    44,
  );
  assert.equal(choice.props.children[1].props.style.flexShrink, 0);
  assert.equal(choice.props.children[1].props.children.props.children, "99+");
  tree.props.children[1].props.onPress();
  assert.equal(selected, "two");
});

test("Focus completion stays inline and stable without covering session controls", () => {
  const web = readFileSync(
    new URL("../../desktop/src/features/focus/FocusMode.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL("../../desktop/src/features/focus/focus.css", import.meta.url),
    "utf8",
  );
  const mobile = readFileSync(
    new URL("../../mobile/src/screens/FocusScreen.tsx", import.meta.url),
    "utf8",
  );
  assert.match(web, /className="focus-completion" role="status"/);
  assert.doesNotMatch(web + css, /focus-burst|PartyPopper/);
  assert.match(mobile, /animationType="none"/);
  assert.doesNotMatch(mobile, /Animated\.View|pop\(scale/);
  assert.match(web, /End session/);
  assert.match(mobile, /Pause and log time/);
  assert.match(mobile, /canWrite: !readOnly/);
});

test("Publication selection preserves full block text and explicit access consequences", () => {
  for (const path of [
    "desktop/src/features/publish/PagePublicationDialog.tsx",
    "mobile/src/screens/docs/PagePublicationSheet.tsx",
  ]) {
    const source = readFileSync(
      new URL(`../../${path}`, import.meta.url),
      "utf8",
    );
    assert.match(source, /blockText\(block\)/);
    assert.doesNotMatch(source, /blockText\(block\)\.slice/);
    assert.match(
      source,
      /Anyone with the link can read the title and selected blocks/,
    );
    assert.match(
      source,
      /Edits to selected blocks are public\. New blocks stay private/,
    );
  }
  for (const path of [
    "desktop/src/features/publish/PublishDialog.tsx",
    "mobile/src/screens/docs/PublishSheet.tsx",
  ]) {
    const source = readFileSync(
      new URL(`../../${path}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /only people with the link find it/);
    assert.match(source, /Access\s+settings\s+are\s+unchanged/);
    assert.match(source, /Password required to read it/);
    assert.match(source, /The address stops working at once/);
  }
});

test("time-block editing keeps the subject and serializes saving and dismissal", () => {
  const { BlockDialog } = load(
    "desktop/src/features/calendar/BlockDialog.tsx",
    {
      react: {
        ...React,
        useState: (value: unknown) => [value, () => {}],
        useEffect: () => {},
      },
      "react-dom": { createPortal: (node: unknown) => node },
      "lucide-react": { X: "Icon" },
      "@orbyn/core": {
        toDateTimeLocal: (iso: string) => iso.slice(0, 16),
        fromDateTimeLocal: (value: string) => `${value}:00Z`,
      },
      "../../components/DateField": { DateField: "DateField" },
      "../../hooks/useModalFocus": {
        useModalFocus: () => ({ id: "editor", ref: {} }),
      },
    },
    { document: { body: {} } },
  );
  const subject =
    "A long full task title that identifies exactly which session is moving";
  let saved = 0,
    closed = 0;
  const props = {
    heading: "Move session",
    subject,
    start: new Date("2026-10-12T09:00:00Z"),
    minutes: 30,
    onSave: () => saved++,
    onClose: () => closed++,
  };
  const nodes = (node: any): any[] =>
    !node || typeof node !== "object"
      ? []
      : Array.isArray(node)
        ? node.flatMap(nodes)
        : [node, ...nodes(node.props?.children)];
  for (const busy of [true, false]) {
    const tree = BlockDialog({ ...props, busy });
    const all = nodes(tree);
    assert.ok(all.some((node) => node.props?.children === subject));
    all
      .find((node) => node.type === "form")
      .props.onSubmit({ preventDefault() {} });
    tree.props.onCancel({ preventDefault() {} });
    if (busy) {
      assert.equal(saved, 0);
      assert.equal(closed, 0);
      assert.equal(
        all.find((node) => node.type === "DateField").props.disabled,
        true,
      );
    }
  }
  assert.equal(saved, 1);
  assert.equal(closed, 1);
});

test("team collection rows retain full names, counts and roles in the identity column", () => {
  const { TeamList } = load("mobile/src/components/TeamList.tsx", {
    react: React,
    "react-native": {
      StyleSheet: { create: (s: unknown) => s },
      Text: "Text",
      View: "View",
    },
    "@orbyn/core": { TEAM_ROLE_LABELS: { owner: "Owner" } },
    "./Icon": { Icon: "Icon" },
    "./Pill": { Pill: "Pill" },
    "../motion": { FadeIn: "FadeIn", Pressable: "Pressable" },
    "../theme": {
      colors: {},
      fonts: {},
      radii: {},
      themed: (fn: () => unknown) => fn(),
    },
    "../styles": { shared: {} },
  });
  const name =
    "A full team name that must remain identifiable on a narrow phone";
  let selected: unknown;
  const team = {
    id: "team",
    name,
    role: "owner",
    member_count: 12,
    item_count: 8,
  };
  const tree = TeamList({
    teams: [team],
    onSelect: (value: unknown) => (selected = value),
  });
  const row = tree.props.children[0].props.children;
  row.props.onPress();
  assert.equal(selected, team);
  const identity = row.props.children[1];
  assert.equal(identity.props.style.minWidth, 0);
  assert.equal(identity.props.children[0].props.children, name);
  assert.equal(identity.props.children[0].props.numberOfLines, undefined);
  assert.equal(identity.props.children[2].props.children.props.label, "Owner");
});

test("team planning discloses secondary tools while keeping risks and save choices explicit", () => {
  const source = (path: string) =>
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const web = source("desktop/src/features/teams/TeamPlanning.tsx");
  const mobile = source("mobile/src/screens/TeamTime.tsx");
  assert.match(web, /<summary>Availability<\/summary>/);
  assert.match(web, /<summary>Find meeting times<\/summary>/);
  assert.match(web, /<AtRiskList workload=\{workload\}/);
  assert.match(mobile, /<InlineDetails title="Availability">/);
  assert.match(mobile, /<InlineDetails title="Find meeting times">/);
  assert.match(mobile, /atRisk\.length > 0/);
  assert.match(mobile, /label="Review event"/);
  assert.match(mobile, /label="Save event"/);
  assert.match(mobile, /disabled=\{busy \|\| tooMany\}/);
  assert.match(mobile, /onPress=\{\(\) => openInEditor\(slot\)\}/);
  assert.match(mobile, /onPress=\{\(\) => void book\(slot\)\}/);
  assert.match(mobile, /team_id: teamId/);
});

test("storage keeps upload authority and complete errors with optional history", () => {
  const source = (path: string) =>
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const web = source("desktop/src/features/admin/AdminStorage.tsx");
  const mobile = source("mobile/src/screens/AdminStorage.tsx");
  assert.match(web, /<summary>Import history · 30 days<\/summary>/);
  assert.match(mobile, /<InlineDetails title="Import history · 30 days">/);
  assert.match(web, /storage-error-detail/);
  assert.match(web, /<p>\{h.error\}<\/p>/);
  assert.match(mobile, /title="Import error"/);
  assert.match(mobile, /\{h.error\}/);
  assert.match(web, /adminDeleteStoredFile\(f.import_id\)/);
  assert.match(mobile, /adminDeleteStoredFile\(f.import_id\)/);
  assert.match(web, /confirmLabel: "Delete now"/);
  assert.match(mobile, /confirmAction\(/);
  assert.doesNotMatch(mobile, /numberOfLines=/);
});

test("database browser has pane-sized navigation, owned editing and full row access", () => {
  const source = (path: string) =>
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const web = source("desktop/src/features/admin/AdminDatabase.tsx");
  const mobile = source("mobile/src/screens/AdminDatabase.tsx");
  assert.match(web, /const compact = paneWidth < 900/);
  assert.match(web, /searchable\s+aria-label="Database table"/);
  assert.match(web, /useModalFocus\(onClose, busy\)/);
  assert.match(web, /data-modal-focus=\{focus.id\}/);
  assert.match(web, /e.target === e.currentTarget && !busy/);
  assert.match(web, /<pre>\{text\}<\/pre>/);
  assert.match(web, /Private data stays masked/);
  assert.match(web, /You will lose admin access/);
  assert.match(mobile, /Full row details/);
  assert.match(mobile, /numberOfLines=\{expanded \? undefined : 1\}/);
  assert.match(mobile, /editable=\{!busy\}/);
  assert.match(mobile, /You will lose admin access/);
});

test("system email details retain invalid-field access and save guards", () => {
  const source = (path: string) =>
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const web = source("desktop/src/features/admin/AdminSystem.tsx");
  const mobile = source("mobile/src/screens/AdminSystem.tsx");
  const detail = source("mobile/src/components/InlineDetails.tsx");
  assert.match(web, /<summary>Email delivery<\/summary>/);
  assert.match(web, /<summary>Test email delivery<\/summary>/);
  assert.match(web, /onInvalidCapture=/);
  assert.match(web, /if \(details\) details.open = true/);
  assert.match(web, /disabled=\{props.busy\}/);
  assert.match(web, /disabled=\{busy \|\| draft.removePassword\}/);
  assert.match(web, /Leave the host blank to turn email off/);
  assert.match(mobile, /title="Email delivery"/);
  assert.match(mobile, /Number.isNaN\(int\(port\)\)/);
  assert.match(mobile, /editable: !busy && !removePassword/);
  assert.match(mobile, /smtp.password = ""/);
  assert.match(detail, /const expanded = open \|\| reveal/);
  assert.match(detail, /!expanded && s.hidden/);
  assert.doesNotMatch(web, /system-card fade-up/);
});

test("system operations retain consequences, day validation and complete update detail", () => {
  const source = (path: string) =>
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const web = source("desktop/src/features/admin/AdminSystem.tsx");
  const mobile = source("mobile/src/screens/AdminSystem.tsx");
  const css = source("desktop/src/features/admin/system.css");
  assert.match(web, /<summary>Maintenance notice<\/summary>/);
  assert.match(mobile, /<InlineDetails title="Maintenance notice">/);
  assert.match(web, /Members can view but cannot make changes/);
  assert.match(mobile, /Members can view but cannot make changes/);
  assert.match(
    web,
    /if \(!changed.length \|\| invalidDays \|\| action.pending\) return/,
  );
  assert.match(
    web,
    /Permanently removes expired records. This cannot be undone/,
  );
  assert.match(web, /data-label="Keep for"/);
  assert.match(css, /@container \(max-width: 600px\)/);
  assert.match(web, /\{latest.message \|\| "No commit message"\}/);
  assert.match(mobile, /<InlineDetails title="Commit message">/);
  assert.doesNotMatch(mobile, /numberOfLines=/);
  assert.match(
    mobile,
    /accessibilityState=\{\{ checked: selected, disabled: busy \}\}/,
  );
});

test("admin accounts and audit preserve actions and full details in compact layouts", () => {
  const source = (path: string) =>
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const users = source("desktop/src/features/admin/AdminUsers.tsx");
  const audit = source("desktop/src/features/admin/AdminAudit.tsx");
  const requests = source("desktop/src/features/admin/AdminRequests.tsx");
  const mobile = source("mobile/src/screens/AdminSheet.tsx");
  assert.match(users, /<Popover/);
  assert.match(users, /selected.id !== user\?\.id/);
  assert.match(users, /Verify email/);
  assert.match(users, /You'll lose access to this console/);
  assert.match(users, /They will be signed out and unable to sign in/);
  assert.doesNotMatch(users, /fade-up|stagger\(/);
  assert.match(audit, /<summary>Target ID<\/summary>/);
  assert.match(audit, /<code>\{a.target_id\}<\/code>/);
  assert.match(audit, /<summary>View details<\/summary>/);
  assert.doesNotMatch(audit, /slice\(0, 8\)|title=\{formatDetails/);
  assert.match(requests, /<details className="admin-request-filters">/);
  assert.match(requests, /Filters/);
  assert.match(mobile, /title="Event details"/);
  assert.match(mobile, /JSON.stringify\(a.details, null, 2\)/);
  const auditTarget = mobile.slice(
    mobile.indexOf("function auditTarget"),
    mobile.indexOf("const s ="),
  );
  assert.doesNotMatch(auditTarget, /slice\(0, 8\)/);
});

test("mobile operations keep full request values and guarded retention choices", () => {
  const source = readFileSync(
    new URL("../../mobile/src/screens/AdminInsights.tsx", import.meta.url),
    "utf8",
  );
  const request = source.slice(
    source.indexOf("export function AdminRequests"),
    source.indexOf("function Fact"),
  );
  const retention = source.slice(
    source.indexOf("export function RetentionCard"),
    source.indexOf("export function AnnouncementCard"),
  );
  const announcement = source.slice(
    source.indexOf("export function AnnouncementCard"),
    source.indexOf("export function AnnouncementBanner"),
  );
  assert.match(request, /Filters · active/);
  assert.match(request, /setRoute\(""\)/);
  assert.doesNotMatch(request, /numberOfLines=/);
  assert.match(retention, /view.rules.map/);
  assert.doesNotMatch(
    retention.slice(retention.indexOf("const invalidDays")),
    /filter\(\(r\) => r.configurable\)\s*\.map/,
  );
  assert.match(retention, /title="Sweep error"/);
  assert.match(retention, /editable=\{!busy\}/);
  assert.match(
    retention,
    /disabled=\{busy \|\| !changed.length \|\| invalidDays\}/,
  );
  assert.match(
    retention,
    /Permanently removes expired records. This cannot be undone/,
  );
  assert.match(announcement, /editable=\{!busy\}/);
  assert.match(announcement, /disabled=\{busy\}/);
  assert.match(announcement, /Showing until/);
});

test("account options and analytics expose secondary content without losing values", () => {
  const source = (path: string) =>
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const account = source("desktop/src/features/admin/AdminUserDetail.tsx");
  const analytics = source("desktop/src/features/admin/AdminAnalytics.tsx");
  const mobile = source("mobile/src/screens/AdminInsights.tsx");
  const bars = source("desktop/src/features/admin/Bars.tsx");
  assert.match(account, /label="Account options"/);
  assert.match(account, /<code>\{link\}<\/code>/);
  assert.match(account, /disabled=\{busy \|\| self \|\| !d.sessions.length\}/);
  assert.match(account, /<summary>Device details<\/summary>/);
  assert.match(analytics, /metrics\(tiles.slice\(0, 4\)\)/);
  assert.match(analytics, /metrics\(tiles.slice\(4\)\)/);
  assert.match(analytics, /<summary>Activity trends<\/summary>/);
  const mobileAccount = mobile.slice(
    mobile.indexOf("export function AdminAccount"),
    mobile.indexOf("export function RetentionCard"),
  );
  assert.match(mobileAccount, /<MoreMenu/);
  assert.doesNotMatch(mobileAccount, /numberOfLines=/);
  assert.match(mobileAccount, /client.adminResetTwoFactor/);
  assert.match(mobileAccount, /client.adminExportUser/);
  assert.match(bars, /<summary>Chart data<\/summary>/);
  assert.match(mobile, /title="Chart data"/);
});

test("legal editing owns its overlay and preserves unrelated details drafts", () => {
  const source = (path: string) =>
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const web = source("desktop/src/features/admin/AdminLegal.tsx");
  const mobile = source("mobile/src/screens/AdminLegal.tsx");
  assert.match(web, /useModalFocus\(onClose, busy\)/);
  assert.match(web, /data-modal-focus=\{focus.id\}/);
  assert.match(web, /event.target === event.currentTarget && !busy/);
  assert.match(web, /onInvalidCapture=/);
  for (const text of [web, mobile]) {
    assert.match(text, /if \(keepDetails\) return/);
    assert.match(text, /"terms_body" in input/);
    assert.match(text, /Saving changes the live text/);
    assert.match(text, /Replaces your live custom text/);
  }
  assert.match(mobile, /<Sheet/);
  assert.match(mobile, /if \(!busy\) setEditing\(null\)/);
  assert.match(mobile, /editable=\{!busy\}/);
});

test("provider setup owns its dialog and keeps embedding consent and model values", () => {
  const source = (path: string) =>
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const web = source("desktop/src/features/admin/AdminAi.tsx");
  const semantic = source("desktop/src/features/admin/SemanticSetup.tsx");
  const mobile = source("mobile/src/screens/AdminAi.tsx");
  assert.match(web, /useModalFocus\(onCancel, busy\)/);
  assert.match(web, /data-modal-focus=\{focus.id\}/);
  assert.match(web, /disabled=\{busy \|\| !!existing\}/);
  assert.doesNotMatch(web, /p.key_hint|stagger\(/);
  assert.match(semantic, /I agree to send workspace page text/);
  assert.match(semantic, /disabled=\{busy \|\| !ready\}/);
  assert.match(semantic, /<summary>Index configuration<\/summary>/);
  assert.match(mobile, /editable=\{!busy\}/);
  assert.match(mobile, /editable=\{!busy && !removeKey\}/);
});

test("agent configuration keeps unrelated drafts and complete app identities", () => {
  const source = (path: string) =>
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const web = source("desktop/src/features/admin/AdminAgents.tsx");
  const mobile = source("mobile/src/screens/AdminAgents.tsx");
  for (const text of [web, mobile]) {
    assert.match(text, /"allowed_client_hosts" in saved/);
    assert.match(text, /"agent_limits" in saved/);
    assert.match(text, /adopt\([^;]+body\)/);
    assert.match(text, /Connection limits/);
    assert.match(text, /Leave empty to allow any website/);
  }
  assert.match(web, /disabled=\{appAction.pending\}/);
  assert.match(mobile, /editable=\{!disabled\}/);
  assert.doesNotMatch(mobile, /numberOfLines=/);
});
