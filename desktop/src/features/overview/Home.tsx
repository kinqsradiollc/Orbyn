import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  MoreHorizontal,
  NotebookPen,
  Plus,
  Repeat,
  Target,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  DEFAULT_HOME,
  friendlyDate,
  greetingFor,
  HUB_LINK_KIND_LABELS,
  homePanels,
  MAX_HUB_LINKS,
  MAX_HUBS,
  newHubId,
  pickQuote,
  type DocSummary,
  type HomeHub,
  type HomeLayout,
  type HomePanel,
  type HomeSummary,
  type HubLink,
  type HubLinkKind,
  type Project,
  type SavedView,
  type StudyOverview,
  type User,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { usePrefs } from "../../app/prefs";
import { SCREENS } from "../../app/views";
import { Cover, LookDialog, LookIcon } from "../../components/Look";
import { Popover } from "../../components/Popover";
import { ProgressBar } from "../../components/ProgressBar";
import { Select } from "../../components/Select";
import { useToast } from "../../components/Toast";
import { useConfirm } from "../../components/Confirm";
import { dayLabel } from "../../lib/assistant-labels";
import "./home.css";
import { HomeCompanions } from "./HomeCompanions";

/**
 * Home (W1): the greeting with the time and a friendly date, an optional
 * line from one of your pages, then hubs of quick links and a row of three
 * panels — goals, routines and today's reflection. How it is laid out
 * follows the account (prefs.home); Settings → Arrange shows, hides and
 * reorders the panels.
 */

// ----------------------------------------------------------- the top ---

/** The greeting, the time and date, and the quote when it's on. */
export function HomeTop({
  user,
  timeZone,
  onNewItem,
}: {
  user: User | null;
  timeZone?: string;
  onNewItem: () => void;
}) {
  const { prefs } = usePrefs();
  const [now, setNow] = useState(() => new Date());
  const [quote, setQuote] = useState<string | null>(null);
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 20_000);
    return () => window.clearInterval(t);
  }, []);
  const { on, doc_id } = prefs.home.quote;
  useEffect(() => {
    if (!on || !doc_id) {
      setQuote(null);
      return;
    }
    let live = true;
    client.getDoc(doc_id).then(
      (doc) => live && setQuote(pickQuote(doc.content)),
      () => live && setQuote(null),
    );
    return () => {
      live = false;
    };
  }, [on, doc_id]);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
  const first = user?.name?.split(" ")[0];
  return (
    <div className="page-heading home-top">
      <div>
        <p className="home-when">
          <strong>
            {now.toLocaleTimeString([], {
              timeZone,
              hour: "numeric",
              minute: "2-digit",
            })}
          </strong>
          <span>{friendlyDate(now, timeZone)}</span>
        </p>
        <h1>
          {greetingFor(hour % 24)}
          {first ? `, ${first}` : ""}.
        </h1>
        {quote ? (
          <p className="home-quote">“{quote}”</p>
        ) : (
          <p>{SCREENS.Overview.subtitle}</p>
        )}
      </div>
      <button className="primary" onClick={onNewItem}>
        <Plus size={17} /> New item
      </button>
    </div>
  );
}

// ------------------------------------------------------------ hubs ---

type Sources = {
  projects: Project[];
  docs: DocSummary[];
  study: StudyOverview | null;
  views: SavedView[];
};

type Openers = {
  onOpenProject: (id: string) => void;
  onOpenDoc: (id: string) => void;
  onOpenStudy: () => void;
  onOpenView: (id: string) => void;
  onOpenUpcoming: () => void;
  report: (e: unknown) => void;
};

/** The quick links a hub shows: its own, or the latest of its kind. */
function linksOf(hub: HomeHub, s: Sources): HubLink[] {
  if (hub.links.length || !hub.auto) return hub.links;
  if (hub.auto === "projects")
    return s.projects
      .filter((p) => p.status === "active")
      .slice(0, 4)
      .map((p) => ({ kind: "project", id: p.id, label: p.name }));
  if (hub.auto === "study")
    return (s.study?.decks ?? [])
      .slice()
      .sort((a, b) => b.due - a.due)
      .slice(0, 4)
      .map((d) => ({
        kind: "deck",
        id: d.doc_id,
        label: d.title || "Untitled",
      }));
  return s.docs
    .filter((d) => d.kind !== "agenda")
    .slice(0, 4)
    .map((d) => ({ kind: "page", id: d.id, label: d.title || "Untitled" }));
}

