import type { User } from "@orbyn/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { client, getToken, onToken, setToken } from "../lib/session";

type Account = {
  token: string;
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => void;
};

const AccountContext = createContext<Account | null>(null);

export function useAccount() {
  const account = useContext(AccountContext);
  if (!account) throw new Error("useAccount needs AccountProvider");
  return account;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [token, setCurrent] = useState(getToken);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!token);

  useEffect(() => onToken(() => setCurrent(getToken())), []);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setUser(await client.me());
      // Agendas, digests and working hours follow the device until a zone is picked.
      void client
        .reportTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
        .catch(() => undefined);
    } catch (error) {
      if ((error as { status?: number }).status === 401) setToken("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [token, refresh]);

  const signOut = useCallback(() => {
    void client.logout().catch(() => undefined);
    setToken("");
  }, []);

  const value = useMemo(
    () => ({ token, user, loading, refresh, signOut }),
    [token, user, loading, refresh, signOut],
  );
  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}
