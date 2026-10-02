import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  createDiagramExportBridge,
  docToHtml,
  renderHtmlDiagrams,
} from "@orbyn/core";
import { mermaidFixtures } from "./helpers/mermaid-fixtures.js";

// Test tooling comes from the app's declared dependencies, not a backend runtime dependency.
const { JSDOM, ResourceLoader } = createRequire(
  new URL("../../mobile/package.json", import.meta.url),
)("jsdom");
const mobile = JSON.parse(
  readFileSync(
    new URL("../../mobile/assets/mermaid-runtime.json", import.meta.url),
    "utf8",
  ),
);
const desktop = JSON.parse(
  readFileSync(
    new URL("../../desktop/src/assets/mermaid-runtime.json", import.meta.url),
    "utf8",
  ),
);

test("both export clients bundle the same local strict renderer", () => {
  assert.deepEqual(desktop, mobile);
  assert.match(desktop.html, /connect-src 'none'/);
  assert.match(desktop.html, /default-src 'none'/);
});

test("actual bundled engine renders all export families as self-contained images", async () => {
  let network = 0;
  const errors: string[] = [];
  class NoNetwork extends ResourceLoader {
    fetch() {
      network++;
      throw new Error("Export renderer attempted a network request.");
    }
  }
  let bridge: ReturnType<typeof createDiagramExportBridge>;
  const dom = new JSDOM(mobile.html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    resources: new NoNetwork(),
    beforeParse(window: any) {
      Object.defineProperties(window.HTMLElement.prototype, {
        clientWidth: { get: () => 768 },
        clientHeight: { get: () => 480 },
      });
      const computedStyle = window.getComputedStyle.bind(window);
      window.getComputedStyle = (element: Element) => {
        const style = computedStyle(element);
        for (const side of ["top", "right", "bottom", "left"]) {
          if (!style.getPropertyValue(`padding-${side}`))
            style.setProperty(`padding-${side}`, "0px");
          if (!style.getPropertyValue(`border-${side}-width`))
            style.setProperty(`border-${side}-width`, "0px");
        }
        return style;
      };
      window.TextEncoder = TextEncoder;
      window.TextDecoder = TextDecoder;
      window.structuredClone = structuredClone;
      window.HTMLCanvasElement.prototype.getContext = function () {
        const canvas = this;
        return new Proxy(
          {
            canvas,
            measureText: (text: string) => ({ width: text.length * 8 }),
            getLineDash: () => [],
          },
          {
            get(target, name) {
              return name in target
                ? target[name as keyof typeof target]
                : () => {};
            },
          },
        );
      };
      // Layout stand-ins permit SVG generation; this is not screenshot or native geometry evidence.
      window.SVGElement.prototype.getBBox = function () {
        return {
          x: 0,
          y: 0,
          width: Math.max(30, (this.textContent?.length ?? 0) * 8),
          height: 20,
        };
      };
      window.SVGElement.prototype.getComputedTextLength = function () {
        return this.getBBox().width;
      };
      Object.defineProperty(window.SVGElement.prototype, "viewBox", {
        get() {
          const [x = 0, y = 0, width = 320, height = 240] = (
            this.getAttribute("viewBox") ?? "0 0 320 240"
          )
            .split(/[ ,]+/)
            .map(Number);
          return { baseVal: { x, y, width, height } };
        },
      });
      window.ReactNativeWebView = {
        postMessage: (data: string) => {
          const value = JSON.parse(data);
          if (value.error) errors.push(value.error);
          bridge.receive(data);
        },
      };
    },
  });
  bridge = createDiagramExportBridge((request) => {
    if (request)
      dom.window.dispatchEvent(
        new dom.window.MessageEvent("message", { data: request }),
      );
  }, 10_000);
  try {
    const rendered: string[] = [];
    for (const fixture of mermaidFixtures) {
      const html = docToHtml(
        fixture.kind,
        [{ type: "code", lang: "mermaid", text: fixture.source }],
        { diagramSources: true },
      );
      const exported = await renderHtmlDiagrams(
        html,
        (source) => bridge.render(source),
        bridge.signal,
      );
      assert.doesNotMatch(
        exported,
        /rendering unavailable/,
        `${fixture.kind}: ${errors.join("; ")}`,
      );
      assert.match(exported, /data:image\/svg\+xml/, fixture.kind);
      const encoded = exported.match(
        /src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/,
      )![1];
      const image = new dom.window.DOMParser().parseFromString(
        decodeURIComponent(encoded),
        "image/svg+xml",
      );
      assert.equal(
        image.querySelectorAll(
          "script,iframe,object,embed,image,foreignObject,animate,animateMotion,animateTransform,set,parsererror",
        ).length,
        0,
        fixture.kind,
      );
      for (const element of image.querySelectorAll("*")) {
        for (const attribute of element.attributes) {
          assert.doesNotMatch(attribute.name, /^on/i, fixture.kind);
          if (/(?:^|:)href$/i.test(attribute.name))
            assert.match(attribute.value, /^#/, fixture.kind);
        }
      }
      assert.match(
        exported,
        /<summary>Diagram source<\/summary>/,
        fixture.kind,
      );
      assert.doesNotMatch(exported, /<script|<iframe|<svg\b/i, fixture.kind);
      rendered.push(fixture.kind);
    }
    assert.equal(rendered.length, 10);
    assert.equal(network, 0);
  } finally {
    bridge.dispose();
    dom.window.close();
  }
});
