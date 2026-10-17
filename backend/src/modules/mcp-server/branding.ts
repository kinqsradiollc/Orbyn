import { env } from "../../config/env.js";

/** Public, first-party identity only; no connection or account data in icon URLs. */
export const connectorBranding = {
  websiteUrl: env.APP_URL,
  icons: [
    {
      src: new URL(
        `/icon-512.png?v=${encodeURIComponent(env.APP_VERSION)}`,
        env.APP_URL,
      ).href,
      mimeType: "image/png",
      sizes: ["512x512"],
    },
  ],
};
