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

module.exports = ({ config }) => {
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
