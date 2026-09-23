import { errorMessage, logError } from "@orbyn/core";

/**
 * Technical detail in error messages on screen: always in development
 * (`__DEV__`), and in a build made with EXPO_PUBLIC_DEBUG_ERRORS=true.
 * Otherwise people see plain sentences and the detail is in the console
 * (Metro, or the device log).
 */
export const DEBUG_ERRORS =
  (typeof __DEV__ !== "undefined" && __DEV__) ||
  process.env.EXPO_PUBLIC_DEBUG_ERRORS === "true";

/**
 * A readable message for a failed action, and the full story in the console
 * (the call, status, server detail and request id).
 */
export function errorText(e: unknown, context?: string): string {
  logError(e, context);
  return errorMessage(e, DEBUG_ERRORS);
}
