import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { client } from "./api";
import { clearPushToken, getPushToken, savePushToken } from "./session";

/**
 * Ask for permission, fetch the Expo push token and register this device with
 * the server. Throws a user-facing Error when a prerequisite is missing.
 */
export async function enablePush() {
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("default", {
      name: "Planner reminders",
      importance: Notifications.AndroidImportance.HIGH,
    });
  const permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted")
    throw new Error(
      "Allow notifications in your device settings to receive reminders.",
    );
  const projectId =
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
    Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId)
    throw new Error(
      "Configure the Expo EAS project ID before enabling push notifications.",
    );
  const push = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await client.registerDevice(push);
  await savePushToken(push);
}

/** Unregister this device (when one is registered) and forget the push token. */
export async function disablePush() {
  const push = await getPushToken();
  if (push) await client.removeDevice(push);
  await clearPushToken();
}
