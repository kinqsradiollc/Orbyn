import {
  INITIAL_SPACE_VIEW,
  boundedView,
  nodeLabel,
  projectSpace,
  spaceLabels,
  type ConnectionMap,
  type ConnectionNode,
  type LinkedHere,
  type SpaceView,
} from "@orbyn/core";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  FileText,
  Link2,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
} from "lucide-react";
import { useRef, useState } from "react";
import { messageOf, useResource } from "../../lib/resource";
import { navigate } from "../../lib/router";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  IconButton,
  Loading,
  SelectBox,
  useToast,
} from "../../ui/kit";
import { tasks } from "../shared-task";

const KIND_WORDS: Record<ConnectionNode["kind"], string> = {
  doc: "Page",
  task: "Task",
  event: "Event",
  project: "Project",
  person: "Person",
  date: "Date",
};

const openable = (node: ConnectionNode) =>
  node.depth > 0 && node.kind !== "person" && node.kind !== "date";

const openNode = (node: ConnectionNode, beside = false) => {
  if (!openable(node)) return;
  const kind =
    node.kind === "doc" ? "doc" : node.kind === "project" ? "project" : "task";
  if (beside || kind === "task") tasks.peek({ kind, id: node.id });
  else navigate(`/app/${kind}/${node.id}`);
};

