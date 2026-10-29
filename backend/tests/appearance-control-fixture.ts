import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import type { ComponentType } from "react";

const require = createRequire(import.meta.url);

/** Render the production switch in page/chrome fixtures without browser storage.
 * Theme persistence and updates are exercised by appearance-sync.unit.test.ts.
 */
export function appearanceControlFixture(): {
  AppearanceControl: ComponentType;
} {
  const React = require("react");
  const icon = () => React.createElement("svg", { "aria-hidden": true });
  const modules: Record<string, unknown> = {
    "react/jsx-runtime": require("react/jsx-runtime"),
    "lucide-react": { Moon: icon, Sun: icon },
    "../lib/theme": { useTheme: () => ["light", () => {}] },
    "./appearance-control.css": {},
  };
  const module = { exports: {} };
  runInNewContext(
    transformSync(
      readFileSync(
        new URL(
          "../../desktop/src/components/AppearanceControl.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      { loader: "tsx", format: "cjs", jsx: "automatic" },
    ).code,
    {
      module,
      exports: module.exports,
      require: (name: string) => {
        if (!(name in modules))
          throw new Error(`Unexpected appearance dependency: ${name}`);
        return modules[name];
      },
    },
  );
  return module.exports as { AppearanceControl: ComponentType };
}
