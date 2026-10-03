/** Error carrying an HTTP status. Thrown by the backend and by the API client. */
export class HttpError extends Error {
  readonly statusCode: number;
  /** Server retry hint for clients; milliseconds from receipt of the response. */
  retryAfterMs?: number;
  /** The technical detail the server sent (only with DEBUG_ERRORS on there). */
  detail?: string;
  /** Which call failed, for the console: "POST /items", and its request id. */
  request?: { method: string; path: string; id: string | null };
  constructor(
    statusCode: number,
    message: string,
    extra: {
      retryAfterMs?: number;
      detail?: string;
      request?: { method: string; path: string; id: string | null };
    } = {},
  ) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.detail = extra.detail;
    this.retryAfterMs = extra.retryAfterMs;
    this.request = extra.request;
  }
  /** Alias kept for client code that reads `error.status`. */
  get status() {
    return this.statusCode;
  }
}

/** Throw an HttpError. Typed as `never` so it can be used in expression position. */
export function fail(statusCode: number, message: string): never {
  throw new HttpError(statusCode, message);
}

/** Shown when the server can't be reached at all. */
export const OFFLINE_MESSAGE =
  "Couldn't reach Orbyn. Check your connection and try again.";
/** Shown for anything unexpected; the detail goes to the console. */
export const GENERIC_ERROR_MESSAGE = "Something went wrong. Try again.";

/** Whether a failure never reached the server (offline, timed out, blocked). */
export function isNetworkError(e: unknown) {
  const name = (e as Error | null)?.name;
  return (
    name === "TypeError" ||
    name === "TimeoutError" ||
    name === "AbortError" ||
    /network request failed|failed to fetch|load failed|networkerror/i.test(
      (e as Error | null)?.message ?? "",
    )
  );
}

/**
 * The sentence to show someone for a failed action. The server's messages
 * are written for people (plain validation, "You can't edit this team's
 * items"), so those are shown; a server error, a dropped connection or a bug
 * in the app becomes a short plain sentence, and what really happened is for
 * the console (`logError`). With `debug` explicitly enabled by the caller,
 * technical detail is added in brackets for troubleshooting.
 */
export function errorMessage(e: unknown, debug = false): string {
  let shown: string;
  if (e instanceof HttpError || (e as HttpError | null)?.name === "HttpError") {
    const h = e as HttpError;
    shown =
      h.statusCode >= 500 && !h.message
        ? GENERIC_ERROR_MESSAGE
        : h.message || GENERIC_ERROR_MESSAGE;
  } else if (isNetworkError(e)) shown = OFFLINE_MESSAGE;
  else shown = GENERIC_ERROR_MESSAGE;
  if (!debug) return shown;
  const detail = errorDetail(e);
  return detail ? `${shown} (${detail})` : shown;
}

/** What went wrong technically, in one line, for the console and debug builds. */
export function errorDetail(e: unknown): string {
  if (e instanceof HttpError || (e as HttpError | null)?.name === "HttpError") {
    const h = e as HttpError;
    return [
      h.request ? `${h.request.method} ${h.request.path}` : "",
      String(h.statusCode),
      h.detail ?? "",
      h.request?.id ? `request ${h.request.id}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  const err = e as Error | null;
  return err ? `${err.name}: ${err.message}` : String(e);
}

/** Log a failed action with everything known about it. */
export function logError(e: unknown, context?: string) {
  // The console is the place for this, in every build.
  console.error(`[orbyn] ${context ? context + ": " : ""}${errorDetail(e)}`, e);
}
