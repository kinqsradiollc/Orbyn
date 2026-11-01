import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { OAuthCheck, OAuthRequest } from "@orbyn/core";
import { client, getSessionVersion } from "../../../lib/session";
import { messageOf } from "../../../lib/resource";
import { validCheck } from "./model";
export function inFrame() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}
export function useOwner(search: string) {
  const generation = useRef(getSessionVersion()).current,
    mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(
    () =>
      mounted.current &&
      generation === getSessionVersion() &&
      location.pathname === "/oauth/authorize" &&
      location.search === search,
    [generation, search],
  );
}
export function useCheck(
  request: OAuthRequest | undefined,
  blocked: boolean,
  owned: () => boolean,
) {
  const [data, setData] = useState<OAuthCheck>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    requestRef = useRef(request),
    seq = useRef(0);
  requestRef.current = request;
  const commit = useCallback(
    (value: OAuthCheck) => {
      if (owned()) {
        seq.current++;
        setData(value);
        setLoading(false);
        setError("");
      }
    },
    [owned],
  );
  const reload = useCallback(async () => {
    if (!owned() || !requestRef.current || blocked) return undefined;
    const captured = requestRef.current,
      id = ++seq.current;
    setLoading(true);
    setError("");
    try {
      const check = await client.oauthCheck(captured);
      if (!validCheck(check, captured))
        throw Error(
          "The server returned connection details for a different request.",
        );
      if (owned() && id === seq.current) {
        setData(check);
        setError("");
        return check;
      }
      return undefined;
    } catch (e) {
      if (owned() && id === seq.current)
        setError(messageOf(e, "Could not check this authorization request."));
      return undefined;
    } finally {
      if (owned() && id === seq.current) setLoading(false);
    }
  }, [blocked, owned]);
  useEffect(() => {
    if (!blocked && request) void reload();
    else setLoading(false);
    return () => {
      seq.current++;
    };
  }, [blocked, request, reload]);
  return { data, loading, error, reload, commit };
}
export function usePrivateDocument() {
  useLayoutEffect(() => {
    const restore: (() => void)[] = [];
    for (const [name, value] of [
      ["robots", "noindex, nofollow"],
      ["referrer", "no-referrer"],
    ] as const) {
      const existing = document.querySelector<HTMLMetaElement>(
          `meta[name="${name}"]`,
        ),
        node = existing ?? document.createElement("meta"),
        old = node.content;
      node.name = name;
      node.content = value;
      if (!existing) document.head.append(node);
      restore.push(() => {
        if (node.content !== value) return;
        if (existing) node.content = old;
        else node.remove();
      });
    }
    return () => restore.reverse().forEach((run) => run());
  }, []);
}
export function useReauthClock(until: string | null) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const end = Date.parse(until ?? "");
    if (!Number.isFinite(end) || end <= Date.now()) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(2147483647, end - Date.now() + 25),
    );
    return () => clearTimeout(timer);
  }, [until, now]);
  return (
    Number.isFinite(Date.parse(until ?? "")) &&
    Date.parse(until ?? "") > Math.max(now, Date.now())
  );
}
