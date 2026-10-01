import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { pressableWebState } from "../../mobile/src/motion/accessibility.js";

test("mobile web pressables expose every native accessibility state, including false and mixed", () => {
  assert.deepEqual(
    pressableWebState(
      {
        accessibilityState: {
          busy: true,
          checked: "mixed",
          disabled: false,
          expanded: false,
          selected: true,
        },
      },
      "web",
    ),
    {
      "aria-busy": true,
      "aria-checked": "mixed",
      "aria-disabled": false,
      "aria-expanded": false,
      "aria-selected": true,
    },
  );
  assert.equal(
    pressableWebState({ accessibilityState: { checked: false } }, "web")[
      "aria-checked"
    ],
    false,
  );
});

test("explicit ARIA values are retained and a functionally disabled pressable stays disabled", () => {
  const props = {
    disabled: true,
    "aria-checked": false,
    "aria-disabled": false,
    "aria-expanded": true,
    "aria-selected": false,
    "aria-busy": false,
    accessibilityState: {
      checked: true,
      disabled: false,
      expanded: false,
      selected: true,
      busy: true,
    },
  };
  assert.deepEqual(pressableWebState(props, "web"), {
    "aria-busy": false,
    "aria-checked": false,
    "aria-disabled": true,
    "aria-expanded": true,
    "aria-selected": false,
  });
  assert.equal(props["aria-disabled"], false, "input props are never mutated");
});

test("native pressables receive no additional ARIA overrides", () => {
  for (const platform of ["ios", "android", "windows", "macos"])
    assert.deepEqual(
      pressableWebState(
        {
          accessibilityState: { checked: true, selected: true, disabled: true },
        },
        platform,
      ),
      {},
    );
});

test("both real pressable wrappers forward web state and retain native props", () => {
  for (const name of ["Pressable", "PressableScale"]) {
    for (const platform of ["web", "ios"]) {
      const source = readFileSync(
        new URL(`../../mobile/src/motion/${name}.tsx`, import.meta.url),
        "utf8",
      );
      const compiled = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.React,
          esModuleInterop: true,
        },
      }).outputText;
      const react = {
        createElement: (type: unknown, props: unknown) => ({ type, props }),
        forwardRef: (fn: unknown) => fn,
        useRef: (current: unknown) => ({ current }),
        useState: (value: unknown) => [value, () => {}],
      };
      const exports: Record<
        string,
        (props: unknown) => { props: Record<string, unknown> }
      > = {};
      runInNewContext(compiled, {
        exports,
        require: (id: string) => {
          if (id === "react") return react;
          if (id === "react-native")
            return {
              Platform: { OS: platform },
              Pressable: "native-pressable",
              Animated: {
                Value: class {},
                createAnimatedComponent: (component: unknown) => component,
              },
            };
          if (id === "@orbyn/core")
            return { motion: { pressScale: 0.96, fast: 150 } };
          if (id === "./accessibility") return { pressableWebState };
          return { isReducedMotion: () => true };
        },
      });
      const state = { checked: true, selected: false, expanded: false };
      const element = exports[name]({ accessibilityState: state });
      assert.equal(element.props.accessibilityState, state);
      if (platform === "web") {
        assert.equal(element.props["aria-checked"], true, name);
        assert.equal(element.props["aria-selected"], false, name);
        assert.equal(element.props["aria-expanded"], false, name);
      } else
        assert.equal(Object.hasOwn(element.props, "aria-checked"), false, name);
    }
  }
});
