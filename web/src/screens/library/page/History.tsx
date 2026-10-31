import {
  diffBlocks,
  diffCounts,
  docContainerBlocks,
  type DocBlock,
  type DocVersion,
} from "@orbyn/core";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { messageOf } from "../../../lib/resource";
import { client } from "../../../lib/session";
import {
  Button,
  ErrorNotice,
  Loading,
  useConfirm,
  useToast,
} from "../../../ui/kit";
import { BlockView } from "./Blocks";
import type { Page } from "./usePage";

const stamp = (iso: string) => {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? `Today, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
};

const blocksOf = (version: DocVersion): DocBlock[] =>
  version.document?.format === 2
    ? docContainerBlocks(version.document.nodes, { projected: true })
    : version.document?.format === 1
      ? version.document.blocks
      : (version.content ?? []);

/** The page as it was. Restoring puts it back on top; nothing is thrown away. */
export function HistoryPanel({
  page,
  canWrite,
  settled,
  onClose,
}: {
  page: Page;
  canWrite: boolean;
  settled: () => Promise<boolean>;
  onClose: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<DocVersion | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    const id = ++request.current;
    setError("");
    try {
      const list = await client.listDocVersions(page.id);
      if (id === request.current) setVersions(list);
    } catch (failure) {
      if (id === request.current)
        setError(messageOf(failure, "Couldn't load history. Try again."));
    }
  }, [page.id]);
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [load]);

  const select = async (version: number) => {
    const id = ++request.current;
    setOpening(version);
    setError("");
    try {
      const full = await client.getDocVersion(page.id, version);
      if (id === request.current) setSelected(full);
    } catch (failure) {
      if (id === request.current)
        setError(messageOf(failure, "Couldn't open this version. Try again."));
    } finally {
      if (id === request.current) setOpening(null);
    }
  };

  const restore = async () => {
    if (!selected) return;
    const ok = await confirm({
      title: "Restore this version?",
      body: "The current page stays in history.",
      action: "Restore",
    });
    if (!ok) return;
    setRestoring(true);
    try {
      if (!(await settled())) return;
      const restored = await client.restoreDocVersion(
        page.id,
        selected.version,
      );
      page.adopt(restored);
      toast({ text: "Version restored." });
      onClose();
    } catch (failure) {
      toast({
        text: messageOf(failure, "Couldn't restore this version. Try again."),
        error: true,
      });
    } finally {
      setRestoring(false);
    }
  };

  const old = useMemo(() => (selected ? blocksOf(selected) : []), [selected]);
  const diff = useMemo(
    () => (selected ? diffBlocks(old, page.leaves) : []),
    [selected, old, page.leaves],
  );
  const counts = useMemo(() => diffCounts(diff), [diff]);

  if (selected)
    return (
      <div className="page-panel-body">
        <div className="page-panel-head">
          <Button variant="ghost" onClick={() => setSelected(null)}>
            <ArrowLeft /> All versions
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <h3 dir="auto">{selected.title || "Untitled"}</h3>
        <p className="small muted">
          {stamp(selected.created_at)} ·{" "}
          {selected.via_agent
            ? `Edited via ${selected.via_agent}`
            : (selected.author ?? "Someone")}
          {" · "}
          {counts.added} added, {counts.removed} removed since
        </p>
        {canWrite && (
          <Button
            variant="primary"
            busy={restoring}
            disabled={page.state.conflict}
            onClick={() => void restore()}
          >
            <RotateCcw /> Restore this version
          </Button>
        )}
        <div className="doc-version">
          {diff.map((line, index) => (
            <div key={index} className={`doc-diff is-${line.change}`}>
              {line.change === "removed" && (
                <span className="sr-only">Removed: </span>
              )}
              {line.change === "added" && (
                <span className="sr-only">Added: </span>
              )}
              <BlockView block={line.block} />
            </div>
          ))}
        </div>
      </div>
    );

  return (
    <div className="page-panel-body">
      <div className="page-panel-head">
        <h2>History</h2>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {error && <ErrorNotice message={error} onRetry={() => void load()} />}
      {!versions && !error && <Loading label="Loading history" />}
      {versions && !versions.length && (
        <p className="small muted">No earlier version.</p>
      )}
      {versions && versions.length > 0 && (
        <ol className="doc-versions">
          {versions.map((version) => (
            <li key={version.version}>
              <button
                type="button"
                className="row"
                disabled={opening !== null}
                onClick={() => void select(version.version)}
              >
                <span className="row-main">
                  <span className="row-title">{stamp(version.created_at)}</span>
                  <span className="small muted" dir="auto">
                    {version.via_agent
                      ? `Edited via ${version.via_agent}`
                      : (version.author ?? "Someone")}{" "}
                    · {version.blocks} blocks
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
