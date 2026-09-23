import React, { useEffect } from "react";
import { Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import {
  useFonts,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from "@expo-google-fonts/manrope";
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from "@expo-google-fonts/dm-sans";
import { RootScreen } from "./RootScreen";
import { colors, ThemeContext, useThemeController } from "../theme";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Edge-to-edge root: nothing here pads for the notch or home indicator. Each
 * screen applies safe-area insets itself so backgrounds reach every edge.
 * App owns the theme, so a theme change re-renders everything below it.
 */
export default function App() {
  const theme = useThemeController();
  const [fontsLoaded, fontError] = useFonts({
    Manrope_700Bold,
    Manrope_800ExtraBold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });
  useWebFocusRing(theme.scheme);
  return (
    <ThemeContext.Provider value={theme}>
      <SafeAreaProvider>
        <StatusBar style={theme.scheme === "dark" ? "light" : "dark"} />
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          {(fontsLoaded || fontError) && <RootScreen />}
        </View>
      </SafeAreaProvider>
    </ThemeContext.Provider>
  );
}

/**
 * In a browser, focus rings otherwise come in the system's accent colour
 * (orange on some Macs), which the app has no say in. Draw them in the
 * app's accent, and let text fields show focus through their own border.
 * Native builds have no focus ring, so this is web only.
 */
function useWebFocusRing(scheme: string) {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const style = document.createElement("style");
    style.textContent = `
      :focus { outline: none; }
      :focus-visible { outline: 2px solid ${colors.accent}; outline-offset: 2px; }
      input:focus-visible, textarea:focus-visible { outline: none; border-color: ${colors.accent} !important; }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, [scheme]);
}
