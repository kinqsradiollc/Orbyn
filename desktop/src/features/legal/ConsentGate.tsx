import { useState } from "react";
import { ArrowRight, FileText, ShieldCheck } from "lucide-react";
import {
  MINIMUM_AGE,
  type LegalDoc,
  type LegalDocument,
  type LegalSummary,
  type User,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { AuthShell } from "../auth/AccountFlows";
import { LegalText } from "./LegalText";
import "./legal.css";
import { errorText } from "../../lib/errors";

/**
 * Held before the app when you haven't accepted the current Terms: the first
 * time after this was added, for accounts made in an app that didn't ask, and
 * whenever a new version is published. It also shows the usage-analytics
 * choice, so it's made knowingly rather than buried in Settings.
 */
export function ConsentGate({
  user,
  legal,
  onAccepted,
  onLogout,
}: {
  user: User;
  legal: LegalSummary;
  onAccepted: () => void;
  onLogout: () => void;
}) {
  const updated = !!user.terms_version;
  const [agreed, setAgreed] = useState(false);
  const [analytics, setAnalytics] = useState(!user.analytics_opt_out);
  const [reading, setReading] = useState<LegalDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const read = async (doc: LegalDoc) => {
    if (reading?.doc === doc) return setReading(null);
    try {
      setReading(await client.legalDocument(doc));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const accept = async () => {
    setBusy(true);
    setError("");
    try {
      await client.acceptTerms(legal.terms_version);
      if (analytics === !!user.analytics_opt_out)
        await client.setPrivacy({ analytics_opt_out: !analytics });
      onAccepted();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <span className="eyebrow">
        {updated ? "WE'VE UPDATED OUR TERMS" : "BEFORE YOU CONTINUE"}
      </span>
      <h2>
        <ShieldCheck size={22} style={{ verticalAlign: "-3px" }} /> Your privacy
        and our terms
      </h2>
      <p>
        {updated
          ? "The Terms of Service or Privacy Policy changed since you last agreed. Take a look, then carry on."
          : "Please review how Orbyn works with your data and agree to the terms to keep using it."}
      </p>
      <div className="consent-docs">
        {(["terms", "privacy"] as const).map((doc) => (
          <button
            key={doc}
            type="button"
            className="secondary"
            aria-expanded={reading?.doc === doc}
            onClick={() => void read(doc)}
          >
            <FileText size={15} />
            {doc === "terms" ? "Terms of Service" : "Privacy Policy"}
          </button>
        ))}
      </div>
      {reading && (
        <div className="consent-reader" tabIndex={0} aria-label={reading.title}>
          <LegalText body={reading.body} />
        </div>
      )}
      <label className="switch-line consent-analytics">
        <input
          type="checkbox"
          role="switch"
          className="ai-switch"
          checked={analytics}
          onChange={(e) => setAnalytics(e.target.checked)}
        />
        <span>
          Usage analytics
          <small>
            Count which features I use — never what I write — to help improve
            Orbyn. You can change this any time in Settings → Privacy.
          </small>
        </span>
      </label>
      <label className="check-line consent-agree">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
        />
        <span>
          I&apos;m {MINIMUM_AGE} or older and I agree to the Terms of Service
          and Privacy Policy (version {legal.terms_version}).
        </span>
      </label>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <button
        className="primary wide"
        disabled={!agreed || busy}
        onClick={() => void accept()}
      >
        {busy ? "One moment…" : "Agree and continue"}
        <ArrowRight size={17} />
      </button>
      <button className="text-button" onClick={onLogout}>
        Sign out
      </button>
    </AuthShell>
  );
}
