import { useEffect, useState } from "react";
import { ChatgptDesktopStore } from "@orbyn/api-client";

// Page-only child windows share the preload but have no authority over connections.
const bridge =
  new URL(location.href).searchParams.get("window") === "page"
    ? undefined
    : window.orbynDesktop?.chatgpt;
export const chatgptStore = new ChatgptDesktopStore(bridge);

/** Settings and composer read the same guarded metadata state. */
export function useChatgptConnection() {
  const [value, setValue] = useState(() => chatgptStore.snapshot());
  useEffect(() => {
    const update = () => setValue(chatgptStore.snapshot());
    const unsubscribe = chatgptStore.subscribe(update);
    update();
    return unsubscribe;
  }, []);
  return value;
}
