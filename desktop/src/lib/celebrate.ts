/**
 * A small moment when a task is marked done anywhere in the app. Call
 * `celebrate()` after the change is saved; <Celebration> in the app shell
 * listens and shows it (focus mode has its own, larger one).
 */
const EVENT = "orbyn:celebrate";

export const celebrate = () => window.dispatchEvent(new Event(EVENT));

export function onCelebrate(listener: () => void) {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
