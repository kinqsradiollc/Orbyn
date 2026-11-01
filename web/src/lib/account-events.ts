import type { LiveNews } from "@orbyn/api-client";
import { client, getSessionVersion, getToken, onToken } from "./session";
type Listener = {
  generation: number;
  run: (news: LiveNews) => void;
  reconnected?: () => void;
};
const listeners = new Set<Listener>();
let stop: (() => void) | null = null;
let generation = getSessionVersion();
function start() {
  if (
    stop ||
    !getToken() ||
    ![...listeners].some((one) => one.generation === getSessionVersion())
  )
    return;
  const opening = getSessionVersion();
  generation = opening;
  const current = () =>
    generation === opening && getSessionVersion() === opening && !!getToken();
  stop = client.watchEvents(
    (news) => {
      if (!current()) return;
      if (news.kind === "changed") client.noteExternalMutation();
      for (const one of listeners)
        if (one.generation === opening) one.run(news);
    },
    () => {
      if (!current()) return;
      client.noteExternalMutation();
      for (const one of listeners)
        if (one.generation === opening) {
          if (one.reconnected) one.reconnected();
          else one.run({ kind: "changed" });
        }
    },
  );
}
onToken(() => {
  stop?.();
  stop = null;
  generation = getSessionVersion();
  start();
});
/** Sole account SSE owner. Domain subscribers retain their own coalescing/read contracts. */
export function watchAccount(
  run: (news: LiveNews) => void,
  reconnected?: () => void,
) {
  const listener = { generation: getSessionVersion(), run, reconnected };
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    if (![...listeners].some((one) => one.generation === getSessionVersion())) {
      stop?.();
      stop = null;
    }
  };
}
