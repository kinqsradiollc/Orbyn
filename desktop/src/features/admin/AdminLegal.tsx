import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ExternalLink, RotateCcw, Save, Send, X } from "lucide-react";
import {
  LEGAL_TITLES,
  type LegalAdminView,
  type LegalDoc,
  type LegalSettingsUpdate,
} from "@orbyn/core";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../hooks/useModalFocus";
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

  const adopt = (v: LegalAdminView, keepDetails = false) => {
    setView(v);
    if (keepDetails) return;
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
      adopt(
        await client.updateLegal(input),
        "terms_body" in input || "privacy_body" in input || "publish" in input,
      );
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
      <section className="card system-card">
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
    <section className="card system-card legal-admin">
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
          Missing: {view.missing.map((m) => MISSING_LABELS[m] ?? m).join(", ")}.
          Have both texts reviewed before launch.
        </p>
      )}
      <details className="legal-service-details" open={view.missing.length > 0}>
        <summary>Service details</summary>
        <form
          className="system-form"
          onInvalidCapture={(event) => {
            const details = (event.target as HTMLElement).closest("details");
            if (details) details.open = true;
          }}
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
              disabled={action.pending}
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
              disabled={action.pending}
              value={contact}
              maxLength={254}
              placeholder="privacy@example.com"
              onChange={(e) => setContact(e.target.value)}
            />
          </label>
          <label className="system-field system-wide system-label">
            Governing law
            <input
              disabled={action.pending}
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
              disabled={action.pending}
              value={processors}
              maxLength={4000}
              placeholder={
                "Hosting — Example Cloud (EU)\nEmail delivery — Example Mail\nAI answers — Example AI\nPush notifications — Expo"
              }
              onChange={(e) => setProcessors(e.target.value)}
            />
            <small className="field-hint">
              One per line. Listed in the Privacy Policy under &quot;Who we
              share it with&quot;.
            </small>
          </label>
          <div className="system-footer system-wide">
            <button className="primary" disabled={action.pending}>
              <Save size={14} /> Save details
            </button>
          </div>
        </form>
      </details>

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
                  disabled={action.pending}
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
                <LegalEditorDialog
                  title={LEGAL_TITLES[doc]}
                  busy={action.pending}
                  onClose={() => setEditing(null)}
                >
                  <textarea
                    aria-label={`${LEGAL_TITLES[doc]} text`}
                    rows={16}
                    disabled={action.pending}
                    value={text}
                    maxLength={60000}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <small className="field-hint">
                    Saving changes the live text. Publish a new version to
                    request agreement again.
                  </small>
                  <details>
                    <summary>Formatting and placeholders</summary>
                    <p>
                      Use Markdown headings, lists and bold. {"{{company}}"},{" "}
                      {"{{contact}}"}, {"{{jurisdiction}}"}, {"{{processors}}"}{" "}
                      and {"{{version}}"} fill in automatically.
                    </p>
                  </details>
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
                        onClick={async () => {
                          if (
                            !(await ask({
                              title: "Restore the starting text?",
                              body: "Replaces your live custom text. This does not request renewed agreement.",
                              confirmLabel: "Restore text",
                              destructive: true,
                            }))
                          )
                            return;
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
                </LegalEditorDialog>
              )}
            </div>
          );
        })}
      </div>
      <OutcomeNote outcome={action.outcome} />
    </section>
  );
}

function LegalEditorDialog({
  title,
  busy,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const focus = useModalFocus(onClose, busy);
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="modal legal-editor-modal"
        ref={focus.ref}
        data-modal-focus={focus.id}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${title}`}
        tabIndex={-1}
      >
        <header>
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close legal editor"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="legal-admin-editor">{children}</div>
      </section>
    </div>,
    document.body,
  );
}
