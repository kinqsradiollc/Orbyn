import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";

/**
 * The two files phones check before opening the web app's links in the
 * Orbyn app (universal links on iOS, app links on Android), served from the
 * web host's /.well-known/. Only in-app paths (/app/...) open the app; the
 * homepage, sign-in and public booking pages stay in the browser.
 *
 * Both are built from the environment: APPLE_TEAM_ID for iOS and
 * ANDROID_CERT_FINGERPRINTS (the signing certificates' SHA-256, comma
 * separated) for Android. Without them the files are served empty, so no
 * phone opens a link in an app it can't verify.
 */

/** The bundle id and Android package, as mobile/app.json has them. */
export const APP_ID = "com.orbyn.planner";

/** The web paths the app opens. */
export const APP_PATHS = ["/app/*"];

export function appleAppSiteAssociation(teamId = env.APPLE_TEAM_ID) {
  const id = teamId.trim();
  return {
    applinks: {
      details: id
        ? [
            {
              appIDs: [`${id}.${APP_ID}`],
              components: APP_PATHS.map((path) => ({ "/": path })),
            },
          ]
        : [],
    },
  };
}

export function assetLinks(fingerprints = env.ANDROID_CERT_FINGERPRINTS) {
  const certs = fingerprints
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
  if (!certs.length) return [];
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: APP_ID,
        sha256_cert_fingerprints: certs,
      },
    },
  ];
}

export async function appLinkRoutes(app: FastifyInstance) {
  // Apple fetches this without the .json and wants it as JSON, unredirected.
  app.get("/.well-known/apple-app-site-association", async (_r, reply) =>
    reply
      .header("Content-Type", "application/json")
      .header("Cache-Control", "public, max-age=3600")
      .send(appleAppSiteAssociation()),
  );
  app.get("/.well-known/assetlinks.json", async (_r, reply) =>
    reply.header("Cache-Control", "public, max-age=3600").send(assetLinks()),
  );
}
