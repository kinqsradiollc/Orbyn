import { useEffect, useState } from "react";
import { Download, FileText, Trash2 } from "lucide-react";
import type { LegalDoc, LegalDocument, PrivacyView, User } from "@orbyn/core";
import { client } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { LegalText } from "../legal/LegalText";
import { SettingsSection } from "./SettingsSection";
import "../legal/legal.css";
import { errorText } from "../../lib/errors";

/**
 * Settings → Privacy: what you agreed to and when, the usage-analytics
 * choice, a copy of your data, and deleting your account. Each right the
 * Privacy Policy lists has its control here.
 */
export function PrivacySettings({
  user,
  report,
  onDeleted,
}: {
  user: User | null;
  report: (e: unknown) => void;
  /** The account is gone: leave the app. */
  onDeleted: () => void;
}) {
  const [view, setView] = useState<PrivacyView | null>(null);
  const [reading, setReading] = useState<LegalDocument | null>(null);
  const analytics = useAction(report);
  const data = useAction(report);
  const [password, setPassword] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    let alive = true;
    client
      .privacy()
      .then((v) => alive && setView(v))
      .catch(report);
    return () => {
      alive = false;
    };
  }, [report]);

  const read = async (doc: LegalDoc) => {
    if (reading?.doc === doc) return setReading(null);
    try {
      setReading(await client.legalDocument(doc));
    } catch (e) {
      report(e);
    }
  };

  const setAnalytics = (on: boolean) =>
    void analytics.run(async () => {
      setView(await client.setPrivacy({ analytics_opt_out: !on }));
      return on
        ? "Usage analytics is on."
        : "Usage analytics is off, and what was counted is cleared.";
    });

  const download = () =>
    void data.run(async () => {
      const archive = await client.exportData();
      const blob = new Blob([JSON.stringify(archive, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `orbyn-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      return "Your data was downloaded.";
    });

  const remove = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      await client.deleteAccount({ password });
      onDeleted();
    } catch (e) {
      setDeleteError(errorText(e));
    } finally {
      setDeleting(false);
    }
  };

  const current = view && view.terms_version === view.current_terms_version;

  return (
    <>
      <SettingsSection className="card settings-card" defaultOpen>
        <h2>What you agreed to</h2>
        <p className="muted">
          {!view
            ? "Loading…"
            : view.terms_accepted_at
              ? `You agreed to the Terms of Service and Privacy Policy (version ${view.terms_version}) on ${formatDateTime(view.terms_accepted_at)}.${current ? "" : " A newer version is waiting for you."}`
              : "You haven't agreed to the current terms yet."}
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
        <p className="muted">
          Orbyn counts, per day, how many requests, changes and assistant
          questions your account makes — never what you write. Admins see these
          counts added up across everyone. There are no ads and no third-party
          trackers.
        </p>
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
              Turning this off stops counting and clears what was counted.
              Request logs are still kept for 7 days for security.
            </small>
          </span>
        </label>
        <OutcomeNote outcome={analytics.outcome} />
      </SettingsSection>

      <SettingsSection className="card settings-card">
        <h2>Your data</h2>
        <p className="muted">
          Download everything that&apos;s yours — items, lists, tags, habits and
          settings — as a JSON file you can keep or bring somewhere else.
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
          <>
            <h3 className="privacy-history-title">Consent history</h3>
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
          </>
        )}
      </SettingsSection>

      <SettingsSection className="card settings-card">
        <h2>Delete my account</h2>
        <p className="muted">
          This deletes your account and everything only you can see, for good.
          Teams you own pass to another member, and shared work stays with the
          team. Download your data first if you want a copy.
        </p>
        {!confirming ? (
          <button className="danger" onClick={() => setConfirming(true)}>
            <Trash2 size={14} /> Delete my account…
          </button>
        ) : (
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
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
            </label>
            {deleteError && (
              <div role="alert" className="error">
                {deleteError}
              </div>
            )}
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                disabled={deleting}
                onClick={() => {
                  setConfirming(false);
                  setPassword("");
                  setDeleteError("");
                }}
              >
                Keep my account
              </button>
              <button className="danger" disabled={deleting || !password}>
                {deleting
                  ? "Deleting…"
                  : `Delete ${user?.email ?? "my account"} for good`}
              </button>
            </div>
          </form>
        )}
      </SettingsSection>
    </>
  );
}
