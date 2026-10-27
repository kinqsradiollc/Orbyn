import { useEffect, useRef, useState } from "react";
import { CalendarClock, GraduationCap, Sparkles, X } from "lucide-react";
import {
  aiFeatureProviderLabel,
  ASSIST_CHIPS,
  CHIP_CARDS,
  withDocumentSummary,
  HttpError,
  type DocEditorUpdate,
  type AssistChip,
  type CaptureAssistResult,
} from "@orbyn/core";
import { useModalFocus } from "../../../hooks/useModalFocus";
import { session } from "../../../lib/session";
import { client } from "../../../lib/api";
import { errorText } from "../../../lib/errors";
import { formatDateTime } from "../../../lib/format";
import { MakeCardsDialog } from "../../study/StudyView";
import "./assist.css";

const ICONS = {
  summarise: Sparkles,
  deadlines: CalendarClock,
  cards: GraduationCap,
} as const;

/**
 * The assistant's chips on a page just imported or scanned (AI-01):
 * Summarise, Pull out deadlines as tasks, Make 10 flashcards. Optional,
 * through the selected provider, and each comes back as a
 * suggestion: nothing changes until you take it.
 */
export function AssistChips(props: Parameters<typeof AssistChipsBody>[0]) {
  return <AssistChipsBody key={`${session.get()}:${props.docId}`} {...props} />;
}
function AssistChipsBody({
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
  const owner = session.get();
  const mounted = useRef(true);
  const current = () => mounted.current && session.get() === owner;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
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
          report={(e) => {
            if (current()) report(e);
          }}
          max={CHIP_CARDS}
          onClose={(added) => {
            if (!current()) return;
            setOpen(null);
            if (added) onChanged?.();
          }}
        />
      )}
      {(open === "summarise" || open === "deadlines") && (
        <AssistDialog
          key={open}
          action={open}
          docId={docId}
          title={title}
          onClose={(changed) => {
            if (!current()) return;
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
  const [summary, setSummary] = useState("");
  const [added, setAdded] = useState<number[]>([]);
  const addedTasks = useRef(new Set<number>());
  const taskKeys = useRef<string[]>([]);
  const summaryWrite = useRef<{ key: string; input: DocEditorUpdate } | null>(
    null,
  );
  const mounted = useRef(true);
  const pending = useRef(false);
  const owner = session.get();
  const current = () => mounted.current && session.get() === owner;
  const changed = useRef(false);
  const leave = () => {
    if (!pending.current && current()) onClose(changed.current);
  };
  const focus = useModalFocus(leave, busy);
  const read = useRef<Promise<CaptureAssistResult> | null>(null);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    if (!current() || pending.current) return;
    setLoading(true);
    setError("");
    try {
      const r = await (read.current ??= client.assistCapture({
        action,
        doc_id: docId,
      }));
      if (!current()) return;
      if (r.action !== action)
        throw new Error("Unexpected suggestion. Try again.");
      setResult(r);
      setSummary(r.summary);
      setKeep(r.tasks.map(() => true));
      taskKeys.current = r.tasks.map(() => crypto.randomUUID());
    } catch (e) {
      if (current()) {
        read.current = null;
        setError(errorText(e));
      }
    } finally {
      if (current()) setLoading(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, []);

  const take = async () => {
    if (!result || pending.current || !current()) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (action === "summarise") {
        if (!summaryWrite.current) {
          const doc = await client.getDocForEditor(docId);
          if (!current()) return;
          summaryWrite.current = {
            key: crypto.randomUUID(),
            input: {
              version: doc.version,
              document: withDocumentSummary(
                doc.document ?? { format: 1, blocks: doc.content },
                summary,
              ),
            },
          };
        }
        const snapshot = summaryWrite.current;
        await client.once(snapshot.key, () =>
          client.updateDocForEditor(docId, snapshot.input),
        );
        if (!current()) return;
        changed.current = true;
      } else {
        for (const [n, task] of result.tasks.entries()) {
          if (!keep[n] || addedTasks.current.has(n)) continue;
          if (!current()) return;
          await client.once(taskKeys.current[n], () =>
            client.createItem({
              id: taskKeys.current[n],
              title: task.title,
              kind: "task",
              due_at: task.due_at,
              notes: task.source ? `From “${title}”: ${task.source}` : "",
            }),
          );
          if (!current()) return;
          addedTasks.current.add(n);
          changed.current = true;
          setAdded([...addedTasks.current]);
          setKeep((all) =>
            all.map((value, index) => (index === n ? false : value)),
          );
        }
      }
      if (current()) onClose(changed.current);
    } catch (e) {
      if (
        e instanceof HttpError &&
        (e.status === 400 ||
          (e.status === 409 &&
            e.message ===
              "This document changed somewhere else. Refresh and try again."))
      )
        summaryWrite.current = null;
      if (current())
        setError(
          addedTasks.current.size
            ? `${addedTasks.current.size} tasks added. ${errorText(e)} Retry the remaining tasks.`
            : errorText(e),
        );
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  };
  const chosen = keep.filter(Boolean).length;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) leave();
      }}
    >
      <section
        ref={focus.ref}
        data-modal-focus={focus.id}
        tabIndex={-1}
        className="modal assist-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${focus.id}-title`}
      >
        <div className="section-heading">
          <h2 id={`${focus.id}-title`}>
            {action === "summarise" ? "Summary" : "Deadlines found"}
          </h2>
          <button
            className="icon-button"
            aria-label="Close"
            disabled={busy}
            onClick={leave}
          >
            <X size={20} />
          </button>
        </div>
        <div className="assist-body">
          <p className="muted">From “{title}”</p>
          {result?.provider && (
            <small className="muted assist-provider">
              {aiFeatureProviderLabel(result.provider)}
            </small>
          )}
          {loading && !result && (
            <p className="muted" aria-live="polite">
              Reading the page…
            </p>
          )}
          {result && action === "summarise" && (
            <label className="assist-summary-edit">
              Review summary
              <textarea
                maxLength={4000}
                value={summary}
                disabled={busy || !!summaryWrite.current}
                onChange={(e) => setSummary(e.target.value)}
                rows={6}
              />
            </label>
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
                      disabled={busy || added.includes(n)}
                      checked={added.includes(n) || (keep[n] ?? false)}
                      onChange={(e) =>
                        setKeep((k) =>
                          k.map((v, i) => (i === n ? e.target.checked : v)),
                        )
                      }
                    />
                    <span>
                      <strong>{t.title}</strong>
                      {added.includes(n) && <small>Added</small>}
                      <small>
                        {t.due_at
                          ? `Due ${formatDateTime(t.due_at)}`
                          : "No date"}
                      </small>
                    </span>
                  </label>
                  {t.source && (
                    <details>
                      <summary>Source</summary>
                      <p>{t.source}</p>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!result && error && (
            <button
              className="secondary"
              disabled={loading}
              onClick={() => void load()}
            >
              Retry
            </button>
          )}
          {error && summaryWrite.current && (
            <p className="muted">
              Retry this save before changing the summary.
            </p>
          )}
          {error && (
            <p role="alert" className="assist-error">
              {error}
            </p>
          )}
        </div>
        <div className="assist-foot">
          <button className="secondary" disabled={busy} onClick={leave}>
            Cancel
          </button>
          {result &&
            (action === "summarise" ? (
              <button
                className="primary"
                disabled={busy || !summary.trim()}
                onClick={() => void take()}
              >
                Add summary
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
