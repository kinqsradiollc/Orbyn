/**
 * Config plugin for capture from outside the app (D5: CAP-05, CAP-06,
 * CAP-07, CAP-09). With the widget target (@bacons/apple-targets,
 * mobile/targets/widget) and this module's native code, it adds:
 *
 * - iOS: the Siri, Shortcuts and Spotlight actions (native/ios/
 *   OrbynIntents.swift) to the app target, where App Intents must live to
 *   be found; NSSupportsLiveActivities for the focus session's Live
 *   Activity; and the App Group the widgets share.
 * - Android: the Home Screen widget (OrbynTodayWidget) and the Quick
 *   Settings tile (OrbynCaptureTile) in the app's own package, their
 *   layouts, drawables, strings and palette colours, and their manifest
 *   entries.
 *
 * Takes effect in a native build (EAS or expo prebuild). Expo Go and the
 * web build have none of it; the JS side no-ops there.
 */
const fs = require("fs");
const path = require("path");

const APP_GROUP = "group.com.orbyn.planner";
const NATIVE = path.join(__dirname, "native");
const INTENTS_FILE = "OrbynIntents.swift";

/** The Kotlin sources, with the app's package filled in. */
function androidSources(pkg) {
  return ["OrbynTodayWidget.kt", "OrbynCaptureTile.kt"].map((name) => ({
    name,
    body: fs
      .readFileSync(path.join(NATIVE, "android", name), "utf8")
      .replace(/PACKAGE_NAME/g, pkg),
  }));
}

/** The manifest entries for the widget and the tile. */
function androidManifestEntries() {
  return {
    receiver: {
      $: {
        "android:name": ".OrbynTodayWidget",
        "android:exported": "true",
        "android:label": "Orbyn",
      },
      "intent-filter": [
        {
          action: [
            { $: { "android:name": "android.appwidget.action.APPWIDGET_UPDATE" } },
          ],
        },
      ],
      "meta-data": [
        {
          $: {
            "android:name": "android.appwidget.provider",
            "android:resource": "@xml/orbyn_widget_info",
          },
        },
      ],
    },
    service: {
      $: {
        "android:name": ".OrbynCaptureTile",
        "android:exported": "true",
        "android:label": "@string/orbyn_tile_label",
        "android:icon": "@drawable/orbyn_tile",
        "android:permission": "android.permission.BIND_QUICK_SETTINGS_TILE",
      },
      "intent-filter": [
        {
          action: [
            { $: { "android:name": "android.service.quicksettings.action.QS_TILE" } },
          ],
        },
      ],
    },
  };
}

/** Put an entry in the application, replacing ours from an earlier build. */
function upsert(list = [], entry) {
  const name = entry.$["android:name"];
  return [...list.filter((e) => e.$?.["android:name"] !== name), entry];
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const item of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, item.name);
    const dest = path.join(to, item.name);
    if (item.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

function withOrbynCapture(config) {
  const {
    withAndroidManifest,
    withDangerousMod,
    withEntitlementsPlist,
    withInfoPlist,
    withXcodeProject,
  } = require("expo/config-plugins");

  // ---- iOS ----
  config = withInfoPlist(config, (c) => {
    c.modResults.NSSupportsLiveActivities = true;
    return c;
  });
  config = withEntitlementsPlist(config, (c) => {
    const key = "com.apple.security.application-groups";
    const groups = new Set(c.modResults[key] ?? []);
    groups.add(APP_GROUP);
    c.modResults[key] = [...groups];
    return c;
  });
  config = withDangerousMod(config, [
    "ios",
    async (c) => {
      const appDir = path.join(
        c.modRequest.platformProjectRoot,
        c.modRequest.projectName,
      );
      fs.copyFileSync(
        path.join(NATIVE, "ios", INTENTS_FILE),
        path.join(appDir, INTENTS_FILE),
      );
      return c;
    },
  ]);
  config = withXcodeProject(config, (c) => {
    const project = c.modResults;
    const name = c.modRequest.projectName;
    const file = `${name}/${INTENTS_FILE}`;
    // The app's own group, so the file is compiled into the app target.
    if (!project.hasFile(file))
      project.addSourceFile(file, null, project.findPBXGroupKey({ name }));
    return c;
  });

  // ---- Android ----
  config = withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (!app) return c;
    const { receiver, service } = androidManifestEntries();
    app.receiver = upsert(app.receiver, receiver);
    app.service = upsert(app.service, service);
    return c;
  });
  config = withDangerousMod(config, [
    "android",
    async (c) => {
      const pkg = c.android?.package;
      if (!pkg) throw new Error("The widget and tile need android.package set.");
      const main = path.join(c.modRequest.platformProjectRoot, "app/src/main");
      const javaDir = path.join(main, "java", ...pkg.split("."));
      fs.mkdirSync(javaDir, { recursive: true });
      for (const { name, body } of androidSources(pkg))
        fs.writeFileSync(path.join(javaDir, name), body);
      copyDir(path.join(NATIVE, "android", "res"), path.join(main, "res"));
      return c;
    },
  ]);

  return config;
}

module.exports = withOrbynCapture;
module.exports.androidSources = androidSources;
module.exports.androidManifestEntries = androidManifestEntries;
module.exports.APP_GROUP = APP_GROUP;
