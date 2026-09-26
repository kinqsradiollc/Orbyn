import { appPath, appUrl, type LinkTarget } from "@orbyn/core";
import { apiBase } from "./api";
import { copyText } from "./planning";

/**
 * Where a link to a page, task or project points. In a browser that is this
 * site. The desktop app runs from disk, so its links name the web app it
 * talks to (VITE_WEB_URL, else the API's address without /api), and when
 * neither is known an orbyn:// link, which the apps open themselves.
 */
export function webOrigin(): string | null {
  if (location.protocol === "http:" || location.protocol === "https:")
    return location.origin;
  const configured = import.meta.env.VITE_WEB_URL;
  if (configured) return configured.replace(/\/+$/, "");
  if (/^https?:\/\//.test(apiBase) && /\/api\/?$/.test(apiBase))
    return apiBase.replace(/\/api\/?$/, "");
  return null;
}

/** The link to a page, task or project, to paste anywhere. */
export function linkTo(target: LinkTarget): string {
  const origin = webOrigin();
  return origin
    ? appUrl(origin, target)
    : `orbyn://${appPath(target).replace(/^\/app\//, "")}`;
}

/** Copy a page, task or project's link; false when the browser refused. */
export const copyLink = (target: LinkTarget) => copyText(linkTo(target));

/** Open a page, task or project in a new tab (⌘Enter in the switcher). */
export function openBeside(target: LinkTarget) {
  const origin = webOrigin();
  if (origin && location.protocol !== "file:")
    window.open(appUrl(origin, target), "_blank", "noopener");
}
