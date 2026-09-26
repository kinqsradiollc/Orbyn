import { useEffect, useRef, useState } from "react";
import { CalendarClock, GraduationCap, Sparkles, X } from "lucide-react";
import {
  ASSIST_CHIPS,
  CHIP_CARDS,
  withSummary,
  type AssistChip,
  type CaptureAssistResult,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";
import { MakeCardsDialog } from "../study/StudyView";
import "./assist.css";

const ICONS = {
  summarise: Sparkles,
  deadlines: CalendarClock,
  cards: GraduationCap,
} as const;

/**
 * The assistant's chips on a page just imported or scanned (AI-01):
 * Summarise, Pull out deadlines as tasks, Make 10 flashcards. Optional,
 * through Orbyn's hosted assistant only, and each comes back as a
 * suggestion: nothing changes until you take it.
 */
export function AssistChips({
  docId,
  title,
  report,
  onChanged,
}: {
  docId: string;
  title: string;
  report: (e: unknown) => void;
  /** Tasks were added, or the page changed. */
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState<AssistChip | null>(null);
  return (
    <>
      <span
        className="assist-chips"
        role="group"
        aria-label="Ask the assistant"
      >
        {ASSIST_CHIPS.map((chip) => {
          const Icon = ICONS[chip.id];
          return (
            <button
              key={chip.id}
              type="button"
              className="assist-chip"
              onClick={() => setOpen(chip.id)}
            >
              <Icon size={13} aria-hidden="true" /> {chip.label}
            </button>
          );
        })}
      </span>
      {open === "cards" && (
        <MakeCardsDialog
          docId={docId}
          title={title}
          report={report}
          max={CHIP_CARDS}
          onClose={(added) => {
            setOpen(null);
            if (added) onChanged?.();
          }}
        />
      )}
      {(open === "summarise" || open === "deadlines") && (
        <AssistDialog
          action={open}
          docId={docId}
          title={title}
          onClose={(changed) => {
            setOpen(null);
            if (changed) onChanged?.();
          }}
        />
      )}
    </>
  );
}

/** What the assistant suggested, to take or leave. */
function AssistDialog({
  action,
  docId,
  title,
  onClose,
}: {
  action: "summarise" | "deadlines";
  docId: string;
  title: string;
  onClose: (changed: boolean) => void;
}) {
  const [result, setResult] = useState<CaptureAssistResult | null>(null);
  const [keep, setKeep] = useState<boolean[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    client.assistCapture({ action, doc_id: docId }).then(
      (r) => {
        setResult(r);
        setKeep(r.tasks.map(() => true));
      },
      (e) => setError(errorText(e)),
    );
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [action, docId, onClose]);

  const take = async () => {
    if (!result) return;
    setBusy(true);
    setError("");
    try {
      if (action === "summarise") {
        const doc = await client.getDoc(docId);
        await client.updateDoc(docId, {
          version: doc.version,
          content: withSummary(doc.content, result.summary),
        });
      } else
        for (const [n, t] of result.tasks.entries())
          if (keep[n])
            await client.createItem({
              title: t.title,
              kind: "task",
              due_at: t.due_at,
              notes: t.source ? `From “${title}”: ${t.source}` : "",
            });
      onClose(true);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  const chosen = keep.filter(Boolean).length;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose(false);
      }}
    >
      <section
        className="modal assist-dialog scale-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assist-title"
      >
        <div className="section-heading">
          <h2 id="assist-title">
            {action === "summarise" ? "Summary" : "Deadlines found"}
          </h2>
          <button
            ref={close}
            className="icon-button"
            aria-label="Close"
            onClick={() => onClose(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="assist-body">
          <p className="muted">
            From “{title}”, by Orbyn's assistant. Nothing changes until you take
            it.
          </p>
          {!result && !error && (
            <p className="muted" aria-live="polite">
              Reading the page…
            </p>
          )}
          {result && action === "summarise" && (
            <div className="assist-summary">{result.summary}</div>
          )}
          {result && action === "deadlines" && !result.tasks.length && (
            <p className="muted">No deadlines were found on this page.</p>
          )}
          {result && action === "deadlines" && result.tasks.length > 0 && (
            <ul className="assist-tasks">
              {result.tasks.map((t, n) => (
                <li key={n}>
                  <label>
                    <input
                      type="checkbox"
                      checked={keep[n] ?? false}
                      onChange={(e) =>
                        setKeep((k) =>
                          k.map((v, i) => (i === n ? e.target.checked : v)),
                        )
                      }
                    />
                    <span>
                      <strong>{t.title}</strong>
                      <small>
                        {t.due_at
                          ? `Due ${formatDateTime(t.due_at)}`
                          : "No date"}
                        {t.source ? ` · “${t.source}”` : ""}
                      </small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className="assist-error">
              {error}
            </p>
          )}
        </div>
        <div className="assist-foot">
          <button className="secondary" onClick={() => onClose(false)}>
            Leave it
          </button>
          {result &&
            (action === "summarise" ? (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void take()}
              >
                Add to the top of the page
              </button>
            ) : (
              result.tasks.length > 0 && (
                <button
                  className="primary"
                  disabled={busy || !chosen}
                  onClick={() => void take()}
                >
                  Add {chosen} task{chosen === 1 ? "" : "s"}
                </button>
              )
            ))}
        </div>
      </section>
    </div>
  );
}
