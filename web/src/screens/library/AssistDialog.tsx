import {
  aiFeatureProviderLabel,
  withDocumentSummary,
  type CaptureAssistResult,
  type DocEditorUpdate,
} from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { messageOf } from "../../lib/resource";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  Loading,
  TextArea,
} from "../../ui/kit";
import { loadLibrary } from "./store";

/** Summary or deadlines from a page. Nothing changes until it's taken. */
export function AssistDialog({
  chip,
  docId,
  title,
  onClose,
}: {
  chip: "summarise" | "deadlines";
  docId: string;
  title: string;
  onClose: () => void;
}) {
  const [result, setResult] = useState<CaptureAssistResult | null>(null);
  const [keep, setKeep] = useState<boolean[]>([]);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const added = useRef(new Set<number>());
  const keys = useRef<string[]>([]);
  const write = useRef<{ key: string; input: DocEditorUpdate } | null>(null);
  const load = () => {
    setError("");
    client.assistCapture({ action: chip, doc_id: docId }).then(
      (next) => {
        setResult(next);
        setSummary(next.summary);
        setKeep(next.tasks.map(() => true));
        keys.current = next.tasks.map(() => crypto.randomUUID());
      },
      (failure) => setError(messageOf(failure, "Couldn't read this page.")),
    );
  };
  useEffect(load, [docId, chip]); // eslint-disable-line react-hooks/exhaustive-deps
  const take = async () => {
    if (!result) return;
    setBusy(true);
    setError("");
    try {
      if (chip === "summarise") {
        if (!write.current) {
          const doc = await client.getDocForEditor(docId);
          write.current = {
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
        const snapshot = write.current;
        await client.once(snapshot.key, () =>
          client.updateDocForEditor(docId, snapshot.input),
        );
      } else {
        for (const [index, task] of result.tasks.entries()) {
          if (!keep[index] || added.current.has(index)) continue;
          await client.once(keys.current[index], () =>
            client.createItem({
              id: keys.current[index],
              title: task.title,
              kind: "task",
              due_at: task.due_at,
              notes: task.source ? `From “${title}”: ${task.source}` : "",
            }),
          );
          added.current.add(index);
        }
      }
      void loadLibrary();
      onClose();
    } catch (failure) {
      write.current = null;
      const done = added.current.size;
      setError(
        `${done ? `${done} tasks added. ` : ""}${messageOf(failure, "Couldn't save this.")}`,
      );
    } finally {
      setBusy(false);
    }
  };
  const chosen = keep.filter(Boolean).length;
  return (
    <Dialog
      title={chip === "summarise" ? "Summary" : "Deadlines found"}
      onClose={() => !busy && onClose()}
      actions={
        result && (
          <>
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              Not now
            </Button>
            <Button
              variant="primary"
              busy={busy}
              disabled={chip === "deadlines" ? !chosen : !summary.trim()}
              onClick={() => void take()}
            >
              {chip === "summarise"
                ? "Add to the page"
                : `Add ${chosen} task${chosen === 1 ? "" : "s"}`}
            </Button>
          </>
        )
      }
    >
      <p className="small muted" dir="auto">
        From “{title}”
      </p>
      {result?.provider && (
        <small className="muted">
          {aiFeatureProviderLabel(result.provider)}
        </small>
      )}
      {error && (
        <ErrorNotice message={error} onRetry={result ? undefined : load} />
      )}
      {!result && !error && <Loading label="Reading the page" />}
      {result && chip === "summarise" && (
        <Field label="Review summary">
          <TextArea
            dir="auto"
            rows={6}
            maxLength={4000}
            value={summary}
            disabled={busy}
            onChange={(event) => setSummary(event.currentTarget.value)}
          />
        </Field>
      )}
      {result && chip === "deadlines" && !result.tasks.length && (
        <p className="small muted">No deadlines found.</p>
      )}
      {result &&
        chip === "deadlines" &&
        result.tasks.map((task, index) => (
          <label key={index} className="check small">
            <input
              type="checkbox"
              checked={!!keep[index]}
              disabled={busy || added.current.has(index)}
              onChange={(event) => {
                const on = event.currentTarget.checked;
                setKeep((all) =>
                  all.map((value, at) => (at === index ? on : value)),
                );
              }}
            />
            <span dir="auto">
              {task.title}
              {task.due_at
                ? ` · ${new Date(task.due_at).toLocaleString()}`
                : ""}
            </span>
          </label>
        ))}
    </Dialog>
  );
}
