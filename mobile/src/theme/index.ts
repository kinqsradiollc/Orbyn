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

/** Font families registered in app/App.tsx: DM Sans for UI, Manrope for display and the logo. */
export const fonts = {
  regular: "DMSans_400Regular",
  medium: "DMSans_500Medium",
  semibold: "DMSans_600SemiBold",
  bold: "DMSans_700Bold",
  display: "Manrope_700Bold",
  brand: "Manrope_800ExtraBold",
} as const;

export const spacing = {
  /** Horizontal page padding, added on top of safe-area insets. */
  page: 20,
  /** Content column width cap for tablets and landscape. */
  maxContent: 720,
} as const;

export const radii = {
  input: 12,
  card: 16,
  pill: 999,
} as const;
