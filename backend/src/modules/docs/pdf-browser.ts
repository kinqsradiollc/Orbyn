import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";

const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;
const MAX_PENDING = 16;
export type PdfBrowserEvent = {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
};
export interface PdfBrowser {
  command<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<T>;
  events(listener: (event: PdfBrowserEvent) => void): () => void;
  close(): Promise<void>;
}

/** A private bounded pipe, used only by document printing; never opens a debug network port. */
export function pdfBrowserPipe(
  child: ChildProcess,
  timeoutMs = 20_000,
  kill = () => {
    child.kill("SIGKILL");
  },
): PdfBrowser {
  const input = child.stdio[3] as Writable;
  const output = child.stdio[4] as Readable;
  let sequence = 0,
    ended = false,
    buffered = 0;
  let chunks: Buffer[] = [];
  const listeners = new Set<(event: PdfBrowserEvent) => void>();
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const error = () => new Error("The document PDF renderer is unavailable.");
  const stop = (reason = error()) => {
    if (ended) return;
    ended = true;
    chunks = [];
    buffered = 0;
    listeners.clear();
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(reason);
    }
    pending.clear();
    kill();
  };
  child.once("error", () => stop());
  child.once("exit", () => stop());
  input.on("error", () => stop());
  output.on("error", () => stop());
  output.on("end", () => stop());
  output.on("data", (data: Buffer) => {
    if (ended) return;
    let start = 0;
    while (start < data.length) {
      const end = data.indexOf(0, start);
      const part = data.subarray(start, end < 0 ? data.length : end);
      buffered += part.length;
      if (buffered > MAX_MESSAGE_BYTES) {
        stop();
        return;
      }
      chunks.push(part);
      if (end < 0) return;
      const message = Buffer.concat(chunks, buffered).toString("utf8");
      chunks = [];
      buffered = 0;
      start = end + 1;
      if (!message) continue;
      try {
        const value = JSON.parse(message);
        if (!value || typeof value !== "object") throw error();
        if (Number.isSafeInteger(value.id)) {
          const request = pending.get(value.id);
          if (!request) continue;
          clearTimeout(request.timer);
          pending.delete(value.id);
          if (value.error) request.reject(error());
          else request.resolve(value.result ?? {});
        } else if (typeof value.method === "string") {
          for (const listener of listeners) listener(value);
        } else throw error();
      } catch {
        stop();
        return;
      }
    }
  });
  return {
    command<T>(method: string, params = {}, sessionId?: string): Promise<T> {
      if (ended || pending.size >= MAX_PENDING) return Promise.reject(error());
      const id = ++sequence;
      const message = Buffer.from(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }) + "\0",
      );
      if (message.length > MAX_MESSAGE_BYTES) return Promise.reject(error());
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(
          () => stop(new Error("Document PDF rendering timed out.")),
          timeoutMs,
        );
        pending.set(id, {
          resolve: (value) => resolve(value as T),
          reject,
          timer,
        });
        input.write(message, (failure) => {
          if (failure) stop();
        });
      });
    },
    events(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      stop();
    },
  };
}

/** Launch a fresh printing process with no inherited app credentials or user browser profile. */
export async function openPdfBrowser(
  executable: string,
  signal: AbortSignal,
): Promise<PdfBrowser> {
  if (signal.aborted)
    throw Object.assign(new Error("PDF export cancelled."), {
      name: "AbortError",
    });
  const directory = await mkdtemp(join(tmpdir(), "orbyn-pdf-"));
  let child: ChildProcess;
  try {
    child = spawn(
      executable,
      [
        "--headless",
        "--disable-gpu",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--remote-debugging-pipe",
        `--user-data-dir=${directory}`,
        "about:blank",
      ],
      {
        cwd: directory,
        detached: process.platform !== "win32",
        env: {
          PATH: process.env.PATH,
          LANG: "en_US.UTF-8",
          TMPDIR: directory,
          XDG_CONFIG_HOME: directory,
          XDG_CACHE_HOME: directory,
        },
        stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
      },
    );
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });
  const pipe = pdfBrowserPipe(child, 20_000, () => {
    try {
      if (process.platform !== "win32" && child.pid)
        process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  });
  const abort = () => {
    void pipe.close();
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let closed = false;
  return {
    command: pipe.command,
    events: pipe.events,
    async close() {
      if (closed) return;
      closed = true;
      signal.removeEventListener("abort", abort);
      await pipe.close();
      await exited;
      await rm(directory, { recursive: true, force: true });
    },
  };
}
