export { colors, statusTones, themed, tint, type Scheme } from "./live";
export type { Palette } from "./palette";
export {
  THEME_PREFERENCES,
  ThemeContext,
  useTheme,
  useThemeController,
  type Theme,
  type ThemePreference,
} from "./ThemeContext";

/**
 * Font families registered in app/App.tsx: DM Sans for UI, Manrope for display and the logo.
 * Weights sit one step lighter than their names, to match the web: on a phone's dense
 * screen a 600 label reads as bold, so emphasis is 500 and titles are 600.
 */
export const fonts = {
  regular: "DMSans_400Regular",
  medium: "DMSans_500Medium",
  semibold: "DMSans_500Medium",
  bold: "DMSans_600SemiBold",
  display: "Manrope_700Bold",
  brand: "Manrope_800ExtraBold",
} as const;

/**
 * The one type scale shared with the web (11/13/15/18/24/36): every
 * `fontSize` is one of these, and text still follows the phone's text size
 * setting on top. See `typeScale` in @orbyn/core.
 */
export { TYPE_SCALE, typeScale } from "@orbyn/core";

export const spacing = {
  /** Horizontal page padding, added on top of safe-area insets. */
  page: 16,
  /** Content column width cap for tablets and landscape. */
  maxContent: 720,
} as const;

/**
 * One height for anything a thumb presses. A screen of the same kind of
 * button was coming out at 40, 44 and 48 depending on which component drew
 * it; a row of controls that disagree by four points looks like a mistake,
 * because it is one. `compact` is the deliberate exception — chrome rather
 * than the point of the screen — and keeps its target through hitSlop.
 */
export const controls = {
  tap: 44,
  compact: 30,
} as const;

export const radii = {
  /** A checkbox's rounded square (22pt), as on task rows. */
  check: 7,
  input: 12,
  card: 20,
  pill: 999,
} as const;
