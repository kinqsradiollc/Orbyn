/**
 * Design tokens shared with the web/desktop app (desktop/src/styles/global.css)
 * so both clients look like one product.
 */
export const colors = {
  background: "#f7f8fa",
  surface: "#ffffff",
  surfaceMuted: "#f3f5f2",
  border: "#e8ece9",
  divider: "#f0f2ef",
  text: "#27382f",
  textSoft: "#526158",
  muted: "#849089",
  faint: "#aab3ad",
  accent: "#376c51",
  accentPressed: "#2c5842",
  accentSoft: "#e7f0ea",
  dot: "#9ab68c",
  soft: "#eef3ec",
  softBorder: "#dde7da",
  danger: "#b0573b",
  dangerSoft: "#fbeee8",
  highBg: "#fbefea",
  highText: "#c28c70",
  mediumBg: "#eef3ec",
  mediumText: "#6d8a6f",
  lowBg: "#f2f4f0",
  lowText: "#96a18b",
  white: "#ffffff",
} as const;

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
