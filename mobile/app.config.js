// Settings that app.json can't hold: they depend on where the web app is.
// Expo reads app.json first and hands it here as `config`, so app.json (and
// its EAS settings) stays as it is and this only adds to it.
//
// Links to the web app's /app/ pages (a page, task or project someone
// shared) open in the app: universal links on iOS (associatedDomains) and
// verified app links on Android (intentFilters). The web host serves the
// matching /.well-known/ files (see backend/src/modules/app-links). The host
// is EXPO_PUBLIC_WEB_URL's, or orbyn.dev.

const DEFAULT_WEB_URL = "https://orbyn.dev";

/** The web app's host name, or null when it isn't a public https address. */
function webHost() {
  try {
    const url = new URL(process.env.EXPO_PUBLIC_WEB_URL || DEFAULT_WEB_URL);
    if (url.protocol !== "https:") return null;
    if (url.hostname === "localhost" || /^[\d.]+$/.test(url.hostname))
      return null;
    return url.hostname;
  } catch {
    return null;
  }
}

/**
 * Native capture and the app icon (D5), added to what app.json holds:
 *
 * - the widget target (@bacons/apple-targets builds mobile/targets/), the
 *   Siri and Shortcuts actions, the focus session's Live Activity, and the
 *   Android widget and Quick Settings tile (mobile/modules/orbyn-capture);
 * - the microphone, for recording into a page (expo-audio);
 * - the app icon in light, dark and tinted (iOS 18) and as an adaptive and
 *   themed icon on Android, all in the palette's own green (DSN-06).
 *
 * A plugin already listed in app.json isn't listed twice.
 */
const MICROPHONE =
  "Orbyn records audio into a page when you press Record. The recording stays on that page.";

function withNative(config) {
  const plugins = [...(config.plugins ?? [])];
  const named = (p) => (Array.isArray(p) ? p[0] : p);
  const add = (plugin) => {
    if (!plugins.some((p) => named(p) === named(plugin))) plugins.push(plugin);
  };
  add("@bacons/apple-targets");
  add("./modules/orbyn-capture/app.plugin.js");
  add(["expo-audio", { microphonePermission: MICROPHONE }]);
  const ios = config.ios ?? {};
  const android = config.android ?? {};
  return {
    ...config,
    plugins,
    icon: config.icon ?? "./assets/icons/icon-light.png",
    ios: {
      ...ios,
      icon: ios.icon ?? {
        light: "./assets/icons/icon-light.png",
        dark: "./assets/icons/icon-dark.png",
        tinted: "./assets/icons/icon-tinted.png",
      },
      infoPlist: {
        ...(ios.infoPlist ?? {}),
        NSMicrophoneUsageDescription: MICROPHONE,
      },
    },
    android: {
      ...android,
      adaptiveIcon: android.adaptiveIcon ?? {
        foregroundImage: "./assets/icons/adaptive-foreground.png",
        monochromeImage: "./assets/icons/adaptive-monochrome.png",
        backgroundColor: "#376c51",
      },
    },
  };
}

module.exports = ({ config: base }) => {
  const config = withNative(base);
  const host = webHost();
  if (!host) return config;
  const ios = config.ios ?? {};
  const android = config.android ?? {};
  const domain = `applinks:${host}`;
  return {
    ...config,
    ios: {
      ...ios,
      associatedDomains: [
        ...(ios.associatedDomains ?? []).filter((d) => d !== domain),
        domain,
      ],
    },
    android: {
      ...android,
      intentFilters: [
        ...(android.intentFilters ?? []),
        {
          action: "VIEW",
          autoVerify: true,
          data: [{ scheme: "https", host, pathPrefix: "/app/" }],
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
    },
  };
};