/** A link's current name, when it can still be read; else the kept one. */
function nameOf(link: HubLink, s: Sources): string {
  if (link.kind === "project")
    return s.projects.find((p) => p.id === link.id)?.name ?? link.label;
  if (link.kind === "view")
    return s.views.find((v) => v.id === link.id)?.name ?? link.label;
  if (link.kind === "deck")
    return (
      s.study?.decks.find((d) => d.doc_id === link.id)?.title ?? link.label
    );
  return s.docs.find((d) => d.id === link.id)?.title || link.label;
}

function HubCard({
  hub,
  index,
  count,
  sources,
  open,
  onEdit,
  onMove,
  onRemove,
}: {
  hub: HomeHub;
  index: number;
  count: number;
  sources: Sources;
  open: Openers;
  onEdit: () => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const links = linksOf(hub, sources).slice(0, MAX_HUB_LINKS);
  const go = (link: HubLink) => {
    if (link.kind === "project") open.onOpenProject(link.id);
    else if (link.kind === "deck") open.onOpenStudy();
    else if (link.kind === "view") open.onOpenView(link.id);
    else open.onOpenDoc(link.id);
  };
  return (
    <section className="card home-hub" aria-label={hub.title}>
      <Cover fileId={hub.cover_file_id} className="home-hub-cover" />
      <div className="home-hub-head">
        <h2>
          {hub.icon && <LookIcon icon={hub.icon} size={17} />}
          <span>{hub.title}</span>
        </h2>
        <button
          className="icon-button"
          aria-label={`Options for ${hub.title}`}
          aria-haspopup="dialog"
          aria-expanded={!!menu}
          onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}
        >
          <MoreHorizontal size={17} />
        </button>
      </div>
      {links.length ? (
        <ul className="home-hub-links">
          {links.map((l) => (
            <li key={`${l.kind}:${l.id}`}>
              <button className="home-hub-link" onClick={() => go(l)}>
                <span className="home-hub-name">{nameOf(l, sources)}</span>
                <span className="chip">
                  {l.tag || HUB_LINK_KIND_LABELS[l.kind]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="home-hub-empty">
          Nothing here yet.{" "}
          <button className="text-button" onClick={onEdit}>
            Add links
          </button>
        </p>
      )}
      {menu && (
        <Popover
          anchor={menu}
          label={`Options for ${hub.title}`}
          onClose={() => setMenu(null)}
          width={200}
        >
          <div className="popover-actions">
            <button
              onClick={() => {
                setMenu(null);
                onEdit();
              }}
            >
              Edit hub
            </button>
            <button
              disabled={index === 0}
              onClick={() => {
                setMenu(null);
                onMove(-1);
              }}
            >
              <ArrowLeft size={14} /> Move left
            </button>
            <button
              disabled={index === count - 1}
              onClick={() => {
                setMenu(null);
                onMove(1);
              }}
            >
              <ArrowRight size={14} /> Move right
            </button>
            <button
              className="is-danger"
              onClick={() => {
                setMenu(null);
                onRemove();
              }}
            >
              <Trash2 size={14} /> Remove hub
            </button>
          </div>
        </Popover>
      )}
    </section>
  );
}

/** One kind of thing to link, as the Add a link list offers it. */
function candidates(kind: HubLinkKind, s: Sources) {
  if (kind === "project")
    return s.projects.map((p) => ({ id: p.id, label: p.name }));
  if (kind === "deck")
    return (s.study?.decks ?? []).map((d) => ({
      id: d.doc_id,
      label: d.title || "Untitled",
    }));
  if (kind === "view") return s.views.map((v) => ({ id: v.id, label: v.name }));
  return s.docs
    .filter((d) => d.kind !== "agenda")
    .map((d) => ({ id: d.id, label: d.title || "Untitled" }));
}

/** Edit a hub: its title, cover and icon, and its three to six links. */
function EditHubDialog({
  hub,
  sources,
  isNew,
  onSave,
  onClose,
  report,
}: {
  hub: HomeHub;
  sources: Sources;
  isNew: boolean;
  onSave: (hub: HomeHub) => void;
  onClose: () => void;
  report: (e: unknown) => void;
}) {
  const [title, setTitle] = useState(hub.title);
  const [look, setLook] = useState({
    icon: hub.icon,
    cover_file_id: hub.cover_file_id,
  });
  const [links, setLinks] = useState<HubLink[]>(
    hub.links.length ? hub.links : linksOf(hub, sources),
  );
  const [kind, setKind] = useState<HubLinkKind>("project");
  const [q, setQ] = useState("");
  const [lookOpen, setLookOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || lookOpen) return;
      if (document.querySelector(".popover")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, lookOpen]);

  const full = links.length >= MAX_HUB_LINKS;
  const shown = candidates(kind, sources)
    .filter((c) => !links.some((l) => l.kind === kind && l.id === c.id))
    .filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 8);
  const move = (i: number, by: -1 | 1) =>
    setLinks((ls) => {
      const j = i + by;
      if (j < 0 || j >= ls.length) return ls;
      const next = [...ls];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className="modal home-hub-dialog scale-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-hub-dialog-title"
      >
        <div className="section-heading">
          <h2 id="home-hub-dialog-title">{isNew ? "New hub" : "Edit hub"}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <form
          className="home-hub-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            onSave({
              ...hub,
              title: title.trim().slice(0, 40),
              icon: look.icon,
              cover_file_id: look.cover_file_id,
              links,
            });
          }}
        >
          <label>
            Title
            <input
              autoFocus
              required
              maxLength={40}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <div className="home-hub-look">
            <span className="home-hub-look-icon">
              {look.icon ? (
                <LookIcon icon={look.icon} size={18} />
              ) : (
                <small className="muted">No icon</small>
              )}
            </span>
            <span className="muted">
              {look.cover_file_id ? "Has a cover picture" : "No cover picture"}
            </span>
            <button
              type="button"
              className="secondary"
              onClick={() => setLookOpen(true)}
            >
              Cover and icon
            </button>
          </div>

          <h3 className="home-hub-sub">
            Links{" "}
            <small>
              {links.length} of {MAX_HUB_LINKS}
            </small>
          </h3>
          {links.length ? (
            <ul className="home-hub-edit-list">
              {links.map((l, i) => (
                <li key={`${l.kind}:${l.id}`}>
                  <span className="home-hub-name">{nameOf(l, sources)}</span>
                  <input
                    className="home-hub-tag"
                    aria-label={`Tag for ${l.label}`}
                    placeholder={HUB_LINK_KIND_LABELS[l.kind]}
                    maxLength={24}
                    value={l.tag ?? ""}
                    onChange={(e) =>
                      setLinks((ls) =>
                        ls.map((x, j) =>
                          j === i
                            ? { ...x, tag: e.target.value || undefined }
                            : x,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Move ${l.label} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Move ${l.label} down`}
                    disabled={i === links.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${l.label}`}
                    onClick={() =>
                      setLinks((ls) => ls.filter((_, j) => j !== i))
                    }
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              {hub.auto
                ? "No links chosen: the hub shows your latest ones."
                : "No links yet."}
            </p>
          )}

          <h3 className="home-hub-sub">Add a link</h3>
          <div className="home-hub-add">
            <Select
              aria-label="Kind of link"
              value={kind}
              onChange={(e) => setKind(e.target.value as HubLinkKind)}
            >
              <option value="project">Projects</option>
              <option value="deck">Study decks</option>
              <option value="page">Pages</option>
              <option value="view">Views</option>
            </Select>
            <input
              aria-label="Find one"
              placeholder="Find one…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {full ? (
            <p className="muted">
              A hub holds six links. Remove one to add another.
            </p>
          ) : shown.length ? (
            <ul className="home-hub-pick">
              {shown.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setLinks((ls) => [
                        ...ls,
                        { kind, id: c.id, label: c.label.slice(0, 80) },
                      ])
                    }
                  >
                    <Plus size={14} aria-hidden="true" />
                    <span>{c.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nothing to add here.</p>
          )}

          <div className="button-row">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary">
              Save
            </button>
          </div>
        </form>
      </section>
      {lookOpen && (
        <LookDialog
          title="Hub cover and icon"
          look={look}
          uploadTo={null}
          report={report}
          onSave={(next) => setLook(next)}
          onClose={() => setLookOpen(false)}
        />
      )}
    </div>
  );
}

function HubRow({
  layout,
  sources,
  open,
  save,
}: {
  layout: HomeLayout;
  sources: Sources;
  open: Openers;
  save: (home: HomeLayout) => void;
}) {
  const [editing, setEditing] = useState<{
    hub: HomeHub;
    isNew: boolean;
  } | null>(null);
  const { ask } = useConfirm();
  const hubs = layout.hubs;
  const setHubs = (next: HomeHub[]) => save({ ...layout, hubs: next });
  const addHub = () =>
    setEditing({
      hub: {
        id: newHubId(hubs, "hub"),
        title: "",
        cover_file_id: null,
        icon: null,
        auto: null,
        links: [],
      },
      isNew: true,
    });
  return (
    <section className="home-hubs" aria-label="Hubs">
      <div className="home-hubs-row">
        {hubs.map((hub, i) => (
          <HubCard
            key={hub.id}
            hub={hub}
            index={i}
            count={hubs.length}
            sources={sources}
            open={open}
            onEdit={() => setEditing({ hub, isNew: false })}
            onMove={(by) => {
              const j = i + by;
              if (j < 0 || j >= hubs.length) return;
              const next = [...hubs];
              [next[i], next[j]] = [next[j], next[i]];
              setHubs(next);
            }}
            onRemove={() =>
              void ask({
                title: `Remove the ${hub.title} hub?`,
                body: "Only the hub goes; what it links to stays where it is.",
                confirmLabel: "Remove",
                destructive: true,
              }).then(
                (ok) => ok && setHubs(hubs.filter((h) => h.id !== hub.id)),
              )
            }
          />
        ))}
        {hubs.length < MAX_HUBS && (
          <button className="home-hub-new" onClick={addHub}>
            <Plus size={17} aria-hidden="true" /> New hub
          </button>
        )}
      </div>
      {editing && (
        <EditHubDialog
          hub={editing.hub}
          isNew={editing.isNew}
          sources={sources}
          report={open.report}
          onClose={() => setEditing(null)}
          onSave={(hub) => {
            const next = editing.isNew
              ? [...hubs, { ...hub, id: newHubId(hubs, hub.title) }]
              : hubs.map((h) => (h.id === hub.id ? hub : h));
            setHubs(next);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------- panels ---

function Panel({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = "home-panel-" + title.toLowerCase().replace(/\W+/g, "-");
  return (
    <section className="card home-panel" aria-labelledby={id}>
      <div className="section-heading">
        <h2 id={id}>
          <Icon size={17} aria-hidden="true" className="heading-icon" />
          {title}
        </h2>
        {action}
      </div>
      <div className="home-panel-body">{children}</div>
    </section>
  );
}

function GoalsPanel({
  data,
  onOpenUpcoming,
}: {
  data: HomeSummary | null;
  onOpenUpcoming: () => void;
}) {
  const upcoming = (
    <button className="text-button" onClick={onOpenUpcoming}>
      Upcoming <ArrowRight size={14} />
    </button>
  );
  return (
    <Panel icon={Target} title="Goals" action={upcoming}>
      {!data ? (
        <p className="muted">Loading…</p>
      ) : data.goals.length ? (
        <ul className="home-rows">
          {data.goals.map((g) => (
            <li key={g.id}>
              <button className="home-row" onClick={onOpenUpcoming}>
                <strong>{g.title}</strong>
                {g.progress !== null ? (
                  <ProgressBar
                    value={g.progress * 100}
                    label={`Progress on ${g.title}`}
                  />
                ) : null}
                <small>
                  {g.next_checkin
                    ? `Check-in ${dayLabel(g.next_checkin)}`
                    : "Paused"}
                  {g.progress_label ? ` · ${g.progress_label}` : ""}
                </small>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          No active goals. Add one in Upcoming and the assistant checks in each
          week.
        </p>
      )}
    </Panel>
  );
}

function RoutinesPanel({
  data,
  onOpenUpcoming,
}: {
  data: HomeSummary | null;
  onOpenUpcoming: () => void;
}) {
  return (
    <Panel
      icon={Repeat}
      title="Routines"
      action={
        <button className="text-button" onClick={onOpenUpcoming}>
          Upcoming <ArrowRight size={14} />
        </button>
      }
    >
      {!data ? (
        <p className="muted">Loading…</p>
      ) : data.routines.length ? (
        <ul className="home-rows">
          {data.routines.map((r) => (
            <li key={r.id}>
              <button className="home-row" onClick={onOpenUpcoming}>
                <strong className="home-clamp">{r.name}</strong>
                <small>
                  {new Date(r.next_run_at).toLocaleString([], {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: r.timezone,
                  })}
                </small>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          No routines scheduled. Set one in Upcoming to have the assistant run
          it for you.
        </p>
      )}
    </Panel>
  );
}

function ReflectionPanel({
  data,
  onOpenDoc,
  onAdded,
  report,
}: {
  data: HomeSummary | null;
  onOpenDoc: (id: string) => void;
  onAdded: (lines: string[], docId: string) => void;
  report: (e: unknown) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const add = async () => {
    const line = text.trim();
    if (!line || busy) return;
    setBusy(true);
    try {
      const saved = await client.addReflection(line);
      setText("");
      onAdded(saved.reflection, saved.doc_id);
      toast({
        text: "Added to today's agenda",
        action: { label: "Open", run: () => onOpenDoc(saved.doc_id) },
      });
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };
  const lines = data?.reflection ?? [];
  return (
    <Panel icon={NotebookPen} title="Reflection">
      {data?.brief && (
        <button
          className="home-row home-brief"
          onClick={() => onOpenDoc(data.brief!.doc_id)}
        >
          <strong>Today's brief</strong>
          <small className="home-clamp">{data.brief.title}</small>
          {data.brief.overnight && <small>{data.brief.overnight}</small>}
          <ArrowUpRight size={14} aria-hidden="true" />
        </button>
      )}
      {data?.brief?.overnight && <a href="/app/overnight">Review Overnight</a>}
      <form
        className="home-reflect"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          aria-label="How did today go?"
          placeholder="How did today go?"
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="secondary" disabled={busy || !text.trim()}>
          Add
        </button>
      </form>
      {lines.length > 0 && (
        <ul className="home-reflection">
          {lines.slice(-3).map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
      {data?.agenda_doc_id && (
        <button
          className="text-button"
          onClick={() => onOpenDoc(data.agenda_doc_id!)}
        >
          Today's agenda <ArrowRight size={14} />
        </button>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------ the lot ---

/** Hubs and the three panels, in the order chosen; hidden ones left out. */
export function HomeSections(open: Openers) {
  const { prefs, save } = usePrefs();
  const layout = prefs.home ?? DEFAULT_HOME;
  const [sources, setSources] = useState<Sources>({
    projects: [],
    docs: [],
    study: null,
    views: [],
  });
  const [data, setData] = useState<HomeSummary | null>(null);
  const reportRef = useRef(open.report);
  reportRef.current = open.report;

  useEffect(() => {
    let live = true;
    void Promise.all([
      client.listProjects().catch(() => [] as Project[]),
      client.listDocs().catch(() => [] as DocSummary[]),
      client.study().catch(() => null),
      client.listViews().catch(() => [] as SavedView[]),
    ]).then(
      ([projects, docs, study, views]) =>
        live && setSources({ projects, docs, study, views }),
    );
    client.getHome().then(
      (d) => live && setData(d),
      () =>
        live &&
        setData({
          today: "",
          timezone: "UTC",
          goals: [],
          routines: [],
          brief: null,
          agenda_doc_id: null,
          reflection: [],
        }),
    );
    return () => {
      live = false;
    };
  }, []);

  const panels = homePanels(layout);
  // Consecutive panels share a row; hubs take a row of their own.
  const rows = useMemo(() => {
    const out: HomePanel[][] = [];
    for (const p of panels) {
      const last = out[out.length - 1];
      if (p !== "hubs" && last && last[0] !== "hubs") last.push(p);
      else out.push([p]);
    }
    return out;
  }, [panels]);

  const saveHome = (home: HomeLayout) => save({ home });
  const panel = (p: HomePanel) => {
    if (p === "goals")
      return (
        <GoalsPanel key={p} data={data} onOpenUpcoming={open.onOpenUpcoming} />
      );
    if (p === "routines")
      return (
        <RoutinesPanel
          key={p}
          data={data}
          onOpenUpcoming={open.onOpenUpcoming}
        />
      );
    return (
      <ReflectionPanel
        key={p}
        data={data}
        report={open.report}
        onOpenDoc={open.onOpenDoc}
        onAdded={(reflection, docId) =>
          setData((d) => (d ? { ...d, reflection, agenda_doc_id: docId } : d))
        }
      />
    );
  };

  return (
    <>
      <HomeCompanions />
      {rows.map((row) =>
        row[0] === "hubs" ? (
          <HubRow
            key="hubs"
            layout={layout}
            sources={sources}
            open={open}
            save={saveHome}
          />
        ) : (
          <div
            key={row.join("-")}
            className={`home-panels home-panels-${row.length}`}
          >
            {row.map(panel)}
          </div>
        ),
      )}
    </>
  );
}
