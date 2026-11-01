import type { LegalSummary } from "@orbyn/core";
import { Suspense, useEffect, useState } from "react";
import { client } from "../lib/session";
import { messageOf } from "../lib/resource";
import { ConsentGate } from "./ConsentGate";
import { VerifyGate } from "./VerifyGate";
import { match, navigate, usePath, useSearch } from "../lib/router";
import { Button, Empty, ErrorNotice, Loading } from "../ui/kit";
import { AccountProvider, useAccount } from "./account";
import { APP_ROUTES, PUBLIC_ROUTES, type Route } from "./routes";
import { Shell } from "./Shell";
import {
  currentAuthReturn,
  nextFromSearch,
  withAuthNext,
} from "../lib/auth-return";

function find(routes: Route[], path: string) {
  for (const route of routes) {
    const params = match(route.path, path);
    if (params) return { route, params };
  }
  return null;
}

function Routed() {
  const path = usePath(),
    search = useSearch();
  const { token, version, user, error, refresh, signOut } = useAccount();
  const inApp = path === "/app" || path.startsWith("/app/");

  const requiresAccount = inApp || (path === "/oauth/authorize" && !!token);

  useEffect(() => {
    if (inApp && !token) {
      navigate(withAuthNext("/login", currentAuthReturn()), true);
    }
    if (token && (path === "/login" || path === "/signup"))
      navigate(nextFromSearch(search), true);
  }, [inApp, path, search, token]);

  const [legalState, setLegalState] = useState<{
    token: string;
    version: number;
    data: LegalSummary | null;
    error: string;
  }>({ token: "", version: -1, data: null, error: "" });
  const [legalAttempt, setLegalAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    if (token) {
      setLegalState({ token, version, data: null, error: "" });
      void client.legal().then(
        (data) => live && setLegalState({ token, version, data, error: "" }),
        (failure) =>
          live &&
          setLegalState({
            token,
            version,
            data: null,
            error: messageOf(failure, "Couldn't load the terms."),
          }),
      );
    }
    return () => {
      live = false;
    };
  }, [token, version, legalAttempt]);
  const sameLegalSession =
    legalState.token === token && legalState.version === version;
  const legal = sameLegalSession ? legalState.data : null;

  if (requiresAccount) {
    if (!token || !user) {
      if (error)
        return (
          <main className="page">
            <ErrorNotice message={error} onRetry={() => void refresh()} />
            <Button onClick={signOut}>Sign out</Button>
          </main>
        );
      return <Loading label="Opening Orbyn" />;
    }
    if (!user.email_verified) return <VerifyGate key={version} />;
    if (!legal)
      return sameLegalSession && legalState.error ? (
        <main className="page">
          <ErrorNotice
            message={legalState.error}
            onRetry={() => setLegalAttempt((n) => n + 1)}
          />
          <Button onClick={signOut}>Sign out</Button>
        </main>
      ) : (
        <Loading label="Loading terms" />
      );
    if (user.terms_version !== legal.terms_version)
      return <ConsentGate key={version} legal={legal} />;
    if (inApp) {
      const hit = find(APP_ROUTES, path);
      return (
        <Shell key={version}>
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
