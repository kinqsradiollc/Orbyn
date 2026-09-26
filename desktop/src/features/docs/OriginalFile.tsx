import { useEffect, useState } from "react";
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
export function OriginalLine({
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
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState<string | null>(null);
  const original = doc.original;
  if (!original || gone === doc.id) return null;
  return (
    <p className="doc-original">
      <FileDown size={14} aria-hidden="true" />
      <span>
        Original kept: {original.file_name} ·{" "}
        {fileSizeLabel(Number(original.bytes))}
      </span>
      <button
        type="button"
        className="text-button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void client
            .downloadOriginal(doc.id)
            .then(({ blob, name }) => saveBlob(blob, name), report)
            .finally(() => setBusy(false));
        }}
      >
        Download
      </button>
      {canWrite && (
        <button
          type="button"
          className="text-button is-quiet"
          disabled={busy}
          onClick={() =>
            void ask({
              title: `Delete the original “${original.file_name}”?`,
              body: "The page stays as it is. The file can't be brought back.",
              confirmLabel: "Delete original",
              destructive: true,
            }).then(async (yes) => {
              if (!yes) return;
              try {
                await client.deleteOriginal(doc.id);
                setGone(doc.id);
                onDeleted?.();
              } catch (e) {
                report(e);
              }
            })
          }
        >
          Delete original
        </button>
      )}
    </p>
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
  useEffect(() => {
    client.originals().then(setState, () => setState(null));
  }, []);
  if (!state) return null;
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
        onChange={(e) => {
          const keep = e.target.checked;
          setState({ ...state, keep });
          client.setKeepOriginals(keep).catch((err) => {
            setState({ ...state, keep: !keep });
            report(err);
          });
        }}
      />
      <span>
        Keep the original
        <small>
          New imports keep their file beside the page, encrypted, until you
          delete it. {fileSizeLabel(state.used_bytes)} of{" "}
          {fileSizeLabel(state.quota_bytes)} used ({pct}%).
        </small>
      </span>
    </label>
  );
}
