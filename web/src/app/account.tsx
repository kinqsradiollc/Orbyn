import { HttpError, type User } from "@orbyn/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  client,
  getToken,
  getSessionVersion,
  onToken,
  setToken,
} from "../lib/session";
import { messageOf } from "../lib/resource";

type Account = {
  token: string;
  version: number;
  user: User | null;
  loading: boolean;
  error: string;
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
  const [session, setCurrent] = useState(() => ({
    token: getToken(),
    version: getSessionVersion(),
  }));
  const { token, version } = session;
  const [snapshot, setSnapshot] = useState<{
    token: string;
    version: number;
    user: User | null;
  }>({
    token: "",
    version: -1,
    user: null,
  });
  const [loading, setLoading] = useState(!!token);
  const [error, setError] = useState("");
  const request = useRef(0);
  const user =
    snapshot.token === token && snapshot.version === version
      ? snapshot.user
      : null;

  useEffect(() => {
    const stop = onToken(() => {
      request.current++;
      setError("");
      setCurrent({ token: getToken(), version: getSessionVersion() });
    });
    return () => {
      stop();
      request.current++;
    };
  }, []);

  const refresh = useCallback(async () => {
    const account = getToken();
    const openingVersion = getSessionVersion();
    const id = ++request.current;
    if (!account) {
      setSnapshot({ token: "", version: openingVersion, user: null });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await client.me({ fresh: true });
      if (id !== request.current || account !== getToken()) return;
      setSnapshot({ token: account, version: openingVersion, user: next });
      setError("");
      // Agendas, digests and working hours follow the device until a zone is picked.
      void client
        .reportTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
        .catch(() => undefined);
    } catch (failure) {
      if (id !== request.current || account !== getToken()) return;
      if (failure instanceof HttpError && failure.statusCode === 401)
        setToken("");
      else {
        if (failure instanceof HttpError && failure.statusCode === 403)
          setSnapshot({ token: account, version: openingVersion, user: null });
        setError(messageOf(failure, "Couldn't load your account."));
      }
    } finally {
      if (id === request.current && account === getToken()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [token, version, refresh]);

  const signOut = useCallback(() => {
    void client.logout().catch(() => undefined);
    setToken("");
  }, []);

  const value = useMemo(
    () => ({ token, version, user, loading, error, refresh, signOut }),
    [token, version, user, loading, error, refresh, signOut],
  );
  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}
