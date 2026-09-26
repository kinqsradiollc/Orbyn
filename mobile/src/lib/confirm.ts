import { Alert, Platform } from "react-native";

/**
 * Ask before something that cannot be undone.
 *
 * `Alert.alert` does nothing at all in the web build, so a question asked
 * that way there is never asked and never answered — the action simply does
 * not happen. On the web the browser asks instead.
 */
export function confirmAction(
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void,
  destructive = true,
): void {
  if (Platform.OS === "web") {
    if (globalThis.confirm?.(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    {
      text: confirmLabel,
      style: destructive ? "destructive" : "default",
      onPress: onConfirm,
    },
  ]);
}
