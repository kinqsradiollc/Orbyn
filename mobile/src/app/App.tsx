import React from "react";
import { View } from "react-native";
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
