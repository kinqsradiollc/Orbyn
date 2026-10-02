import mermaid from "mermaid";
import { prepareMermaidSource, MERMAID_MAX_SVG } from "@orbyn/core";

let generation = 0;
let lastId = "";
const send = (value) => {
  const payload = JSON.stringify(value);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(payload);
  else window.parent.postMessage(payload, "*");
};
const receive = async (event) => {
  if (!window.ReactNativeWebView && event.source !== window.parent) return;
  let request;
  try {
    request = JSON.parse(event.data);
  } catch {
    return;
  }
  if (
    request?.type !== "orbyn-diagram" ||
    typeof request.id !== "string" ||
    request.id.length > 128 ||
    request.id === lastId ||
    typeof request.source !== "string"
  )
    return;
  lastId = request.id;
  const current = ++generation;
  const host = document.getElementById("diagram");
  host.replaceChildren();
  try {
    const source = prepareMermaidSource(request.source);
    const palette = {};
    for (const key of [
      "background",
      "primaryColor",
      "primaryBorderColor",
      "primaryTextColor",
      "secondaryColor",
      "tertiaryColor",
      "lineColor",
      "textColor",
      "noteBkgColor",
      "noteTextColor",
    ]) {
      const value = request.palette?.[key];
      if (
        typeof value !== "string" ||
        !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
      )
        throw new Error("Invalid diagram theme.");
      palette[key] = value;
    }
    // Mermaid base theme otherwise supplies pale ER rows even in dark mode.
    palette.rowOdd = palette.secondaryColor;
    palette.rowEven = palette.primaryColor;
    const config = {
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "base",
      themeVariables: palette,
      fontFamily: "system-ui, sans-serif",
      maxTextSize: 65_536,
      maxEdges: 512,
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      secure: [],
    };
    config.secure = Object.keys(config);
    mermaid.initialize(config);
    const { svg } = await mermaid.render(`render-${current}`, source);
    if (current !== generation) return;
    if (svg.length > MERMAID_MAX_SVG)
      throw new Error("The rendered diagram is too large.");
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    parsed
      .querySelectorAll(
        "script,iframe,object,embed,image,foreignObject,animate,animateMotion,animateTransform,set",
      )
      .forEach((node) => node.remove());
    for (const node of parsed.querySelectorAll("*")) {
      for (const attribute of [...node.attributes]) {
        if (
          /^(?:style|fill|stroke|filter|mask|clip-path|marker(?:-start|-mid|-end)?)$/i.test(
            attribute.name,
          ) &&
          /[\\@]|image-set\s*\(/i.test(attribute.value)
        )
          throw new Error("External diagram styles are not supported.");
        if (
          /^on/i.test(attribute.name) ||
          (/(?:^|:)href$/i.test(attribute.name) &&
            !attribute.value.startsWith("#"))
        )
          node.removeAttribute(attribute.name);
        for (const match of attribute.value.matchAll(/url\(([^)]*)\)/gi)) {
          if (!/^#[\w:-]+$/.test(match[1].trim().replace(/^['"]|['"]$/g, "")))
            throw new Error("External diagram resources are not supported.");
        }
      }
      if (node.tagName === "style") {
        // Mermaid emits these two stock animations even for static diagrams.
        // Remove only their exact inert bodies; every other at-rule, escape
        // and external resource still fails closed below.
        node.textContent = node.textContent.replace(
          /@keyframes\s+(?:edge-animation-frame|dash)\s*\{\s*(?:from|to)\s*\{\s*stroke-dashoffset\s*:\s*0\s*;?\s*\}\s*\}/gi,
          "",
        );
        if (/[\\@]|image-set\s*\(/i.test(node.textContent))
          throw new Error("External diagram styles are not supported.");
        for (const match of node.textContent.matchAll(/url\(([^)]*)\)/gi)) {
          if (!/^#[\w:-]+$/.test(match[1].trim().replace(/^['"]|['"]$/g, "")))
            throw new Error("External diagram resources are not supported.");
        }
      }
    }
    const safeSvg = new XMLSerializer().serializeToString(
      parsed.documentElement,
    );
    host.innerHTML = safeSvg;
    const drawing = host.querySelector("svg");
    if (!drawing) throw new Error("The diagram did not produce an image.");
    const bounds = drawing.viewBox.baseVal;
    const width = Math.max(120, Math.min(8192, bounds.width || 320));
    const height = Math.max(100, Math.min(8192, bounds.height || 240));
    drawing.style.maxWidth = "none";
    const zoom = Number.isFinite(request.zoom)
      ? Math.min(3, Math.max(0.5, request.zoom))
      : 1;
    const viewport = Number.isFinite(request.viewportWidth)
      ? Math.max(120, Math.min(8192, request.viewportWidth))
      : width + 24;
    const scale = Math.min(1, (viewport - 24) / width) * zoom;
    drawing.style.width = `${width * scale}px`;
    drawing.style.height = `${height * scale}px`;
    send({
      type: "orbyn-diagram-result",
      id: request.id,
      width,
      // Match the renderer host's 12px padding above and below the SVG.
      height: height * scale + 24,
      svg: safeSvg,
    });
  } catch (error) {
    if (current !== generation) return;
    host.replaceChildren();
    send({
      type: "orbyn-diagram-result",
      id: request.id,
      error: String(error?.message || "The diagram could not be drawn.").slice(
        0,
        1000,
      ),
    });
  }
};
window.addEventListener("message", receive);
document.addEventListener("message", receive);
document.addEventListener("click", (event) => {
  if (event.target.closest("a")) event.preventDefault();
});
