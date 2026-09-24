import { useEffect, useRef } from "react";
import { Linking } from "react-native";
import { parseAppLink, type AppLink } from "@orbyn/core";
import {
  onQuickAction,
  takeInitialQuickAction,
} from "../../modules/orbyn-quick-actions";

/**
 * Links into the app, one listener for all of them: orbyn:// links (from
 * Shortcuts, Android's app shortcuts and the share sheet), the app icon's
 * quick actions on iOS, and the web app's own links. Each is read into one
 * thing to open (parseAppLink). A link that arrives signed out waits, and
 * opens once the person has signed in.
 */
export function useAppLinks(
  signedIn: boolean,
  onLink: (link: AppLink) => void,
): void {
  const handler = useRef(onLink);
  handler.current = onLink;
  const ready = useRef(signedIn);
  ready.current = signedIn;
  const waiting = useRef<AppLink[]>([]);

  useEffect(() => {
    const take = (url: string | null) => {
      const link = parseAppLink(url);
      if (!link) return;
      if (ready.current) handler.current(link);
      else waiting.current.push(link);
    };
    let alive = true;
    // The link or quick action that opened the app, once.
    void Linking.getInitialURL()
      .then((url) => alive && take(url))
      .catch(() => {});
    take(takeInitialQuickAction());
    const sub = Linking.addEventListener("url", (e) => take(e.url));
    const stop = onQuickAction(take);
    return () => {
      alive = false;
      sub.remove();
      stop();
    };
  }, []);

  useEffect(() => {
    if (!signedIn || !waiting.current.length) return;
    const links = waiting.current;
    waiting.current = [];
    for (const link of links) handler.current(link);
  }, [signedIn]);
}
