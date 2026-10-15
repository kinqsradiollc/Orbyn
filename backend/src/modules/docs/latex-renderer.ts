import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_SOURCE = 256 * 1024;
const MAX_PDF = 24 * 1024 * 1024;

/** Compile a standalone source in a fresh network/filesystem namespace.
 * Only the TeX installation and this job are mounted. Never fall back to an
 * unsandboxed compiler when namespaces are unavailable.
 */
export async function renderLatexSnapshot({
  html: source,
  signal,
}: {
  html: string;
  executable: string;
  signal?: AbortSignal;
}): Promise<Buffer> {
  if (Buffer.byteLength(source) > MAX_SOURCE)
    throw new Error("LaTeX source is too large.");
  if (signal?.aborted) throw new Error("Compilation cancelled.");
  const directory = await mkdtemp(join(tmpdir(), "orbyn-latex-"));
  try {
    await writeFile(join(directory, "document.tex"), source, { mode: 0o600 });
    for (let pass = 0; pass < 2; pass++)
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          "/usr/bin/bwrap",
          [
            "--unshare-all",
            "--unshare-user",
            "--die-with-parent",
            "--new-session",
            "--ro-bind",
            "/usr",
            "/usr",
            "--ro-bind",
            "/lib",
            "/lib",
            "--ro-bind-try",
            "/lib64",
            "/lib64",
            "--ro-bind",
            "/etc/texmf",
            "/etc/texmf",
            "--ro-bind",
            "/var/lib/texmf",
            "/var/lib/texmf",
            "--bind",
            directory,
            "/work",
            "--chdir",
            "/work",
            "--tmpfs",
            "/tmp",
            "--dev",
            "/dev",
            "--clearenv",
            "--setenv",
            "PATH",
            "/usr/bin",
            "--setenv",
            "HOME",
            "/tmp",
            "--setenv",
            "openin_any",
            "p",
            "--setenv",
            "openout_any",
            "p",
            "/usr/bin/prlimit",
            "--as=536870912",
            "--cpu=10",
            "--fsize=25165824",
            "--nofile=64",
            "--",
            "/usr/bin/pdflatex",
            "-no-shell-escape",
            "-halt-on-error",
            "-interaction=nonstopmode",
            "document.tex",
          ],
          { cwd: directory, env: {}, detached: true, stdio: "ignore" },
        );
        const stop = () => {
          if (child.pid) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              /* Already exited. */
            }
          }
        };
        const timer = setTimeout(stop, 12_500);
        const abort = () => stop();
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) stop();
        const clean = () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
        };
        child.once("error", () => {
          clean();
          reject(new Error("LaTeX compiler is unavailable."));
        });
        child.once("exit", (code) => {
          clean();
          if (code === 0 && !signal?.aborted) resolve();
          else reject(new Error("LaTeX compilation failed."));
        });
      });
    const path = join(directory, "document.pdf");
    const result = await stat(path);
    if (!result.isFile() || result.size > MAX_PDF)
      throw new Error("LaTeX PDF is too large.");
    const pdf = await readFile(path);
    if (pdf.subarray(0, 5).toString() !== "%PDF-")
      throw new Error("Invalid LaTeX PDF.");
    return pdf;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
