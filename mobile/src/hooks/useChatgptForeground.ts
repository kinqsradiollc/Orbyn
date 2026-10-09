import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { chatgptForeground } from "../lib/chatgpt-foreground";
import { cancelNativeChatgptSignIn } from "../lib/chatgpt-local-sign-in";
/** Root lifetime owns activation; browser sign-in itself may temporarily background the app. */
export function useChatgptForeground(userId: string, token: string) {
  useEffect(() => {
    if (Platform.OS === "web") return;
    const update = () =>
      chatgptForeground.update({
        userId,
        token,
        foreground: AppState.currentState === "active",
      });
    update();
    const subscription = AppState.addEventListener("change", update);
    return () => {
      subscription.remove();
      chatgptForeground.close();
      cancelNativeChatgptSignIn();
    };
  }, [userId, token]);
}
