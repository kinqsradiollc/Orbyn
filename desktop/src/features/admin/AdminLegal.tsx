import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RotateCcw, Save, Send } from "lucide-react";
import {
  LEGAL_TITLES,
  type LegalAdminView,
  type LegalDoc,
  type LegalSettingsUpdate,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { useConfirm } from "../../components/Confirm";
import { OutcomeNote, useAction } from "../../components/Outcome";
import "./system.css";

type Report = (e: unknown) => void;

const MISSING_LABELS: Record<string, string> = {
  company: "who runs the service",
  contact_email: "a contact address for privacy requests",
  jurisdiction: "the governing law",
  processors: "the services that process data for you",
};

/**
 * Admin → System → Terms and privacy: who runs the service, the Terms and
 * Privacy Policy texts, and publishing a new version (everyone is then asked
 * to agree again). Also shows how many people have agreed to the current
 * version and how many turned usage analytics off.
 */
export function LegalCard({ report }: { report: Report }) {
  const { ask } = useConfirm();
  const [view, setView] = useState<LegalAdminView | null>(null);
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [processors, setProcessors] = useState("");
  const [editing, setEditing] = useState<LegalDoc | null>(null);
  const [text, setText] = useState("");
  const action = useAction(report);
  const { run } = action;

  const adopt = (v: LegalAdminView) => {
    setView(v);
    setCompany(v.settings.company);
    setContact(v.settings.contact_email);
    setJurisdiction(v.settings.jurisdiction);
    setProcessors(v.settings.processors);
  };
  const load = useCallback(
    () => void run(async () => adopt(await client.adminLegal())),
    [run],
  );
  useEffect(load, [load]);

  const save = (input: LegalSettingsUpdate, done: string) =>
    void action.run(async () => {
      adopt(await client.updateLegal(input));
      return done;
    });

  const publish = async (doc: LegalDoc) => {
    if (
      !(await ask({
        title: `Publish a new ${LEGAL_TITLES[doc]}?`,
        body: "Everyone will be asked to review it and agree again the next time they open Orbyn.",
        confirmLabel: "Publish",
      }))
    )
      return;
    save({ publish: [doc] }, `Published. Everyone will be asked to agree.`);
  };

  const openEditor = (doc: LegalDoc) => {
    if (!view) return;
    setEditing(doc);
    setText(view.settings[doc].body ?? view.defaults[doc]);
  };

  if (!view)
    return (
      <section className="card system-card fade-up">
        <div className="section-heading">
          <h2>Terms and privacy</h2>
        </div>
        <p className="muted">Loading…</p>
      </section>
    );

  const agreed = view.users
    ? Math.round((view.accepted_current / view.users) * 100)
    : 0;

  return (
    <section className="card system-card fade-up legal-admin">
      <div className="section-heading">
        <h2>Terms and privacy</h2>
        <span
          className={
            "system-pill " + (view.missing.length ? "is-warn" : "is-ok")
          }
        >
          {view.missing.length ? "Needs details" : "Complete"}
        </span>
      </div>
      <p className="muted">
        {view.accepted_current} of {view.users} people ({agreed}%) have agreed
        to the current version · {view.analytics_opted_out} turned usage
        analytics off.
      </p>
      {view.missing.length > 0 && (
        <p className="legal-admin-missing">
          The documents still need{" "}
          {view.missing.map((m) => MISSING_LABELS[m] ?? m).join(", ")}. Have a
          lawyer review both texts before you launch — they&apos;re a starting
          point, not legal advice.
        </p>
      )}
      <form
        className="system-form"
        onSubmit={(e) => {
          e.preventDefault();
          save(
            {
              company,
              contact_email: contact,
              jurisdiction,
              processors,
            },
            "Saved. The documents show these details now.",
          );
        }}
      >
        <label className="system-field system-label">
          Who runs the service
          <input
            value={company}
            maxLength={160}
            placeholder="Example Ltd"
            onChange={(e) => setCompany(e.target.value)}
          />
        </label>
        <label className="system-field system-label">
          Privacy contact
          <input
            type="email"
            value={contact}
            maxLength={254}
            placeholder="privacy@example.com"
            onChange={(e) => setContact(e.target.value)}
          />
        </label>
        <label className="system-field system-wide system-label">
          Governing law
          <input
            value={jurisdiction}
            maxLength={160}
            placeholder="England and Wales"
            onChange={(e) => setJurisdiction(e.target.value)}
          />
        </label>
        <label className="system-field system-wide system-label">
          Services that process data for you
          <textarea
            rows={4}
            value={processors}
            maxLength={4000}
            placeholder={
              "Hosting — Example Cloud (EU)\nEmail delivery — Example Mail\nAI answers — Example AI\nPush notifications — Expo"
            }
            onChange={(e) => setProcessors(e.target.value)}
          />
          <small className="field-hint">
            One per line. Listed in the Privacy Policy under &quot;Who we share
            it with&quot;.
          </small>
        </label>
        <div className="system-footer system-wide">
          <button className="primary" disabled={action.pending}>
            <Save size={14} /> Save details
          </button>
        </div>
      </form>

      <div className="legal-admin-docs">
        {(["terms", "privacy"] as const).map((doc) => {
          const d = view.settings[doc];
          return (
            <div key={doc} className="legal-admin-doc">
              <div>
                <strong>{LEGAL_TITLES[doc]}</strong>
                <small>
                  Version {d.version}
                  {d.updated_at
                    ? ` · published ${formatDateTime(d.updated_at)}`
                    : ""}
                  {d.body ? " · your own text" : " · Orbyn's starting text"}
                </small>
              </div>
              <div className="legal-admin-actions">
                <a
                  className="secondary"
                  href={`/${doc}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={14} /> View
                </a>
                <button
                  className="secondary"
                  onClick={() =>
                    editing === doc ? setEditing(null) : openEditor(doc)
                  }
                >
                  {editing === doc ? "Close" : "Edit text"}
                </button>
                <button
                  className="primary"
                  disabled={action.pending}
                  onClick={() => void publish(doc)}
                >
                  <Send size={14} /> Publish new version
                </button>
              </div>
              {editing === doc && (
                <div className="legal-admin-editor">
                  <textarea
                    aria-label={`${LEGAL_TITLES[doc]} text`}
                    rows={16}
                    value={text}
                    maxLength={60000}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <small className="field-hint">
                    Markdown: # and ## headings, - lists, **bold**. Placeholders
                    like {"{{company}}"}, {"{{contact}}"}, {"{{jurisdiction}}"},{" "}
                    {"{{processors}}"} and {"{{version}}"} are filled in. Saving
                    changes the text; publish a new version to ask everyone to
                    agree to it.
                  </small>
                  <div className="system-footer">
                    <button
                      className="primary"
                      disabled={action.pending || !text.trim()}
                      onClick={() =>
                        save(
                          doc === "terms"
                            ? { terms_body: text }
                            : { privacy_body: text },
                          "Text saved.",
                        )
                      }
                    >
                      <Save size={14} /> Save text
                    </button>
                    {d.body && (
                      <button
                        className="secondary"
                        disabled={action.pending}
                        onClick={() => {
                          save(
                            doc === "terms"
                              ? { terms_body: null }
                              : { privacy_body: null },
                            "Back to Orbyn's starting text.",
                          );
                          setEditing(null);
                        }}
                      >
                        <RotateCcw size={14} /> Use the starting text
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <OutcomeNote outcome={action.outcome} />
    </section>
  );
}
