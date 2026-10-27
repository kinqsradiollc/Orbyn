import { useEffect, useRef, useState } from "react";
import { Maximize2, Share2, X } from "lucide-react";
import {
  layoutConnections,
  nodeLabel,
  type ConnectionMap,
  type ConnectionNode,
} from "@orbyn/core";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../hooks/useModalFocus";
import { client } from "../../lib/api";
import { openObject, peekObject } from "../documents/editor/DocLinks";
import "./connections.css";

/**
 * The Connections map (CNV-02): what a page or project is linked to, one or
 * two steps out, in its Info panel. Not the whole workspace: only its own
 * neighbours, drawn in the palette's tones by kind. A click opens a node
 * beside the page (the side peek); ⌘-click or Enter opens it over the app.
 * Things the reader can't open are never on it.
 */

const KIND_WORDS: Record<ConnectionNode["kind"], string> = {
  doc: "Page",
  task: "Task",
  event: "Event",
  project: "Project",
  person: "Person",
  date: "Date",
};

export function ConnectionsMap({
  kind,
  id,
  revision,
  report,
  className = "page-info-section",
}: {
  /** The section's class: the Info rail's, or a project Home card's. */
  className?: string;
  kind: "doc" | "project";
  id: string;
  /** Changes when the page is saved, so links read afresh. */
  revision?: string | number;
  report: (e: unknown) => void;
}) {
  const [depth, setDepth] = useState<1 | 2>(1);
  const [map, setMap] = useState<ConnectionMap | null>(null);
  const [big, setBig] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const reportRef = useRef(report);
  reportRef.current = report;
  useEffect(() => {
    let live = true;
    setMap(null);
    setFailed(false);
    setBig(false);
    client.connectionMap(kind, id, depth).then(
      (m) => live && setMap(m),
      (e) => {
        if (!live) return;
        setFailed(true);
        reportRef.current(e);
      },
    );
    return () => {
      live = false;
    };
  }, [kind, id, depth, revision, retry]);

  const neighbours = Math.max(0, (map?.nodes.length ?? 1) - 1);
  return (
    <section className={`${className} connections`}>
      <div className="connections-head">
        <h3>Connections</h3>
        <div
          className="connections-depth"
          role="group"
          aria-label="How far out"
        >
          {([1, 2] as const).map((d) => (
            <button
              key={d}
              aria-pressed={depth === d}
              className={depth === d ? "is-on" : ""}
              onClick={() => setDepth(d)}
            >
              {d === 1 ? "1 step" : "2 steps"}
            </button>
          ))}
        </div>
        {neighbours > 0 && (
          <button
            className="icon-button"
            aria-label="Open the map larger"
            title="Open larger"
            onClick={() => setBig(true)}
          >
            <Maximize2 size={13} />
          </button>
        )}
      </div>
      {failed ? (
        <p className="connections-note" role="alert">
          Could not load connections.{" "}
          <button className="text-button" onClick={() => setRetry(retry + 1)}>
            Retry
          </button>
        </p>
      ) : map === null ? (
        <p className="connections-note">Loading connections…</p>
      ) : neighbours === 0 ? (
        <p className="connections-note">
          <Share2 size={13} aria-hidden="true" /> No connections yet.
        </p>
      ) : (
        <>
          <MapDrawing map={map} size={260} />
          <ConnectionList map={map} />
        </>
      )}
      {map?.truncated && (
        <p className="connections-note">
          Showing {map.nodes.length - 1} closest connections.
        </p>
      )}
      {big && map && (
        <ConnectionsDialog map={map} onClose={() => setBig(false)} />
      )}
    </section>
  );
}

function ConnectionList({ map }: { map: ConnectionMap }) {
  return (
    <details className="connections-list">
      <summary>Browse connections</summary>
      {map.nodes
        .filter((node) => node.depth > 0)
        .map((node) => (
          <button
            key={node.key}
            className="connection-list-row"
            onClick={() => openObject({ kind: node.kind, id: node.id })}
          >
            <span>{node.title}</span>
            <small>
              {KIND_WORDS[node.kind]}
              {node.closed ? " · Closed" : ""}
            </small>
          </button>
        ))}
    </details>
  );
}

function ConnectionsDialog({
  map,
  onClose,
}: {
  map: ConnectionMap;
  onClose: () => void;
}) {
  const focus = useModalFocus(onClose);
  useEffect(() => {
    const node = focus.ref.current as HTMLDialogElement;
    node.showModal();
    return () => node.close();
  }, []);
  return createPortal(
    <dialog
      ref={(node) => {
        focus.ref.current = node;
      }}
      data-modal-focus={focus.id}
      className="modal connections-dialog"
      aria-labelledby="connections-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="section-heading">
        <h2 id="connections-dialog-title">Connections</h2>
        <button className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <MapDrawing map={map} size={560} />
      <ConnectionList map={map} />
    </dialog>,
    document.body,
  );
}

/** The map itself: an SVG with a keyboard-reachable button for each node. */
function MapDrawing({ map, size }: { map: ConnectionMap; size: number }) {
  const placed = layoutConnections(map, size);
  const at = new Map(placed.map((n) => [n.key, n]));
  const labelMax = size > 400 ? 26 : 16;
  const open = (n: ConnectionNode, beside: boolean) => {
    if (n.depth === 0) return;
    const ref = { kind: n.kind, id: n.id } as const;
    if (beside) peekObject(ref);
    else openObject(ref);
  };
  return (
    <svg
      className="connections-map"
      viewBox={`0 0 ${size} ${size}`}
      role="group"
      aria-label={`${map.nodes.length - 1} connected things`}
    >
      {map.edges.map((e) => {
        const a = at.get(e.from);
        const b = at.get(e.to);
        if (!a || !b) return null;
        return (
          <line
            key={`${e.from}|${e.to}`}
            className={
              "connections-edge" +
              (a.depth === 2 || b.depth === 2 ? " is-far" : "")
            }
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
          >
            <title>{e.label}</title>
          </line>
        );
      })}
      {placed.map((n) => {
        const r = n.depth === 0 ? 9 : n.depth === 1 ? 7 : 5;
        // Labels sit on the far side from the middle, so they don't run
        // into the centre's own label; the centre's sits under it.
        const below = n.depth === 0 || n.y > size / 2 + 1;
        return (
          <g
            key={n.key}
            className={`connections-node is-${n.kind} depth-${n.depth}${
              n.closed ? " is-closed" : ""
            }`}
            transform={`translate(${n.x} ${n.y})`}
            role={n.depth === 0 ? undefined : "button"}
            tabIndex={n.depth === 0 ? undefined : 0}
            aria-label={
              n.depth === 0
                ? undefined
                : `${KIND_WORDS[n.kind]}: ${n.title}. Enter opens; Space previews.`
            }
            onClick={(e) => open(n, !(e.metaKey || e.ctrlKey))}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open(n, e.key === " ");
              }
            }}
          >
            <title>{`${KIND_WORDS[n.kind]}: ${n.title}`}</title>
            <circle r={r} />
            <text y={below ? r + 12 : -r - 5} textAnchor="middle">
              {nodeLabel(n.title, labelMax)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
