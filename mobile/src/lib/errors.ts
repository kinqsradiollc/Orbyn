import { errorMessage, logError } from "@orbyn/core";

/**
 * Technical detail appears on screen only when EXPO_PUBLIC_DEBUG_ERRORS=true.
 * Development previews use the same plain messages as production by default;
 * full diagnostics remain in Metro or the device log.
 */
export const DEBUG_ERRORS = process.env.EXPO_PUBLIC_DEBUG_ERRORS === "true";

/**
 * A readable message for a failed action, and the full story in the console
 * (the call, status, server detail and request id).
 */
export function errorText(e: unknown, context?: string): string {
  logError(e, context);
  return errorMessage(e, DEBUG_ERRORS);
}
