/**
 * Links that open one page, task or project: `/app/doc/<id>`,
 * `/app/task/<id>` and `/app/project/<id>`, as Share → Link hands them out
 * and the answers of AI tools connected over MCP carry them. Opened over the
 * usual app once signed in; a link followed while signed out is remembered
 * for this tab and opened right after signing in.
 */
import { parseAppLink, type LinkTarget } from "@orbyn/core";

const KEY = "orbyn-open-link";

/** The page, task or project an `/app/...` path names, or null. */
export function linkTarget(path: string): LinkTarget | null {
  if (!path.startsWith("/app/")) return null;
  // Any origin will do: only the path is read.
  const link = parseAppLink(`https://orbyn.invalid${path}`);
  return link &&
    (link.kind === "doc" || link.kind === "task" || link.kind === "project")
    ? link
    : null;
}

/** Whether a path is inside the signed-in app (`/app` or under it). */
export const inApp = (path: string) =>
  path === "/app" || path.startsWith("/app/");

/**
 * Where a path goes, signed in or out: `go` is the path to move to (null to
 * stay), `open` what to open over the app, `remember` what to keep for
 * after sign-in.
 */
export function routeLink(
  path: string,
  signedIn: boolean,
): { go: string | null; open: LinkTarget | null; remember: LinkTarget | null } {
  const target = linkTarget(path);
  if (signedIn) {
    if (target) return { go: "/app", open: target, remember: null };
    if (path === "/login" || path === "/signup")
      return { go: "/app", open: null, remember: null };
    return { go: null, open: null, remember: null };
  }
  if (inApp(path)) return { go: "/login", open: null, remember: target };
  return { go: null, open: null, remember: null };
}

/** Keep a link to open after signing in. */
export function rememberLink(target: LinkTarget) {
  try {
    sessionStorage.setItem(KEY, `${target.kind}/${target.id}`);
  } catch {
    // Storage can be off (a private window): the link just opens the app.
  }
}

/** The link waiting since before sign-in, once; null when there's none. */
export function takeLink(): LinkTarget | null {
  try {
    const kept = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return kept ? linkTarget(`/app/${kept}`) : null;
  } catch {
    return null;
  }
}
