import { useEffect, useState } from "react";
import { FileText, Plus } from "lucide-react";
import { parseDoc, type Doc, type DocSummary } from "@orbyn/core";
import { client } from "../../lib/api";
import { EmptyState } from "../../components/EmptyState";
import { DocEditor } from "./DocEditor";
import "./docs.css";

const when = (iso: string) => {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
};

/** A starter document, so a new note is never a blank wall. */
const STARTER = parseDoc(
  [
    "## What this is",
    "",
    "Write here. Anything you type is saved as you go.",
    "",
    "- [ ] A checklist item",
    "",
    "Inline maths like $e^{i\\pi} + 1 = 0$ renders as you type, and a formula on",
    "its own line looks like this:",
    "",
    "$$",
    "\\int_{0}^{1} x^2 \\, dx = \\frac{1}{3}",
    "$$",
  ].join("\n"),
);

export function DocsView({ report }: { report: (e: unknown) => void }) {
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [open, setOpen] = useState<Doc | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    client.listDocs().then(setDocs, (e) => {
      setDocs([]);
      report(e);
    });

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const create = () => {
    setBusy(true);
    client
      .createDoc({ title: "Untitled", content: STARTER })
      .then((doc) => {
        setOpen(doc);
        void load();
      })
      .catch(report)
      .finally(() => setBusy(false));
  };

  if (open)
    return (
      <DocEditor
        doc={open}
        report={report}
        onBack={() => {
          setOpen(null);
          void load();
        }}
        onChanged={(saved) => {
          setOpen(saved);
          setDocs(
            (current) =>
              current?.map((d) =>
                d.id === saved.id
                  ? { ...d, title: saved.title, updated_at: saved.updated_at }
                  : d,
              ) ?? current,
          );
        }}
        onDeleted={(id) => {
          setOpen(null);
          setDocs((current) => current?.filter((d) => d.id !== id) ?? current);
          void load();
        }}
      />
    );

  return (
    <div className="docs-view">
      <div className="docs-head">
        <span className="muted docs-count">
          {docs === null
            ? ""
            : docs.length === 1
              ? "1 document"
              : `${docs.length} documents`}
        </span>
        <button className="primary" onClick={create} disabled={busy}>
          <Plus size={15} /> New document
        </button>
      </div>

      {docs === null ? (
        <p className="muted">Loading…</p>
      ) : docs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents yet"
          body="Keep meeting notes, a project brief or a page of working out — all in the same place as your tasks."
        >
          <button className="primary" onClick={create} disabled={busy}>
            <Plus size={15} /> New document
          </button>
        </EmptyState>
      ) : (
        <ul className="docs-list">
          {docs.map((doc) => (
            <li key={doc.id}>
              <button
                className="doc-row"
                onClick={() =>
                  client.getDoc(doc.id).then(setOpen).catch(report)
                }
              >
                <FileText size={16} aria-hidden="true" />
                <span className="doc-row-main">
                  <strong>{doc.title || "Untitled"}</strong>
                  <small>{doc.preview || "Empty document"}</small>
                </span>
                <span className="doc-row-when">{when(doc.updated_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
