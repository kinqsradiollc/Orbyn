/** Close every owned fixture resource, retaining every teardown failure. */
export async function cleanupFixtures(
  steps: Array<() => unknown | Promise<unknown>>,
) {
  const failures: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(failures, "Fixture cleanup failed");
}
