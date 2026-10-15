import { colors as base } from "@orbyn/core";

/**
 * Every colour token the app uses: the shared ones from @orbyn/core plus a few
 * mobile-only ones for colours that used to be written inline.
 */
export type Palette = { [K in keyof typeof base]: string } & {
  /** Outline of a checkbox that isn't ticked yet. */
  checkBorder: string;
  /** Foreground for a primary accent fill. */
  onAccent: string;
  /** Amber for warnings, maintenance and slow services. */
  warning: string;
  warningSoft: string;
  warningBorder: string;
  /** The border of a warning stat (booking pages). */
  warningLine: string;
  /** Warning text that needs more weight (a missing AI key). */
  warningStrong: string;
  amber: string;
  /** Background of an unread notice. */
  unread: string;
  shadow: string;
};

export const light: Palette = {
  ...base,
  onAccent: "#ffffff",
  checkBorder: "#d4d4d8",
  warning: "#916322",
  warningSoft: "#fbf3e2",
  warningBorder: "#f0e2c2",
  warningLine: "#f1e2bf",
  warningStrong: "#9a5b12",
  amber: "#d49a3a",
  unread: "#eff6ff",
  shadow: "#000000",
};

/**
 * The same roles on neutral dark surfaces. Primary fills use onAccent;
 * accent labels remain readable without requiring white button text.
 */
export const dark: Palette = {
  background: "#171717",
  surface: "#202020",
  surfaceMuted: "#292929",
  border: "#383838",
  divider: "#303030",
  text: "#f4f4f5",
  textSoft: "#d4d4d8",
  muted: "#a1a1aa",
  faint: "#999999",
  accent: "#93c5fd",
  onAccent: "#17233a",
  accentPressed: "#bfdbfe",
  accentSoft: "#213047",
  dot: "#60a5fa",
  soft: "#292929",
  softBorder: "#383838",
  danger: "#fda29b",
  dangerSoft: "#402522",
  highBg: "#402522",
  highText: "#fda29b",
  mediumBg: "#213047",
  mediumText: "#93c5fd",
  lowBg: "#292929",
  lowText: "#d4d4d8",
  white: "#ffffff",
  checkBorder: "#737373",
  warning: "#e0b060",
  warningSoft: "#352a17",
  warningBorder: "#4d3c1d",
  warningLine: "#4d3c1d",
  warningStrong: "#e0b060",
  amber: "#d9a445",
  unread: "#213047",
  shadow: "#000000",
};
