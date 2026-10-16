import { parse, HtmlGenerator } from "latex.js";
const output = document.querySelector("main");
const status = document.querySelector("#status");
const diagnostics = document.querySelector("#diagnostics"),
  diagnosticText = document.querySelector("#diagnostic-text");
let generation = 0,
  timer,
  lastSource = null,
  lastStatus = "",
  lastDetails = "",
  lastDiagnosticHidden = true;
const notify = (message) => {
  const data = JSON.stringify({ type: "orbyn-latex-status", ...message });
  window.parent?.postMessage(data, "*");
  window.ReactNativeWebView?.postMessage(data);
};
// Generated markup has no authority to load resources, navigate or run scripts.
function clean(fragment, blocked) {
  for (const element of fragment.querySelectorAll("*")) {
    if (
      [
        "SCRIPT",
        "IFRAME",
        "OBJECT",
        "EMBED",
        "LINK",
        "META",
        "BASE",
        "FORM",
        "IMG",
        "VIDEO",
        "AUDIO",
      ].includes(element.tagName.toUpperCase())
    ) {
      blocked.count++;
      element.remove();
      continue;
    }
    for (const attr of [...element.attributes]) {
      if (
        /^on/i.test(attr.name) ||
        [
          "href",
          "src",
          "srcset",
          "xlink:href",
          "action",
          "formaction",
        ].includes(attr.name.toLowerCase())
      ) {
        blocked.count++;
        element.removeAttribute(attr.name);
      }
      if (attr.name === "style" && /url\s*\(|expression\s*\(/i.test(attr.value))
        element.removeAttribute("style");
    }
  }
  return fragment;
}
function receive(event) {
  if (event.source && event.source !== window.parent) return;
  let request;
  try {
    request =
      typeof event.data === "string" ? JSON.parse(event.data) : event.data;
  } catch {
    return;
  }
  if (
    request?.type !== "orbyn-latex-source" ||
    typeof request.source !== "string"
  )
    return;
  for (const [name, value] of Object.entries(request.palette ?? {})) {
    if (
      ["surface", "text", "muted", "border"].includes(name) &&
      typeof value === "string" &&
      value.length < 100
    )
      document.documentElement.style.setProperty(`--${name}`, value);
  }
  if (
    typeof request.fontScale === "number" &&
    Number.isFinite(request.fontScale)
  )
    document.documentElement.style.setProperty(
      "--preview-font-scale",
      String(Math.max(0.85, Math.min(3, request.fontScale))),
    );
  const ticket = ++generation;
  clearTimeout(timer);
  if (request.source === lastSource) {
    status.textContent = lastStatus;
    diagnosticText.textContent = lastDetails;
    diagnostics.hidden = lastDiagnosticHidden;
    notify({ state: "ready" });
    return;
  }
  timer = setTimeout(() => {
    if (ticket !== generation) return;
    if (request.source.length > 20_000) {
      status.textContent = "Source is too long for the web preview.";
      return;
    }
    const oldWarn = console.warn,
      oldError = console.error;
    const warnings = [];
    try {
      console.warn = console.error = (...args) => {
        const message = args.map(String).join(" ");
        if (
          !/error loading package "(?:fontenc|inputenc|amsmath|amssymb)"/.test(
            message,
          )
        )
          warnings.push(message);
      };
      const generator = parse(request.source, {
        generator: new HtmlGenerator({ hyphenate: false }),
      });
      const blocked = { count: 0 };
      const fragment = clean(generator.domFragment(), blocked);
      if (ticket !== generation) return;
      const top = document.scrollingElement?.scrollTop ?? 0;
      output.replaceChildren(fragment);
      output.dataset.empty = String(!output.textContent.trim());
      document.scrollingElement?.scrollTo?.(0, top);
      lastSource = request.source;
      diagnostics.hidden = !warnings.length && !blocked.count;
      diagnosticText.textContent = [
        blocked.count
          ? "Links, images and external resources are not active in web preview. Your source is unchanged."
          : "",
        ...warnings.slice(0, 4),
      ]
        .filter(Boolean)
        .join("\n");
      status.textContent = blocked.count
        ? "Some content isn’t active in web preview. See preview details."
        : warnings.length
          ? "Some packages are unavailable in web preview. PDF export uses the full compiler."
          : "";
      lastStatus = status.textContent;
      lastDetails = diagnosticText.textContent;
      lastDiagnosticHidden = diagnostics.hidden;
      notify({ state: "ready", warnings: warnings.length });
    } catch (error) {
      // Keep the last successful document visible during incomplete typing.
      status.textContent =
        lastSource === null
          ? "Couldn’t preview this source. Check the details."
          : "Preview paused. Showing the last preview.";
      diagnostics.hidden = false;
      diagnosticText.textContent = String(
        error.message ?? "Check this LaTeX source.",
      ).slice(0, 1200);
      notify({ state: "error" });
    } finally {
      console.warn = oldWarn;
      console.error = oldError;
    }
  }, 180);
}
window.addEventListener("message", receive);
document.addEventListener("message", receive);
document.addEventListener("click", (event) => {
  if (event.target.closest?.("a")) event.preventDefault();
});
notify({ state: "loaded" });

new ResizeObserver(() =>
  notify({
    state: "size",
    height: Math.ceil(output.scrollHeight + status.offsetHeight + 64),
  }),
).observe(output);
