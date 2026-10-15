import { useEffect, useRef, useState } from "react";
import { FileDown } from "lucide-react";
import { fileSizeLabel, type Doc, type OriginalsOverview } from "@orbyn/core";
import { client } from "../../lib/api";
import { useConfirm } from "../../components/Confirm";

/** Save a blob under a name, the way the page export does. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The file an imported page came from, when it was kept: download it, or
 * delete it and keep only the page. Shown at the end of the page.
 */
export function OriginalLine(props: Parameters<typeof OriginalLineBody>[0]) {
  return <OriginalLineBody key={props.doc.id} {...props} />;
}

function OriginalLineBody({
  doc,
  canWrite,
  onDeleted,
  report,
}: {
  doc: Pick<Doc, "id" | "original">;
  canWrite: boolean;
  onDeleted?: () => void;
  report: (e: unknown) => void;
}) {
  const { ask } = useConfirm();
  const mutation = useRef(false);
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState<string | null>(null);
  const original = doc.original;
  if (!original || gone === doc.id) return null;
  return (
    <div className="doc-original">
      <FileDown size={14} aria-hidden="true" />
      <span>
        Original: {original.file_name} · {fileSizeLabel(Number(original.bytes))}
      </span>
      <button
        type="button"
        className="text-button"
        disabled={busy}
        onClick={() => {
          if (mutation.current) return;
          mutation.current = true;
          setBusy(true);
          void client
            .downloadOriginal(doc.id)
            .then(({ blob, name }) => saveBlob(blob, name), report)
            .finally(() => {
              mutation.current = false;
              setBusy(false);
            });
        }}
      >
        Download
      </button>
      {canWrite && (
        <details className="original-actions">
          <summary>More actions</summary>
          <button
            type="button"
            className="text-button is-quiet"
            disabled={busy}
            onClick={() => {
              if (mutation.current) return;
              mutation.current = true;
              setBusy(true);
              void (async () => {
                try {
                  if (
                    !(await ask({
                      title: "Delete original file?",
                      body: `Deletes “${original.file_name}” permanently. The page stays.`,
                      confirmLabel: "Delete original",
                      destructive: true,
                    }))
                  )
                    return;
                  await client.deleteOriginal(doc.id);
                  setGone(doc.id);
                  onDeleted?.();
                } catch (error) {
                  report(error);
                } finally {
                  mutation.current = false;
                  setBusy(false);
                }
              })();
            }}
          >
            Delete original
          </button>
        </details>
      )}
    </div>
  );
}

/**
 * The "Keep the original" setting, where files come in: off by default;
 * on, new imports keep their file beside the page, within your space.
 */
export function KeepOriginalsSwitch({
  report,
}: {
  report: (e: unknown) => void;
}) {
  const [state, setState] = useState<OriginalsOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    client.originals().then(
      (value) => {
        if (alive) setState(value);
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [retry]);
  if (!state)
    return (
      <p className="muted">
        {failed ? "Could not load file storage." : "Loading file storage…"}
        {failed && (
          <button className="text-button" onClick={() => setRetry(retry + 1)}>
            Retry
          </button>
        )}
      </p>
    );
  const pct = state.quota_bytes
    ? Math.min(100, Math.round((state.used_bytes / state.quota_bytes) * 100))
    : 100;
  return (
    <label className="switch-line uploads-keep">
      <input
        type="checkbox"
        role="switch"
        className="ai-switch"
        checked={state.keep}
        disabled={busy}
        onChange={(e) => {
          if (mutation.current) return;
          mutation.current = true;
          setBusy(true);
          const keep = e.target.checked;
          setState({ ...state, keep });
          client
            .setKeepOriginals(keep)
            .catch((err) => {
              setState({ ...state, keep: !keep });
              report(err);
            })
            .finally(() => {
              mutation.current = false;
              setBusy(false);
            });
        }}
      />
      <span>
        Keep the original
        <small>
          Keeps encrypted files with new imports.{" "}
          {fileSizeLabel(state.used_bytes)} of{" "}
          {fileSizeLabel(state.quota_bytes)} used ({pct}%).
        </small>
      </span>
    </label>
  );
}
