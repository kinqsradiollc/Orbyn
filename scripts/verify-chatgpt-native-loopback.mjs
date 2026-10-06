import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const mode = process.argv[2];
if (!["swift", "kotlin"].includes(mode))
  throw new Error("Choose swift or kotlin.");
const temporary = mkdtempSync(join(tmpdir(), "orbyn-chatgpt-callback-"));
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status}).`);
};
try {
  if (mode === "swift") {
    const output = join(temporary, "loopback-check");
    run("xcrun", [
      "swiftc",
      "mobile/modules/orbyn-chatgpt/ios/ChatgptLoopback.swift",
      "backend/tests/fixtures/chatgpt-loopback-check.swift",
      "-o",
      output,
    ]);
    run(output, []);
  } else {
    // Reuse the project's cached Kotlin tooling; never install packages or build a whole emulator.
    const base = join(homedir(), ".gradle/caches/modules-2/files-2.1");
    const jars = (group, artifact, version) => {
      const directory = join(base, group, artifact);
      const selected =
        version ??
        readdirSync(directory)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          .at(-1);
      return readdirSync(join(directory, selected), { recursive: true })
        .filter((file) => String(file).endsWith(".jar"))
        .map((file) => resolve(directory, selected, String(file)));
    };
    const version = "2.1.20";
    const stdlib = jars("org.jetbrains.kotlin", "kotlin-stdlib", version);
    const paths = [
      ...jars("org.jetbrains.kotlin", "kotlin-compiler-embeddable", version),
      ...stdlib,
      ...jars("org.jetbrains.kotlin", "kotlin-reflect", version),
      ...jars("org.jetbrains.kotlin", "kotlin-script-runtime"),
      ...jars("org.jetbrains.kotlin", "kotlin-daemon-embeddable", version),
      ...jars("org.jetbrains.intellij.deps", "trove4j"),
      ...jars("org.jetbrains", "annotations"),
      ...jars("org.jetbrains.kotlinx", "kotlinx-coroutines-core-jvm"),
    ];
    const classpath = paths.join(":");
    const java = join(
      execFileSync("/usr/libexec/java_home", { encoding: "utf8" }).trim(),
      "bin/java",
    );
    run(java, [
      "-cp",
      classpath,
      "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler",
      "-no-stdlib",
      "-no-reflect",
      "-classpath",
      classpath,
      "-d",
      temporary,
      "mobile/modules/orbyn-chatgpt/android/src/main/java/expo/modules/orbynchatgpt/ChatgptLoopback.kt",
      "backend/tests/fixtures/chatgpt-loopback-check.kt",
    ]);
    run(java, [
      "-cp",
      [temporary, ...stdlib].join(":"),
      "expo.modules.orbynchatgpt.Chatgpt_loopback_checkKt",
    ]);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
