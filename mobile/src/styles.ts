import { StyleSheet } from "react-native";
import { colors, fonts, inputFontSize, radii, themed } from "./theme";

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
      color: colors.muted,
      marginBottom: 8,
    },
    title: {
      fontFamily: fonts.bold,
      fontSize: 18,
      lineHeight: 26,
      letterSpacing: -0.2,
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
      fontFamily: fonts.semibold,
      fontSize: 15,
      lineHeight: 21,
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
      padding: 14,
      marginBottom: 12,
    },
    softCard: {
      backgroundColor: colors.soft,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: colors.softBorder,
      padding: 14,
      marginBottom: 12,
    },
    input: {
      minWidth: 0,
      fontFamily: fonts.regular,
      minHeight: 44,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: radii.input,
      fontSize: inputFontSize,
      color: colors.text,
    },
    empty: { alignItems: "center", paddingVertical: 30, paddingHorizontal: 12 },
    emptyIcon: {
      width: 40,
      height: 40,
      borderRadius: radii.pill,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 14,
    },
  }),
);
