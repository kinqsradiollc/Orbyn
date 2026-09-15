import type { Status } from "@orbyn/core";
import { dark, light, type Palette } from "./palette";

export type Scheme = "light" | "dark";

let active: Palette = light;

/**
 * Point every live token at `scheme`'s palette. Called by the theme controller
 * during App's render, so the whole tree re-renders with the new colours.
 */
export function applyScheme(scheme: Scheme) {
  active = scheme === "dark" ? dark : light;
}

/**
 * Colour tokens for the active theme. Each read returns the current palette's
 * value, so inline colours follow a theme change on the next render.
 */
export const colors = Object.defineProperties(
  {} as Palette,
  Object.fromEntries(
    (Object.keys(light) as (keyof Palette)[]).map((key) => [
      key,
      { enumerable: true, get: () => active[key] },
    ]),
  ),
);

/**
 * Something built from colour tokens (usually a StyleSheet), built once per
 * palette the first time it's read. Module-level
 * `const s = themed(() => StyleSheet.create({ ... }))` then follows the theme:
 * `s.card` is the active palette's style.
 */
export function themed<T extends object>(build: () => T): T {
  const built = new Map<Palette, T>();
  const current = () => {
    let value = built.get(active);
    if (!value) {
      value = build();
      built.set(active, value);
    }
    return value;
  };
  return new Proxy({} as T, {
    get: (_, key) => current()[key as keyof T],
    has: (_, key) => key in current(),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_, key) => {
      const d = Object.getOwnPropertyDescriptor(current(), key);
      return d && { ...d, configurable: true };
    },
  });
}

/** Task status colours (the @orbyn/core roles) in the active theme. */
export const statusTones = themed<Record<Status, { bg: string; fg: string }>>(
  () => ({
    todo: { bg: colors.lowBg, fg: colors.lowText },
    in_progress: { bg: colors.accentSoft, fg: colors.accent },
    blocked: { bg: colors.dangerSoft, fg: colors.danger },
    done: { bg: colors.soft, fg: colors.mediumText },
  }),
);

/** A "#rrggbb" colour at `alpha` (0-1) opacity, as "#rrggbbaa". */
export const tint = (hex: string, alpha: number) =>
  /^#[0-9a-f]{6}$/i.test(hex)
    ? hex +
      Math.round(Math.min(1, Math.max(0, alpha)) * 255)
        .toString(16)
        .padStart(2, "0")
    : hex;
