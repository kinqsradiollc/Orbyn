/** Web-only envelope around the shared engine's existing native-host callback.
 * Requests are serialized so an engine status always belongs to one source ticket.
 */
(() => {
  type Request = {
    type: "orbyn-web-latex-source";
    nonce: string;
    ticket: number;
    source: string;
    palette: Record<string, string>;
    fontScale: number;
  };
  const authorized = new WeakSet<Event>();
  const guard = (event: MessageEvent<unknown>) => {
    if (authorized.has(event)) return;
    if (event.source !== window.parent) {
      event.stopImmediatePropagation();
      return;
    }
    let data: unknown = event.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    // Only this adapter may dispatch the shared engine's legacy protocol.
    if (
      data &&
      typeof data === "object" &&
      "type" in data &&
      data.type === "orbyn-latex-source"
    )
      event.stopImmediatePropagation();
  };
  window.addEventListener("message", guard, true);
  document.addEventListener("message", guard, true);
  let loaded = false;
  let active: Request | null = null;
  let latest: Request | null = null;
  let queued: Request | null = null;
  const send = (state: string, height?: number) => {
    window.parent.postMessage(
      {
        type: "orbyn-web-latex-status",
        nonce: latest?.nonce,
        ticket: latest?.ticket,
        state,
        ...(height === undefined ? {} : { height }),
      },
      "*",
    );
  };
  const pump = () => {
    if (!loaded || active || !queued) return;
    active = queued;
    latest = active;
    queued = null;
    const event = new MessageEvent("message", {
      source: window.parent,
      data: {
        type: "orbyn-latex-source",
        source: active.source,
        palette: active.palette,
        fontScale: active.fontScale,
      },
    });
    authorized.add(event);
    window.dispatchEvent(event);
  };
  const bridge = {
    postMessage(raw: string) {
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        return;
      }
      if (!value || typeof value !== "object") return;
      const message = value as Record<string, unknown>;
      if (message.type !== "orbyn-latex-status") return;
      if (message.state === "loaded") {
        loaded = true;
        send("loaded");
        pump();
      } else if (message.state === "ready" || message.state === "error") {
        if (!active) return;
        send(message.state);
        active = null;
        queueMicrotask(pump);
      } else if (
        message.state === "size" &&
        typeof message.height === "number" &&
        Number.isFinite(message.height)
      ) {
        send("size", message.height);
      }
    },
  };
  // The shared engine emits its status here as well as to the parent. The
  // parent adapter ignores its unenveloped messages; no engine code is patched.
  Object.defineProperty(window, "ReactNativeWebView", { value: bridge });
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (
      event.source !== window.parent ||
      !event.data ||
      typeof event.data !== "object"
    )
      return;
    const data = event.data as Record<string, unknown>;
    if (
      data.type !== "orbyn-web-latex-source" ||
      typeof data.nonce !== "string" ||
      data.nonce.length > 80 ||
      typeof data.ticket !== "number" ||
      !Number.isSafeInteger(data.ticket) ||
      data.ticket < 1 ||
      typeof data.source !== "string" ||
      data.source.length > 20_000 ||
      typeof data.fontScale !== "number" ||
      !Number.isFinite(data.fontScale)
    )
      return;
    const palette: Record<string, string> = {};
    if (data.palette && typeof data.palette === "object") {
      for (const [name, value] of Object.entries(data.palette)) {
        if (
          ["surface", "text", "muted", "border"].includes(name) &&
          typeof value === "string" &&
          value.length < 100
        )
          palette[name] = value;
      }
    }
    queued = {
      type: "orbyn-web-latex-source",
      nonce: data.nonce,
      ticket: data.ticket,
      source: data.source,
      palette,
      fontScale: data.fontScale,
    };
    pump();
  });
})();
