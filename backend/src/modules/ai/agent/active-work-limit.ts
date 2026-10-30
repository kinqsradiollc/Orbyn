/** Only active automatic execution is counted. Saved human-reviewed plan
 * finalization retains its separate existing continuation window. */
export function activeWorkLimitMs(
  globalLimit: number,
  configured: unknown,
): number {
  return typeof configured === "number" &&
    Number.isSafeInteger(configured) &&
    configured > 0
    ? Math.min(globalLimit, configured)
    : globalLimit;
}

/** Parking folds elapsed active work into elapsedMs and clears startedAt;
 * resuming supplies the new start, so queued/parked time is not added. */
export function activeWorkRemainingMs(
  globalLimit: number,
  configured: unknown,
  elapsedMs: number,
  startedAt: number | undefined,
  now: number,
): number {
  return (
    activeWorkLimitMs(globalLimit, configured) -
    elapsedMs -
    (startedAt === undefined ? 0 : Math.max(0, now - startedAt))
  );
}
