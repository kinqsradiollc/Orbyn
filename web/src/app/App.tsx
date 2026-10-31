import type { LegalSummary } from "@orbyn/core";
import { Suspense, useEffect, useState } from "react";
import { client } from "../lib/session";
import { ConsentGate } from "./ConsentGate";
import { VerifyGate } from "./VerifyGate";
import { match, navigate, usePath } from "../lib/router";
import { Empty, Loading } from "../ui/kit";
import { AccountProvider, useAccount } from "./account";
import { APP_ROUTES, PUBLIC_ROUTES, type Route } from "./routes";
import { Shell } from "./Shell";

function find(routes: Route[], path: string) {
  for (const route of routes) {
    const params = match(route.path, path);
    if (params) return { route, params };
  }
  return null;
}

function Routed() {
  const path = usePath();
  const { token, user, loading } = useAccount();
  const inApp = path === "/app" || path.startsWith("/app/");

  useEffect(() => {
    if (inApp && !token) {
      const next = encodeURIComponent(path + location.search + location.hash);
      navigate(`/login?next=${next}`, true);
    }
    if (token && (path === "/login" || path === "/signup"))
      navigate("/app", true);
  }, [inApp, path, token]);

  const [legal, setLegal] = useState<LegalSummary | null>(null);
  useEffect(() => {
    if (token) void client.legal().then(setLegal, () => undefined);
  }, [token]);

  if (inApp) {
    if (!token || loading || !user) return <Loading label="Opening Orbyn" />;
    if (!user.email_verified) return <VerifyGate />;
    if (legal && user.terms_version !== legal.terms_version)
      return <ConsentGate legal={legal} />;
    const hit = find(APP_ROUTES, path);
    return (
      <Shell>
        <Suspense fallback={<Loading />}>
          {hit ? (
            <hit.route.screen key={hit.route.path} params={hit.params} />
          ) : (
            <Empty title="This page doesn't exist" />
          )}
        </Suspense>
      </Shell>
    );
  }
  const hit = find(PUBLIC_ROUTES, path);
  return (
    <Suspense fallback={<Loading />}>
      {hit ? (
        <hit.route.screen params={hit.params} />
      ) : (
        <Empty title="This page doesn't exist">
          <a href="/">Go to Orbyn</a>
        </Empty>
      )}
    </Suspense>
  );
}

export function App() {
  return (
    <AccountProvider>
      <Routed />
    </AccountProvider>
  );
}
