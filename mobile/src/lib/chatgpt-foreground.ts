import { createChatgptForegroundRuntime } from "@orbyn/api-client";
import {
  createNativeChatgptExecutor,
  hasNativeChatgptRegistration,
} from "./chatgpt-local-sign-in";
/** One app-owned executor survives Settings dismissal, but never app suspension. */
export const chatgptForeground = createChatgptForegroundRuntime({
  available: hasNativeChatgptRegistration,
  create: createNativeChatgptExecutor,
});
