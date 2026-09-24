/**
 * Config plugin for the app icon's quick actions (long-press the icon):
 * New task, Today's agenda, Scan notes and Ask assistant. Each opens an
 * orbyn:// link that the app already handles (see parseAppLink in
 * packages/core/src/app-links.ts, whose QUICK_ACTIONS this list must match;
 * a backend test checks that it does).
 *
 * - iOS: static UIApplicationShortcutItems in Info.plist, each carrying its
 *   link in userInfo; the local module (ios/) hands the chosen one to JS.
 * - Android: static app shortcuts (res/xml/orbyn_shortcuts.xml) that open
 *   the link as a VIEW intent on the main activity, so Linking gets it.
 *
 * Takes effect in a native build (EAS, or expo prebuild); Expo Go and the
 * web build don't show quick actions.
 */
const fs = require("fs");
const path = require("path");

/** The quick actions, in the order the icon's menu lists them. */
const QUICK_ACTIONS = [
  {
    id: "new-task",
    title: "New task",
    short: "New task",
    url: "orbyn://add",
    symbol: "square.and.pencil",
  },
  {
    id: "agenda",
    title: "Today’s agenda",
    short: "Agenda",
    url: "orbyn://agenda",
    symbol: "calendar",
  },
  {
    id: "scan",
    title: "Scan notes",
    short: "Scan notes",
    url: "orbyn://scan",
    symbol: "doc.text.viewfinder",
  },
  {
    id: "assistant",
    title: "Ask assistant",
    short: "Assistant",
    url: "orbyn://assistant",
    symbol: "sparkles",
  },
];

/** The part of a shortcut's type that is ours, to replace on each build. */
const TYPE_PREFIX = "orbyn.quick.";
const XML_NAME = "orbyn_shortcuts";
const stringName = (id) => `orbyn_shortcut_${id.replace(/-/g, "_")}`;

/** Info.plist's shortcut items, keeping any that aren't ours. */
function iosShortcutItems(existing = []) {
  const others = existing.filter(
    (item) =>
      !String(item.UIApplicationShortcutItemType).startsWith(TYPE_PREFIX),
  );
  return [
    ...others,
    ...QUICK_ACTIONS.map((a) => ({
      UIApplicationShortcutItemType: `${TYPE_PREFIX}${a.id}`,
      UIApplicationShortcutItemTitle: a.title,
      UIApplicationShortcutItemIconSymbolName: a.symbol,
      UIApplicationShortcutItemUserInfo: { url: a.url },
    })),
  ];
}

const escapeXml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** res/xml/orbyn_shortcuts.xml for an app whose package is `pkg`. */
function androidShortcutsXml(pkg) {
  const shortcuts = QUICK_ACTIONS.map(
    (a) => `  <shortcut
    android:shortcutId="${escapeXml(a.id)}"
    android:enabled="true"
    android:shortcutShortLabel="@string/${stringName(a.id)}_short"
    android:shortcutLongLabel="@string/${stringName(a.id)}">
    <intent
      android:action="android.intent.action.VIEW"
      android:data="${escapeXml(a.url)}"
      android:targetPackage="${escapeXml(pkg)}"
      android:targetClass="${escapeXml(pkg)}.MainActivity" />
  </shortcut>`,
  );
  return `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
${shortcuts.join("\n")}
</shortcuts>
`;
}

/** The labels Android's shortcuts point at, as strings.xml entries. */
function androidStrings() {
  return QUICK_ACTIONS.flatMap((a) => [
    { name: stringName(a.id), value: a.title },
    { name: `${stringName(a.id)}_short`, value: a.short },
  ]);
}

function withQuickActions(config) {
  // Loaded here, not at the top, so the builders above can be tested
  // without the config tooling.
  const {
    AndroidConfig,
    withAndroidManifest,
    withDangerousMod,
    withInfoPlist,
    withStringsXml,
  } = require("expo/config-plugins");

  config = withInfoPlist(config, (c) => {
    c.modResults.UIApplicationShortcutItems = iosShortcutItems(
      c.modResults.UIApplicationShortcutItems ?? [],
    );
    return c;
  });

  config = withStringsXml(config, (c) => {
    for (const { name, value } of androidStrings())
      c.modResults = AndroidConfig.Strings.setStringItem(
        [{ $: { name, translatable: "false" }, _: value }],
        c.modResults,
      );
    return c;
  });

  config = withAndroidManifest(config, (c) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(
      c.modResults,
    );
    const meta = (activity["meta-data"] ?? []).filter(
      (m) => m.$["android:name"] !== "android.app.shortcuts",
    );
    meta.push({
      $: {
        "android:name": "android.app.shortcuts",
        "android:resource": `@xml/${XML_NAME}`,
      },
    });
    activity["meta-data"] = meta;
    return c;
  });

  config = withDangerousMod(config, [
    "android",
    async (c) => {
      const pkg = c.android?.package;
      if (!pkg) throw new Error("Quick actions need android.package set.");
      const dir = path.join(
        c.modRequest.platformProjectRoot,
        "app/src/main/res/xml",
      );
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, `${XML_NAME}.xml`),
        androidShortcutsXml(pkg),
      );
      return c;
    },
  ]);

  return config;
}

module.exports = withQuickActions;
module.exports.QUICK_ACTIONS = QUICK_ACTIONS;
module.exports.iosShortcutItems = iosShortcutItems;
module.exports.androidShortcutsXml = androidShortcutsXml;
module.exports.androidStrings = androidStrings;
