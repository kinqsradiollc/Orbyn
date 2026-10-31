import { MINIMUM_AGE, type LegalSummary } from "@orbyn/core";
import { useState } from "react";
import { messageOf } from "../lib/resource";
import { client } from "../lib/session";
import { Button } from "../ui/kit";
import { useAccount } from "./account";
import "../screens/public/public.css";

/** Held before the app until the current Terms are accepted. */
export function ConsentGate({ legal }: { legal: LegalSummary }) {
  const { user, refresh, signOut } = useAccount();
  const updated = !!user?.terms_version;
  const [agreed, setAgreed] = useState(false);
  const [analytics, setAnalytics] = useState(!user?.analytics_opt_out);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function accept() {
    setBusy(true);
    setError("");
    try {
      await client.acceptTerms(legal.terms_version);
      if (analytics === !!user?.analytics_opt_out)
        await client.setPrivacy({ analytics_opt_out: !analytics });
      await refresh();
    } catch (failure) {
      setError(messageOf(failure, "Couldn't save that. Try again."));
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <div className="auth-form">
        <h1>{updated ? "Our terms have changed" : "Review the terms"}</h1>
        <p className="muted">
          Read the <a href="/terms">Terms of Service</a> and{" "}
          <a href="/privacy">Privacy Policy</a> to continue.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={analytics}
            onChange={(e) => setAnalytics(e.target.checked)}
          />
          <span>Share usage analytics, never your content</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>
            I'm {MINIMUM_AGE} or older and agree (version {legal.terms_version})
          </span>
        </label>
        {error && (
          <p role="alert" className="small auth-error">
            {error}
          </p>
        )}
        <Button
          variant="primary"
          busy={busy}
          disabled={!agreed}
          onClick={() => void accept()}
        >
          Agree and continue
        </Button>
        <Button variant="ghost" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </main>
  );
}
