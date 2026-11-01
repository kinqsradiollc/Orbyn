import { useEffect, useRef, useState } from "react";
import { useAccount } from "./account";
import { getSessionVersion } from "../lib/session";
import { useNavigate } from "../lib/router";
import {
  RouteScopeProvider,
  useRouteScope,
  type RouteScope,
} from "../lib/route-scope";
import { FirstRun } from "../screens/today/FirstRun";
import {
  WhatsNew,
  markReleaseSeen,
  useWhatsNewOnce,
} from "../screens/today/WhatsNew";
import { reloadPrefs } from "../screens/today/prefs";
import { refreshPlanner } from "../screens/shared-task";
import "../screens/today/today.css";

const NEWS = "orbyn:request-whats-new";
/** A request is scoped to the account lifetime; it never accepts a URL or capability. */
export function requestWhatsNew() {
  window.dispatchEvent(new CustomEvent(NEWS, { detail: getSessionVersion() }));
}

/** Mounted once after authentication, verification and legal gates, independent of Today. */
export function GlobalOverlays() {
  const { user, version, refresh } = useAccount();
  const navigate = useNavigate(),
    scope = useRouteScope();
  const [completed, setCompleted] = useState(false);
  const firstRun = user?.first_run_done === false && !completed;
  const [auto, setAuto] = useWhatsNewOnce(!!user && !firstRun);
  const [news, setNews] = useState<{ scope: RouteScope | null } | null>(null);
  const [requested, setRequested] = useState(false);
  const pendingScope = useRef<RouteScope | null>(scope);
  useEffect(() => {
    const request = (event: Event) => {
      if (
        !(event instanceof CustomEvent) ||
        event.detail !== version ||
        version !== getSessionVersion()
      )
        return;
      pendingScope.current = scope;
      setRequested(true);
    };
    window.addEventListener(NEWS, request);
    return () => window.removeEventListener(NEWS, request);
  }, [scope, version]);
  useEffect(() => {
    if (!auto || requested) return;
    pendingScope.current = scope;
    setRequested(true);
    setAuto(false);
  }, [auto, requested, scope, setAuto]);
  useEffect(() => {
    if (!requested || firstRun || news) return;
    const attempt = () => {
      if (
        version !== getSessionVersion() ||
        document.querySelector("dialog[open]")
      )
        return;
      const opening = pendingScope.current;
      if (
        opening &&
        (!opening.getSnapshot().visible || !opening.getSnapshot().focused)
      ) {
        setRequested(false);
        return;
      }
      setNews({ scope: opening });
      setRequested(false);
    };
    attempt();
    const timer = setInterval(attempt, 250);
    return () => clearInterval(timer);
  }, [requested, firstRun, news, version]);
  return (
    <>
      {firstRun && user && (
        <FirstRun
          key={version}
          user={user}
          onDone={(made) => {
            if (version !== getSessionVersion()) return;
            setCompleted(true);
            markReleaseSeen();
            void reloadPrefs();
            void refresh();
            void refreshPlanner();
            if (made?.brief_id) navigate(`/app/doc/${made.brief_id}`);
          }}
        />
      )}
      {news && (
        <RouteScopeProvider value={news.scope}>
          <WhatsNew onClose={() => setNews(null)} />
        </RouteScopeProvider>
      )}
    </>
  );
}