/** One project's neighbours in space: drag or arrow keys orbit, no idle spin. */
function Space({ map, wide }: { map: ConnectionMap; wide?: boolean }) {
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
  const placed = projectSpace(map, view);
  const at = new Map(placed.map((n) => [n.key, n]));
  const labels = spaceLabels(placed, selected);
  const node = map.nodes.find((n) => n.key === selected);
  const change = (next: Partial<SpaceView>) =>
    setView((v) => boundedView({ ...v, ...next }));
  const width = wide ? 900 : 640;
  return (
    <div className="pj-space">
      <div className="pj-space-tools" role="group" aria-label="Map view">
        <small>Drag to rotate · arrows to orbit</small>
        <IconButton
          label="Zoom out connections"
          disabled={view.zoom <= 0.65}
          onClick={() => change({ zoom: view.zoom - 0.2 })}
        >
          <Minus />
        </IconButton>
        <IconButton
          label="Zoom in connections"
          disabled={view.zoom >= 2.2}
          onClick={() => change({ zoom: view.zoom + 0.2 })}
        >
          <Plus />
        </IconButton>
        <IconButton
          label="Reset connections view"
          onClick={() => setView(INITIAL_SPACE_VIEW)}
        >
          <RotateCcw />
        </IconButton>
      </div>
      <svg
        className="pj-map"
        viewBox="0 0 640 400"
        role="group"
        tabIndex={0}
        aria-label={`3D map of ${map.nodes.length - 1} connections`}
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
          const dx = e.clientX - g.x;
          const dy = e.clientY - g.y;
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
        <ellipse className="pj-orbit" cx={320} cy={200} rx={175} ry={65} />
        <ellipse className="pj-orbit" cx={320} cy={200} rx={70} ry={170} />
        {map.edges.map((e) => {
          const a = at.get(e.from);
          const b = at.get(e.to);
          if (!a || !b) return null;
          return (
            <line
              key={`${e.from}|${e.to}`}
              className={`pj-edge${e.from === selected || e.to === selected ? " is-selected" : ""}`}
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
          const label = labels.get(n.key);
          return (
            <g
              key={n.key}
              className={`pj-node is-${n.kind}${n.key === selected ? " is-selected" : ""}`}
              role="button"
              tabIndex={0}
              aria-pressed={n.key === selected}
              aria-label={`${KIND_WORDS[n.kind]}: ${n.title}`}
              onClick={(e) => {
                if (moved.current) return;
                if (e.metaKey || e.ctrlKey) openNode(n);
                else setSelected(n.key);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  openNode(n);
                }
                if (e.key === " ") {
                  e.preventDefault();
                  setSelected(n.key);
                }
              }}
            >
              <title>{`${KIND_WORDS[n.kind]}: ${n.title}`}</title>
              <circle className="pj-hit" cx={n.x} cy={n.y} r={22} />
              <circle
                className="pj-dot"
                cx={n.x}
                cy={n.y}
                r={(n.depth === 0 ? 13 : 9) * n.scale}
                style={{ opacity: Math.max(0.55, n.scale / 1.3) }}
              />
              {label && (
                <text x={label.x} y={label.y} textAnchor="middle">
                  {nodeLabel(
                    n.title,
                    Math.max(9, Math.floor((18 * width) / 640)),
                  )}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {node && (
        <div className="pj-selection" aria-live="polite">
          <div>
            <small>
              {KIND_WORDS[node.kind]}
              {node.depth > 0
                ? ` · ${node.depth} ${node.depth === 1 ? "step" : "steps"}`
                : " · Current"}
            </small>
            <span dir="auto">{node.title}</span>
          </div>
          {openable(node) && (
            <div className="pj-row-wrap">
              <Button onClick={() => openNode(node, true)}>Preview</Button>
              <Button onClick={() => openNode(node)}>
                Open <ArrowUpRight aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** What this project is linked to, as a list or a map. Unreadable things are never on it. */
export function Related({ id, revision }: { id: string; revision: string }) {
  const [depth, setDepth] = useState<1 | 2>(1);
  const [map, setMap] = useState(false);
  const [big, setBig] = useState(false);
  const read = useResource(
    () => client.connectionMap("project", id, depth),
    [id, depth, revision],
  );
  const data = read.data;
  const nodes = (data?.nodes ?? []).filter((n) => n.depth > 0);
  return (
    <section className="pj-block" aria-label="Related">
      <header className="pj-block-head">
        <h3>
          Related{" "}
          {data && <span className="pj-count-note">{nodes.length}</span>}
        </h3>
        <div className="pj-row-wrap">
          <SelectBox
            aria-label="How far out"
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value) as 1 | 2)}
          >
            <option value={1}>1 step</option>
            <option value={2}>2 steps</option>
          </SelectBox>
          {nodes.length > 0 && (
            <>
              <Button
                variant="ghost"
                aria-pressed={map}
                onClick={() => setMap(!map)}
              >
                {map ? "List" : "Map"}
              </Button>
              <IconButton
                label="Open the map larger"
                onClick={() => setBig(true)}
              >
                <Maximize2 />
              </IconButton>
            </>
          )}
        </div>
      </header>
      {read.error && !data && (
        <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
      )}
      {read.loading && !data && <Loading label="Loading connections" />}
      {data && !nodes.length && (
        <p className="muted small">Nothing is linked here yet.</p>
      )}
      {data && nodes.length > 0 && !map && (
        <ul className="pj-related">
          {nodes.slice(0, 12).map((node) => (
            <li key={node.key}>
              <button disabled={!openable(node)} onClick={() => openNode(node)}>
                <small>{KIND_WORDS[node.kind]}</small>
                <span dir="auto">{node.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && nodes.length > 0 && map && <Space map={data} />}
      {big && data && (
        <Dialog title="Related" wide onClose={() => setBig(false)}>
          <Space map={data} wide />
        </Dialog>
      )}
    </section>
  );
}

const LinkRow = ({ entry }: { entry: LinkedHere }) => (
  <button
    onClick={() =>
      entry.kind === "doc"
        ? navigate(
            `/app/doc/${entry.id}${entry.block_id ? `#${encodeURIComponent(entry.block_id)}` : ""}`,
          )
        : tasks.open(entry.id)
    }
  >
    <FileText aria-hidden="true" />
    <span className="pj-grow">
      <span dir="auto">{entry.title}</span>
      {entry.hint && <small dir="auto">{entry.hint}</small>}
      {(entry.context.before ||
        entry.context.linked ||
        entry.context.after) && (
        <small dir="auto">
          {entry.context.before}
          {entry.context.linked && <b>{entry.context.linked}</b>}
          {entry.context.after}
        </small>
      )}
    </span>
  </button>
);

/** Pages and tasks that link here, and unlinked mentions you can turn into links. */
export function LinkedHere_({ id }: { id: string }) {
  const toast = useToast();
  const [round, setRound] = useState(0);
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [linking, setLinking] = useState(false);
  const list = useResource(() => client.linksHere("project", id), [id, round]);
  const mentions = useResource(
    () => client.unlinkedMentions("project", id).catch(() => []),
    [id, round],
  );
  if (list.error && !list.data)
    return (
      <ErrorNotice
        message={list.error}
        onRetry={() => setRound((n) => n + 1)}
      />
    );
  const count = list.data?.count ?? 0;
  const found = mentions.data ?? [];
  if (!count && !found.length) return null;
  const Fold = open ? ChevronDown : ChevronRight;
  const Mention = more ? ChevronDown : ChevronRight;
  const link = async (m: (typeof found)[number]) => {
    if (!m.block_id || linking) return;
    setLinking(true);
    try {
      await client.linkMention({
        doc_id: m.doc_id,
        block_id: m.block_id,
        matched: m.matched,
        target: { kind: "project", id },
      });
      setRound((n) => n + 1);
    } catch (failure) {
      toast({ text: messageOf(failure, "Couldn't link that."), error: true });
    } finally {
      setLinking(false);
    }
  };
  return (
    <section className="pj-side" aria-label="Linked here">
      {count > 0 && (
        <>
          <button
            className="pj-fold"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Fold aria-hidden="true" /> Linked here · {count}
          </button>
          {open && (
            <ul className="pj-links">
              {list.data!.items.map((entry) => (
                <li key={`${entry.kind}:${entry.id}`}>
                  <LinkRow entry={entry} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {found.length > 0 && (
        <>
          <button
            className="pj-fold"
            aria-expanded={more}
            onClick={() => setMore(!more)}
          >
            <Mention aria-hidden="true" /> Mentioned without a link ·{" "}
            {found.length}
          </button>
          {more && (
            <ul className="pj-links">
              {found.map((m) => (
                <li key={m.doc_id}>
                  <button
                    onClick={() =>
                      navigate(
                        `/app/doc/${m.doc_id}${m.block_id ? `#${encodeURIComponent(m.block_id)}` : ""}`,
                      )
                    }
                  >
                    <FileText aria-hidden="true" />
                    <span className="pj-grow">
                      <span dir="auto">{m.title}</span>
                      <small dir="auto">
                        {m.context.before}
                        <b>{m.context.linked}</b>
                        {m.context.after}
                      </small>
                    </span>
                  </button>
                  {m.can_link && (
                    <Button
                      variant="ghost"
                      disabled={linking}
                      onClick={() => void link(m)}
                    >
                      <Link2 aria-hidden="true" /> Link
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
