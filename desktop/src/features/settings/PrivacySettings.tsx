import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, Trash2 } from "lucide-react";
import type { LegalDoc, LegalDocument, PrivacyView, User } from "@orbyn/core";
import { client } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { LegalText } from "../legal/LegalText";
import { SettingsSection } from "./SettingsSection";
import "../legal/legal.css";
import { errorText } from "../../lib/errors";
import { session as authSession } from "../../lib/session";
import { SettingsEditor } from "./SettingsEditor";

/**
 * Settings → Privacy: what you agreed to and when, the usage-analytics
 * choice, a copy of your data, and deleting your account. Each right the
 * Privacy Policy lists has its control here.
 */
export function PrivacySettings(props: Parameters<typeof PrivacyBody>[0]) {
  return (
    <PrivacyBody
      key={`${authSession.get()}:${props.user?.id ?? ""}`}
      {...props}
    />
  );
}

function PrivacyBody({
  user,
  report,
  onDeleted,
}: {
  user: User | null;
  report: (e: unknown) => void;
  /** The account is gone: leave the app. */
  onDeleted: () => void;
}) {
  const owner = useRef(authSession.get()).current;
  const mounted = useRef(true);
  const readRevision = useRef(0);
  const currentOwner = useCallback(
    () => mounted.current && authSession.get() === owner,
    [owner],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      readRevision.current++;
    };
  }, []);
  const [view, setView] = useState<PrivacyView | null>(null);
  const [reading, setReading] = useState<LegalDocument | null>(null);
  const analytics = useAction(report);
  const data = useAction(report);
  const legal = useAction(report);
  const deletion = useAction(report);
  const [readError, setReadError] = useState("");
  const [password, setPassword] = useState("");
  const [confirming, setConfirming] = useState(false);
  const deleting = deletion.pending;

  const load = useCallback(async () => {
    const revision = ++readRevision.current;
    setReadError("");
    try {
      const next = await client.privacy();
      if (currentOwner() && revision === readRevision.current) setView(next);
    } catch (e) {
      if (currentOwner() && revision === readRevision.current) {
        setReadError(errorText(e));
        report(e);
      }
    }
  }, [currentOwner, report]);
  useEffect(() => {
    void load();
  }, [load]);

  const read = async (doc: LegalDoc) => {
    if (reading?.doc === doc) return setReading(null);
    await legal.run(async () => {
      const next = await client.legalDocument(doc);
      if (currentOwner()) setReading(next);
    });
  };

  const setAnalytics = (on: boolean) =>
    void analytics.run(async () => {
      readRevision.current++;
      const next = await client.setPrivacy({ analytics_opt_out: !on });
      if (!currentOwner()) return;
      readRevision.current++;
      setReadError("");
      setView(next);
      return on
        ? "Usage analytics is on."
        : "Usage analytics is off, and what was counted is cleared.";
    });

  // Everything that's yours in one .zip: pages as Markdown in their
  // folders, projects, folders, what you imported, this consent history and
  // the planner file (tasks, lists, tags, habits) that can come back in.
  const download = () =>
    void data.run(async () => {
      const { blob, name } = await client.exportArchive();
      if (!currentOwner()) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      return "Download started.";
    });

  const remove = () =>
    deletion.run(async () => {
      await client.deleteAccount({ password });
      if (currentOwner()) onDeleted();
    });
  const closeDelete = () => {
    if (deleting) return;
    setConfirming(false);
    setPassword("");
    deletion.setOutcome(null);
  };

  const current = view && view.terms_version === view.current_terms_version;

  return (
    <>
      <SettingsSection className="card settings-card" defaultOpen>
        <h2>What you agreed to</h2>
        <p className="muted">
          {readError
            ? "Privacy settings unavailable."
            : !view
              ? "Loading…"
              : view.terms_accepted_at
                ? `You agreed to the Terms of Service and Privacy Policy (version ${view.terms_version}) on ${formatDateTime(view.terms_accepted_at)}.${current ? "" : " A newer version is waiting for you."}`
                : "You haven't agreed to the current terms yet."}
        </p>
        {readError && (
          <button className="secondary" onClick={() => void load()}>
            Retry privacy settings
          </button>
        )}
        <div className="consent-docs">
          {(["terms", "privacy"] as const).map((doc) => (
            <button
              key={doc}
              type="button"
              className="secondary"
              disabled={legal.pending}
              aria-expanded={reading?.doc === doc}
              onClick={() => void read(doc)}
            >
              <FileText size={15} />
              {doc === "terms" ? "Terms of Service" : "Privacy Policy"}
            </button>
          ))}
        </div>
        <OutcomeNote outcome={legal.outcome} />
        {reading && (
          <div
            className="consent-reader"
            tabIndex={0}
            aria-label={reading.title}
          >
            <LegalText body={reading.body} />
          </div>
        )}
      </SettingsSection>

      <SettingsSection className="card settings-card">
        <h2>Usage analytics</h2>
        <p className="muted">Counts feature use, never your content.</p>
        <label className="switch-line settings-field">
          <input
            type="checkbox"
            role="switch"
            className="ai-switch"
            checked={!!view && !view.analytics_opt_out}
            disabled={!view || analytics.pending}
            onChange={(e) => setAnalytics(e.target.checked)}
          />
          <span>
            Count my usage
            <small>
              Turning off clears usage counts. Security logs remain for 7 days.
            </small>
          </span>
        </label>
        <OutcomeNote outcome={analytics.outcome} />
      </SettingsSection>

      <SettingsSection className="card settings-card">
        <h2>Your data</h2>
        <p className="muted">
          Download your pages, plans and consent history as a .zip.
        </p>
        <button
          className="secondary"
          disabled={data.pending}
          onClick={download}
        >
          <Download size={14} /> Download my data
        </button>
        <OutcomeNote outcome={data.outcome} />
        {view && view.history.length > 0 && (
          <details>
            <summary>Consent history</summary>
            <ul className="privacy-history">
              {view.history.map((h, i) => (
                <li key={i}>
                  <span>
                    {h.kind === "terms"
                      ? `Agreed to the terms (version ${h.version})`
                      : h.granted
                        ? "Turned usage analytics on"
                        : "Turned usage analytics off"}
                  </span>
                  <time dateTime={h.at}>{formatDateTime(h.at)}</time>
                </li>
              ))}
            </ul>
          </details>
        )}
      </SettingsSection>

      <SettingsSection className="card settings-card">
        <h2>Delete my account</h2>
        <p className="muted">
          Download a copy before permanently deleting your account and private
          data; owned teams pass to another member.
        </p>
        {!confirming ? (
          <button className="danger" onClick={() => setConfirming(true)}>
            <Trash2 size={14} /> Delete my account…
          </button>
        ) : (
          <SettingsEditor
            title="Delete account"
            pending={deleting}
            onClose={closeDelete}
          >
            <p>
              Delete your account and private data permanently. Owned teams pass
              to another member.
            </p>
            <p className="muted">{user?.email}</p>
            <form
              className="privacy-delete"
              onSubmit={(e) => {
                e.preventDefault();
                void remove();
              }}
            >
              <label>
                Enter your password to confirm
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  disabled={deleting}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
              </label>
              <OutcomeNote outcome={deletion.outcome} />
              <div className="button-row">
                <button
                  type="button"
                  className="secondary"
                  disabled={deleting}
                  onClick={closeDelete}
                >
                  Keep my account
                </button>
                <button className="danger" disabled={deleting || !password}>
                  {deleting ? "Deleting…" : "Delete account"}
                </button>
              </div>
            </form>
          </SettingsEditor>
        )}
      </SettingsSection>
    </>
  );
}
