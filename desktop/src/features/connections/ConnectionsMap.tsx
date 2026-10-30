import {
  useEffect,
  useRef,
  useState,
  useId,
  useSyncExternalStore,
} from "react";
import {
  Maximize2,
  Share2,
  X,
  Plus,
  Minus,
  RotateCcw,
  ArrowUpRight,
} from "lucide-react";
import {
  nodeLabel,
  type ConnectionMap,
  type ConnectionNode,
} from "@orbyn/core";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../hooks/useModalFocus";
import { client } from "../../lib/api";
import { onSessionChange, session } from "../../lib/session";
import { openObject, peekObject } from "../documents/editor/DocLinks";
import "./connections.css";
import { useElementWidth } from "../../hooks/useElementWidth";
import {
  boundedView,
  INITIAL_SPACE_VIEW,
  projectSpace,
  spaceLabels,
  type SpaceView,
} from "@orbyn/core";

/**
 * The Connections map (CNV-02): what a page or project is linked to, one or
 * two steps out, in its Info panel. Not the whole workspace: only its own
 * neighbours, projected from a rotatable 3D scene in the palette's tones.
 * Click selects a node; Preview opens the side peek, while Open, Enter or
 * a modified click opens it over the app.
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

const sessionKey = () => {
  const b = session.binding();
  return `${b.generation}:${b.token}`;
};
const openable = (node: ConnectionNode) =>
  node.depth > 0 && node.kind !== "person" && node.kind !== "date";
export function ConnectionsMap(
  props: Parameters<typeof ConnectionsMapBody>[0],
) {
  const owner = useSyncExternalStore(onSessionChange, sessionKey);
  return (
    <ConnectionsMapBody key={`${owner}:${props.kind}:${props.id}`} {...props} />
  );
}
function ConnectionsMapBody({
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
  const owner = useRef(sessionKey()).current;
  const owns = () => sessionKey() === owner;
  const [result, setResult] = useState<{
    key: string;
    map: ConnectionMap;
  } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([kind, id, depth, revision, retry]);
  const map = result?.key === key && owns() ? result.map : null;
  const failed = failure === key;
  const reportRef = useRef(report);
  reportRef.current = report;
  useEffect(() => {
    let live = true;
    setFailure(null);
    setBig(false);
    setShowMap(false);
    client.connectionMap(kind, id, depth).then(
      (map) => {
        if (live && owns()) setResult({ key, map });
      },
      (error) => {
        if (!live || !owns()) return;
        setFailure(key);
        reportRef.current(error);
      },
    );
    return () => {
      live = false;
    };
  }, [key]);
  const neighbours = (map?.nodes ?? []).filter((node) => node.depth > 0).length;
  const open = (node: ConnectionNode) => {
    if (owns() && openable(node)) openObject({ kind: node.kind, id: node.id });
  };
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
          <ConnectionList map={map} onOpen={open} />
          <details
            className="connections-map-disclosure"
            open={showMap}
            onToggle={(event) => setShowMap(event.currentTarget.open)}
          >
            <summary>Map</summary>
            {showMap && <MapDrawing key={key} map={map} canAct={owns} />}
          </details>
        </>
      )}
      {map?.truncated && (
        <p className="connections-note">
          Loaded the closest {neighbours} connections.
        </p>
      )}
      {big && map && (
        <ConnectionsDialog
          map={map}
          onClose={() => setBig(false)}
          onOpen={open}
          canAct={owns}
        />
      )}
    </section>
  );
}

function ConnectionList({
  map,
  onOpen,
}: {
  map: ConnectionMap;
  onOpen: (node: ConnectionNode) => void;
}) {
  const [all, setAll] = useState(false);
  const rows = map.nodes.filter((node) => node.depth > 0);
  const visible = all ? rows : rows.slice(0, 8);
  return (
    <div className="connections-list" aria-label="Linked work">
      {visible.map((node) => {
        const label = (
          <>
            <span>{node.title}</span>
            <small>
              {KIND_WORDS[node.kind]}
              {node.closed ? " · Closed" : ""}
            </small>
          </>
        );
        return openable(node) ? (
          <button
            type="button"
            key={node.key}
            className="connection-list-row"
            onClick={() => onOpen(node)}
          >
            {label}
          </button>
        ) : (
          <div key={node.key} className="connection-list-row is-informational">
            {label}
          </div>
        );
      })}
      {rows.length > 8 && (
        <button
          type="button"
          className="text-button"
          onClick={() => setAll((value) => !value)}
        >
          {all
            ? "Show fewer connections"
            : `Show all ${rows.length} connections`}
        </button>
      )}
    </div>
  );
}

function ConnectionsDialog({
  map,
  onClose,
  onOpen,
  canAct,
}: {
  map: ConnectionMap;
  onClose: () => void;
  onOpen: (node: ConnectionNode) => void;
  canAct: () => boolean;
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
      <MapDrawing map={map} expanded canAct={canAct} />
      <ConnectionList map={map} onOpen={onOpen} />
    </dialog>,
    document.body,
  );
}

/** Input-driven 3D scene, with the same API-owned nodes and edges as the list. */
function MapDrawing({
  map,
  expanded = false,
  canAct,
}: {
  map: ConnectionMap;
  expanded?: boolean;
  canAct: () => boolean;
}) {
  const pane = useElementWidth();
  const sceneWidth = Math.min(pane.width || 640, expanded ? 900 : 640);
  const [view, setView] = useState<SpaceView>(INITIAL_SPACE_VIEW);
  const [selected, setSelected] = useState(
    map.nodes.find((n) => n.depth === 0)?.key ?? map.nodes[0]?.key ?? "",
  );
  const gesture = useRef<{
    pointer: number;
    x: number;
    y: number;
    view: SpaceView;
  } | null>(null);
  const moved = useRef(false);
  const help = useId();
  const placed = projectSpace(map, view);
  const at = new Map(placed.map((n) => [n.key, n]));
  const labels = spaceLabels(placed, selected);
  const node = map.nodes.find((n) => n.key === selected);
  const open = (n: ConnectionNode, beside: boolean) => {
    if (!canAct() || !openable(n)) return;
    const ref = { kind: n.kind, id: n.id } as const;
    if (beside) peekObject(ref);
    else openObject(ref);
  };
  const change = (next: Partial<SpaceView>) =>
    setView((v) => boundedView({ ...v, ...next }));
  return (
    <div className="connections-space" ref={pane.ref}>
      <div
        className="connections-space-tools"
        role="group"
        aria-label="Map view"
      >
        <small id={help}>Drag to rotate · arrows to orbit</small>
        <button
          className="icon-button"
          aria-label="Zoom out connections"
          disabled={view.zoom <= 0.65}
          onClick={() => change({ zoom: view.zoom - 0.2 })}
        >
          <Minus size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="Zoom in connections"
          disabled={view.zoom >= 2.2}
          onClick={() => change({ zoom: view.zoom + 0.2 })}
        >
          <Plus size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="Reset connections view"
          onClick={() => setView(INITIAL_SPACE_VIEW)}
        >
          <RotateCcw size={15} />
        </button>
      </div>
      <svg
        className="connections-map connections-space-canvas"
        viewBox="0 0 640 400"
        role="group"
        tabIndex={0}
        aria-label={`3D map of ${map.nodes.length - 1} connections`}
        aria-describedby={help}
        onPointerDown={(e) => {
          if (!e.isPrimary || e.button !== 0) return;
          moved.current = false;
          gesture.current = {
            pointer: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            view,
          };
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g || g.pointer !== e.pointerId) return;
          const dx = e.clientX - g.x,
            dy = e.clientY - g.y;
          if (Math.hypot(dx, dy) < 4 && !moved.current) return;
          moved.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          setView(
            boundedView({
              ...g.view,
              yaw: g.view.yaw + dx * 0.01,
              pitch: g.view.pitch + dy * 0.01,
            }),
          );
        }}
        onPointerUp={() => {
          gesture.current = null;
        }}
        onPointerCancel={() => {
          gesture.current = null;
          moved.current = false;
        }}
        onLostPointerCapture={() => {
          gesture.current = null;
        }}
        onKeyDown={(e) => {
          const delta: Record<string, Partial<SpaceView>> = {
            ArrowLeft: { yaw: view.yaw - 0.15 },
            ArrowRight: { yaw: view.yaw + 0.15 },
            ArrowUp: { pitch: view.pitch - 0.15 },
            ArrowDown: { pitch: view.pitch + 0.15 },
            "+": { zoom: view.zoom + 0.2 },
            "-": { zoom: view.zoom - 0.2 },
          };
          if (delta[e.key]) {
            e.preventDefault();
            change(delta[e.key]);
          }
          if (e.key === "Home") {
            e.preventDefault();
            setView(INITIAL_SPACE_VIEW);
          }
        }}
      >
        <ellipse
          className="connections-orbit"
          cx={320}
          cy={200}
          rx={175}
          ry={65}
        />
        <ellipse
          className="connections-orbit"
          cx={320}
          cy={200}
          rx={70}
          ry={170}
        />
        {map.edges.map((e) => {
          const a = at.get(e.from),
            b = at.get(e.to);
          if (!a || !b) return null;
          return (
            <line
              key={`${e.from}|${e.to}`}
              className={
                "connections-edge" +
                (e.from === selected || e.to === selected ? " is-selected" : "")
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
          const r = (n.depth === 0 ? 13 : 9) * n.scale;
          const label = labels.get(n.key);
          return (
            <g
              key={n.key}
              data-node-key={n.key}
              data-world-depth={n.z.toFixed(2)}
              className={`connections-node is-${n.kind} depth-${n.depth}${n.key === selected ? " is-selected" : ""}${n.closed ? " is-closed" : ""}`}
              role="button"
              tabIndex={0}
              aria-pressed={n.key === selected}
              aria-label={`${KIND_WORDS[n.kind]}: ${n.title}`}
              onClick={(e) => {
                if (moved.current) return;
                if (e.metaKey || e.ctrlKey) open(n, false);
                else setSelected(n.key);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  open(n, false);
                }
                if (e.key === " ") {
                  e.preventDefault();
                  setSelected(n.key);
                }
              }}
            >
              <title>{`${KIND_WORDS[n.kind]}: ${n.title}`}</title>
              <circle
                className="connections-hit"
                cx={n.x}
                cy={n.y}
                r={(24 * 640) / sceneWidth}
              />
              <circle
                className="connections-dot"
                cx={n.x}
                cy={n.y}
                r={r}
                style={{ opacity: Math.max(0.55, n.scale / 1.3) }}
              />
              {label && (
                <text
                  style={{ fontSize: (11 * 640) / sceneWidth }}
                  x={label.x}
                  y={label.y}
                  textAnchor="middle"
                >
                  {nodeLabel(
                    n.title,
                    Math.max(9, Math.floor((18 * sceneWidth) / 640)),
                  )}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {node && (
        <div className="connections-selection" aria-live="polite">
          <div>
            <small>
              {KIND_WORDS[node.kind]}
              {node.depth > 0
                ? ` · ${node.depth} ${node.depth === 1 ? "step" : "steps"}`
                : " · Current"}
            </small>
            <strong>{node.title}</strong>
          </div>
          {node.depth > 0 && node.kind !== "person" && node.kind !== "date" && (
            <div className="connections-selection-actions">
              <button className="secondary" onClick={() => open(node, true)}>
                Preview
              </button>
              <button className="secondary" onClick={() => open(node, false)}>
                Open <ArrowUpRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
