/**
 * Links that open one task or event: `/app/task/<id>`, as the answers of
 * AI tools connected over MCP carry them. Opened over the usual app once
 * signed in; a link followed while signed out is remembered for this tab
 * and opened right after signing in.
 */
const KEY = "orbyn-open-task";

/** The task id in a `/app/task/<id>` path, or null for any other path. */
export const taskLinkId = (path: string) =>
  /^\/app\/task\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(
    path,
  )?.[1] ?? null;

/** Keep a task link to open after signing in. */
export function rememberTaskLink(id: string) {
  try {
    sessionStorage.setItem(KEY, id);
  } catch {
    // Storage can be off (a private window): the link just opens the app.
  }
}

/** The task link waiting since before sign-in, once; null when there's none. */
export function takeTaskLink(): string | null {
  try {
    const id = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return id && taskLinkId(`/app/task/${id}`) ? id : null;
  } catch {
    return null;
  }
}
