import { useEffect, useRef, useState } from "react";
import { ChatgptRemoteStore } from "@orbyn/api-client";
import type { ChatgptCatalogSelection } from "@orbyn/core";
import { client } from "../lib/api";
import { session } from "../lib/session";
const readToken = () => session.get();

/** Both settings surfaces use the same account-fenced catalog/default controller. */
export function useChatgptRemote(userId: string) {
  const token = readToken();
  const ref = useRef<{
    store: ChatgptRemoteStore;
    userId: string;
    token: string;
  } | null>(null);
  const [, render] = useState(0);
  useEffect(() => {
    const store = new ChatgptRemoteStore({
      api: client,
      userId,
      getToken: readToken,
    });
    ref.current = { store, userId, token };
    const unsubscribe = store.subscribe(() => render((n) => n + 1));
    void store.refresh();
    return () => {
      unsubscribe();
      store.close();
      if (ref.current?.store === store) ref.current = null;
    };
  }, [userId, token]);
  const current = () =>
    ref.current?.userId === userId &&
    ref.current?.token === token &&
    token === readToken()
      ? ref.current.store
      : null;
  return {
    state: current()?.snapshot() ?? {
      status: "idle" as const,
      devices: [],
      selection: null,
      catalog: null,
      saving: false,
      error: null,
    },
    refresh: () => void current()?.refresh(),
    select: (selection: ChatgptCatalogSelection) =>
      void current()?.select(selection),
    save: (model: string | null) => void current()?.save(model),
  };
}
