import { StyleSheet } from "react-native";
import { colors, fonts, radii, themed } from "./theme";

/** Typography and surfaces shared by several screens and components. */
export const shared = themed(() =>
  StyleSheet.create({
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 14,
      backgroundColor: colors.background,
    },
    eyebrow: {
      fontFamily: fonts.semibold,
      fontSize: 11,
      letterSpacing: 1.6,
      color: colors.muted,
      marginBottom: 8,
    },
    title: {
      fontFamily: fonts.display,
      fontSize: 24,
      lineHeight: 34,
      letterSpacing: -0.9,
      color: colors.text,
    },
    subtitle: {
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 21,
      color: colors.muted,
      marginTop: 6,
    },
    sectionTitle: {
      fontFamily: fonts.display,
      fontSize: 18,
      letterSpacing: -0.3,
      color: colors.text,
    },
    body: {
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 21,
      color: colors.textSoft,
    },
    small: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 17,
      color: colors.muted,
    },
    label: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.textSoft,
      marginBottom: 8,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 18,
      marginBottom: 16,
    },
    softCard: {
      backgroundColor: colors.soft,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: colors.softBorder,
      padding: 20,
      marginBottom: 16,
    },
    input: {
      fontFamily: fonts.regular,
      minHeight: 50,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: 15,
      paddingVertical: 13,
      borderRadius: radii.input,
      fontSize: 15,
      color: colors.text,
    },
    empty: { alignItems: "center", paddingVertical: 30, paddingHorizontal: 12 },
    emptyIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 14,
    },
  }),
);
