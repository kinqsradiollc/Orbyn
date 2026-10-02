import { fork } from "node:child_process";

/** Run automation integration fixtures in the same separate process as production. */
export async function startTestAssistantRuntime(
  lane: "background" | "overnight",
  options: { maxRunMs?: number } = {},
) {
  const child = fork(
    new URL("./assistant-runner-process.ts", import.meta.url),
    [],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "inherit", "ipc"],
      env: {
        ...process.env,
        RUNNER_TEST_LANE: lane,
        RUNNER_TEST_MAX_RUN_MS: options.maxRunMs?.toString() ?? "",
      },
    },
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`The ${lane} test runtime did not start`));
      }, 8000);
      const ready = (message: unknown) => {
        if (
          message &&
          typeof message === "object" &&
          "kind" in message &&
          message.kind === "ready"
        ) {
          cleanup();
          resolve();
        }
      };
      const exited = () => {
        cleanup();
        reject(new Error(`The ${lane} test runtime exited before startup`));
      };
      const cleanup = () => {
        clearTimeout(timeout);
        child.off("message", ready);
        child.off("exit", exited);
      };
      child.on("message", ready);
      child.once("exit", exited);
    });
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
  return async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => child.kill("SIGKILL"), 25_000);
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `The ${lane} test runtime stopped with ${signal ?? code}`,
            ),
          );
      });
      child.kill("SIGTERM");
    });
  };
}
