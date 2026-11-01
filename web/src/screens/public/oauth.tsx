import { useMemo } from "react";
import { useAccount } from "../../app/account";
import { navigate, useSearch, useTitle } from "../../lib/router";
import { ErrorNotice, Loading } from "../../ui/kit";
import { PublicFrame } from "./PublicFrame";
import { Consent } from "./oauth/Consent";
import { Identity } from "./oauth/Identity";
import {
  inFrame,
  useCheck,
  useOwner,
  usePrivateDocument,
} from "./oauth/lifecycle";
import { requestFrom } from "./oauth/model";
import "./oauth/consent.css";
import { safeNext, withAuthNext } from "../../lib/auth-return";
export default function OAuth() {
  const { version } = useAccount(),
    search = useSearch();
  useTitle("Connect an app");
  return <RequestPage key={`${version}:${search}`} search={search} />;
}
function RequestPage({ search }: { search: string }) {
  usePrivateDocument();
  const parsed = useMemo(() => requestFrom(search), [search]),
    framed = inFrame(),
    owned = useOwner(search),
    read = useCheck(parsed.request, framed || !!parsed.error, owned),
    account = useAccount(),
    original = safeNext("/oauth/authorize" + search + location.hash);
  const signIn = (register = false) => {
    if (!owned()) return;
    const destination = withAuthNext(register ? "/signup" : "/login", original);
    if (account.token) account.signOut();
    navigate(destination);
  };
  const switchAccount = () => {
    if (!owned()) return;
    account.signOut();
    navigate(withAuthNext("/login", original));
  };
  return (
    <PublicFrame authNext={original}>
      <main className="connect-main">
        <header className="connect-heading">
          <p className="eyebrow">Connect an app</p>
          <h1>Choose what to share</h1>
          <p>
            Review the app and its access before returning. Opening this page
            never grants permission.
          </p>
        </header>
        {framed ? (
          <section className="connect-warning" role="alert">
            <h2>Open this in its own window</h2>
            <p>
              Connecting an app cannot happen inside another website. Return to
              the app and open its sign-in link in a full browser window.
            </p>
          </section>
        ) : parsed.error ? (
          <ErrorNotice message={parsed.error} />
        ) : (
          <>
            {read.loading && (
              <Loading label="Checking the app and this request" />
            )}
            {read.error && (
              <ErrorNotice
                message={read.error}
                onRetry={() => void read.reload()}
              />
            )}
            {read.data?.account &&
            account.user &&
            read.data.account.email !== account.user.email ? (
              <ErrorNotice
                message="The returned account did not match this session. Refresh the request before continuing."
                onRetry={() => void read.reload()}
              />
            ) : (
              read.data &&
              parsed.request && (
                <>
                  <Identity check={read.data} />
                  <Consent
                    request={parsed.request}
                    check={read.data}
                    readFresh={!read.loading && !read.error}
                    onChecked={read.commit}
                    onSignIn={signIn}
                    onSwitch={switchAccount}
                    owned={owned}
                  />
                </>
              )
            )}
          </>
        )}
      </main>
    </PublicFrame>
  );
}
