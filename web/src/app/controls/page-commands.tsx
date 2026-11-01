import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useRouteScope, type RouteScope } from "../../lib/route-scope";
import { getSessionVersion, onToken } from "../../lib/session";

export type PageCommand = {
  run(): void | Promise<unknown>;
  available?: boolean;
};
export type PageCommands = Readonly<Record<string, PageCommand>>;
type Entry = {
  scope: RouteScope | null;
  generation: number;
  fallback: boolean;
  token: object;
  commands: PageCommands;
};
const entries = new Map<RouteScope | null, Map<object, Entry>>(),
  listeners = new Set<() => void>();
let revision = 0;
const publish = () => {
  revision++;
  listeners.forEach((listener) => listener());
};
onToken(() => {
  entries.clear();
  publish();
});
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
/** Registers existing domain callbacks; it never synthesizes a page mutation from a URL. */
export function usePageCommands(
  commands: PageCommands,
  options?: { fallback?: boolean },
) {
  const opening = useRouteScope(),
    scope = opening?.originScope ?? opening,
    latest = useRef(commands);
  latest.current = commands;
  useLayoutEffect(() => {
    const generation = getSessionVersion(),
      token = {};
    const entry: Entry = {
      scope,
      generation,
      fallback: !!options?.fallback,
      token,
      get commands() {
        return latest.current;
      },
    };
    const owners = entries.get(scope) ?? new Map<object, Entry>();
    owners.set(token, entry);
    entries.set(scope, owners);
    publish();
    return () => {
      const owners = entries.get(scope);
      if (owners?.delete(token)) {
        if (!owners.size) entries.delete(scope);
        publish();
      }
    };
  }, [scope, options?.fallback]);
  useLayoutEffect(publish, [commands]);
}
export function useRegisteredPageCommands(scope: RouteScope | null) {
  useSyncExternalStore(subscribe, () => revision);
  const commandScope = scope?.commandScope ?? scope;
  const base = commandScope?.originScope ?? commandScope;
  const owners = entries.get(base);
  const actions: Record<string, PageCommand> = {};
  const ranked = [...(owners?.values() ?? [])].sort(
    (a, b) => Number(b.fallback) - Number(a.fallback),
  );
  for (const entry of ranked) {
    if (entry.generation !== getSessionVersion()) continue;
    for (const [id, action] of Object.entries(entry.commands))
      if (action.available !== false)
        actions[id] = {
          run: () => {
            const live = entries.get(base)?.get(entry.token);
            if (live !== entry || live.generation !== getSessionVersion())
              return;
            const state = commandScope?.getSnapshot();
            if (state && (!state.visible || !state.focused)) return;
            const current = live.commands[id];
            if (current?.available !== false) return current?.run();
          },
        };
  }
  return actions;
}
export const useRouteCommands = usePageCommands;
export const useRegisteredRouteCommands = useRegisteredPageCommands;
