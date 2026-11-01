/** The only post-authentication destinations supported by this web client. */
const allowedPath = (path: string) =>
  path === "/app" || path.startsWith("/app/") || path === "/oauth/authorize";

export function safeNext(
  value: unknown,
  origin = window.location.origin,
): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.trim() !== value ||
    /[\\\u0000-\u001f\u007f]/.test(value)
  )
    return "/app";
  if (
    value.startsWith("//") ||
    (!value.startsWith("/") && !/^https?:\/\//i.test(value))
  )
    return "/app";
  try {
    const destination = new URL(value, origin);
    if (
      destination.origin !== origin ||
      destination.username ||
      destination.password ||
      !allowedPath(destination.pathname)
    )
      return "/app";
    return destination.pathname + destination.search + destination.hash;
  } catch {
    return "/app";
  }
}

export function nextFromSearch(
  search: string,
  origin = window.location.origin,
): string {
  const candidates = new URLSearchParams(search).getAll("next");
  return candidates.length === 1 ? safeNext(candidates[0], origin) : "/app";
}

/** The URL is the return-path owner; no competing sessionStorage record exists. */
export function currentAuthReturn(
  here: Pick<
    Location,
    "pathname" | "search" | "hash" | "origin"
  > = window.location,
): string {
  return allowedPath(here.pathname)
    ? safeNext(here.pathname + here.search + here.hash, here.origin)
    : nextFromSearch(here.search, here.origin);
}

type AuthEntry =
  "/login" | "/signup" | "/forgot-password" | "/terms" | "/privacy";
export function withAuthNext(
  path: AuthEntry,
  next = currentAuthReturn(),
  origin = window.location.origin,
): string {
  return `${path}?${new URLSearchParams({ next: safeNext(next, origin) })}`;
}
