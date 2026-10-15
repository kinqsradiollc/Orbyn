import { useEffect, useRef, useState } from "react";
import { ArrowRight, FileText, ShieldCheck } from "lucide-react";
import {
  MINIMUM_AGE,
  type LegalDoc,
  type LegalDocument,
  type LegalSummary,
  type User,
} from "@orbyn/core";
import { session } from "../../lib/session";
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
export function ConsentGate(props: Parameters<typeof ConsentGateBody>[0]) {
  return (
    <ConsentGateBody
      key={`${props.user.id}:${props.legal.terms_version}:${session.get()}`}
      {...props}
    />
  );
}
function ConsentGateBody({
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

  const owner = session.get();
  const mounted = useRef(true);
  const current = () => mounted.current && session.get() === owner;
  const request = useRef(0);
  const mutation = useRef(false);
  const [readingBusy, setReadingBusy] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, []);
  const read = async (doc: LegalDoc) => {
    const epoch = ++request.current;
    if (reading?.doc === doc) {
      setReading(null);
      setReadingBusy(false);
      return;
    }
    setReading(null);
    setReadingBusy(true);
    setError("");
    try {
      const next = await client.legalDocument(doc);
      if (current() && epoch === request.current) setReading(next);
    } catch (e) {
      if (current() && epoch === request.current) setError(errorText(e));
    } finally {
      if (current() && epoch === request.current) setReadingBusy(false);
    }
  };

  const accept = async () => {
    if (!agreed || mutation.current || !current()) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await client.acceptTerms(legal.terms_version);
      if (!current()) return;
      if (analytics === !!user.analytics_opt_out)
        await client.setPrivacy({ analytics_opt_out: !analytics });
      if (current()) onAccepted();
    } catch (e) {
      if (current()) setError(errorText(e));
    } finally {
      mutation.current = false;
      if (current()) setBusy(false);
    }
  };

  return (
    <AuthShell>
      <span className="eyebrow">
        {updated ? "Terms updated" : "Before you continue"}
      </span>
      <h2>
        <ShieldCheck size={22} style={{ verticalAlign: "-3px" }} /> Review terms
      </h2>
      <p>
        {updated
          ? "Review the updated Terms and Privacy Policy to continue."
          : "Review the Terms and Privacy Policy to continue."}
      </p>
      <div className="consent-docs">
        {(["terms", "privacy"] as const).map((doc) => (
          <button
            disabled={busy}
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
      {readingBusy && (
        <p className="muted" role="status">
          Loading document…
        </p>
      )}
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
          disabled={busy}
          checked={analytics}
          onChange={(e) => setAnalytics(e.target.checked)}
        />
        <span>
          Usage analytics
          <small>Count feature use to improve Orbyn. Never your content.</small>
        </span>
      </label>
      <label className="check-line consent-agree">
        <input
          type="checkbox"
          disabled={busy}
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
      <button className="text-button" disabled={busy} onClick={onLogout}>
        Sign out
      </button>
    </AuthShell>
  );
}
