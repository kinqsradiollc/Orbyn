import {
  Alert as NativeAlert,
  Platform,
  type AlertButton,
  type AlertOptions,
} from "react-native";

export type AlertRequest = {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
  options?: AlertOptions;
};

let serial = 0;
let queue: AlertRequest[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
export const currentAlert = () => queue[0] ?? null;
/** Account changes discard stale callbacks without applying their actions. */
export function clearAlerts() {
  queue = [];
  emit();
}
export const subscribeAlerts = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Only the currently displayed request can settle; repeated clicks are inert. */
export function settleAlert(id: number, button?: AlertButton) {
  const request = queue[0];
  if (!request || request.id !== id) return;
  queue = queue.slice(1);
  emit();
  if (button) button.onPress?.();
  else {
    request.buttons.find((entry) => entry.style === "cancel")?.onPress?.();
    request.options?.onDismiss?.();
  }
}

/** Native keeps its platform dialog; Expo web uses Orbyn's modal host. */
export const Alert = {
  alert(
    title: string,
    message?: string,
    buttons?: AlertButton[],
    options?: AlertOptions,
  ) {
    if (Platform.OS !== "web") {
      NativeAlert.alert(title, message, buttons, options);
      return;
    }
    queue = [
      ...queue,
      {
        id: ++serial,
        title,
        message,
        buttons: buttons?.length ? buttons : [{ text: "OK" }],
        options,
      },
    ];
    emit();
  },
};
