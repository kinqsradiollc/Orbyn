import { errorMessage, logError } from "@orbyn/core";

/**
 * Technical detail in error messages on screen: always in development, and
 * in a build made with DEBUG_ERRORS=true (VITE_DEBUG_ERRORS). Otherwise people
 * see plain sentences and the detail is in the browser console.
 */
export const DEBUG_ERRORS =
  import.meta.env.DEV || import.meta.env.VITE_DEBUG_ERRORS === "true";

/**
 * A readable message for a failed action, and the full story in the console
 * (the call, status, server detail and request id).
 */
export function errorText(e: unknown, context?: string): string {
  logError(e, context);
  return errorMessage(e, DEBUG_ERRORS);
}
