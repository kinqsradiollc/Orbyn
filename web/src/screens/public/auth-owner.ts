import { useEffect, useRef } from "react";
import { getSessionVersion } from "../../lib/session";

/** Only the still-mounted route/account that started auth may adopt its receipt. */
export function useAuthOwner() {
  const opening = useRef({
    version: getSessionVersion(),
    route: location.pathname + location.search,
  }).current;
  const mounted = useRef(true);
  const locked = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () =>
    mounted.current &&
    opening.version === getSessionVersion() &&
    opening.route === location.pathname + location.search;
  return {
    current,
    acquire: () => {
      if (locked.current || !current()) return false;
      locked.current = true;
      return true;
    },
    release: () => {
      locked.current = false;
    },
  };
}
