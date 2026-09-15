import { colors as base } from "@orbyn/core";

/**
 * Every colour token the app uses: the shared ones from @orbyn/core plus a few
 * mobile-only ones for colours that used to be written inline.
 */
export type Palette = { [K in keyof typeof base]: string } & {
  /** Outline of a checkbox that isn't ticked yet. */
  checkBorder: string;
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
  checkBorder: "#cfd7ce",
  warning: "#a3742b",
  warningSoft: "#fbf3e2",
  warningBorder: "#f0e2c2",
  warningLine: "#f1e2bf",
  warningStrong: "#9a5b12",
  amber: "#d49a3a",
  unread: "#f6f9f4",
  shadow: "#1d2b23",
};

/**
 * The same roles on a deep green-grey ground. The accent stays dark enough
 * for white text on buttons and light enough to read on the page.
 */
export const dark: Palette = {
  background: "#111513",
  surface: "#191e1b",
  surfaceMuted: "#212723",
  border: "#2b332e",
  divider: "#232a26",
  text: "#e4ebe6",
  textSoft: "#b6c1ba",
  muted: "#8a968f",
  faint: "#5f6a64",
  accent: "#3f8f66",
  accentPressed: "#357a57",
  accentSoft: "#1d3327",
  dot: "#6f8f63",
  soft: "#18261e",
  softBorder: "#26382d",
  danger: "#e0775a",
  dangerSoft: "#3a221c",
  highBg: "#3a281f",
  highText: "#e3a583",
  mediumBg: "#1e2a22",
  mediumText: "#93b395",
  lowBg: "#232823",
  lowText: "#9ba68f",
  white: "#ffffff",
  checkBorder: "#4a544e",
  warning: "#e0b060",
  warningSoft: "#352a17",
  warningBorder: "#4d3c1d",
  warningLine: "#4d3c1d",
  warningStrong: "#e0b060",
  amber: "#d9a445",
  unread: "#18221c",
  shadow: "#000000",
};
