import { Alert } from "./alert";

/**
 * Ask before something that cannot be undone.
 *
 * Expo web uses the app-owned modal; native retains its platform dialog.
 */
export function confirmAction(
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void,
  destructive = true,
): void {
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    {
      text: confirmLabel,
      style: destructive ? "destructive" : "default",
      onPress: onConfirm,
    },
  ]);
}
