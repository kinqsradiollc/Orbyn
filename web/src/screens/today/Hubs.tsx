import {
  HUB_LINK_KIND_LABELS,
  MAX_HUB_LINKS,
  MAX_HUBS,
  newHubId,
  type DocSummary,
  type HomeHub,
  type HomeLayout,
  type HubLink,
  type HubLinkKind,
  type Project,
  type SavedView,
  type StudyOverview,
} from "@orbyn/core";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { messageOf } from "../../lib/resource";
import { navigate } from "../../lib/router";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  IconButton,
  Input,
  Menu,
  SelectBox,
  useConfirm,
  useToast,
} from "../../ui/kit";
import { Cover, LookDialog, LookIcon } from "../projects/look";
import { saveHome } from "./prefs";

export type Sources = {
  projects: Project[];
  docs: DocSummary[];
  study: StudyOverview | null;
  views: SavedView[];
};

const linksOf = (hub: HomeHub, s: Sources): HubLink[] => {
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
};

const nameOf = (link: HubLink, s: Sources) => {
  if (link.kind === "project")
    return s.projects.find((p) => p.id === link.id)?.name ?? link.label;
  if (link.kind === "view")
    return s.views.find((v) => v.id === link.id)?.name ?? link.label;
  if (link.kind === "deck")
    return (
      s.study?.decks.find((d) => d.doc_id === link.id)?.title ?? link.label
    );
  return s.docs.find((d) => d.id === link.id)?.title || link.label;
};

const candidates = (kind: HubLinkKind, s: Sources) => {
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
};

const go = (link: HubLink) => {
  if (link.kind === "project") navigate(`/app/project/${link.id}`);
  else if (link.kind === "deck") navigate("/app/study");
  else if (link.kind === "view") navigate(`/app/view/${link.id}`);
  else navigate(`/app/doc/${link.id}`);
};

function EditHub({
  hub,
  isNew,
  sources,
  onSave,
  onClose,
}: {
  hub: HomeHub;
  isNew: boolean;
  sources: Sources;
  onSave: (hub: HomeHub) => Promise<void>;
  onClose: () => void;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const full = links.length >= MAX_HUB_LINKS;
  const shown = candidates(kind, sources)
    .filter((c) => !links.some((l) => l.kind === kind && l.id === c.id))
    .filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase()));
  const move = (i: number, by: -1 | 1) =>
    setLinks((list) => {
      const j = i + by;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const save = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSave({
        ...hub,
        title: title.trim().slice(0, 40),
        icon: look.icon,
        cover_file_id: look.cover_file_id,
        links,
      });
    } catch (failure) {
      setError(messageOf(failure, "Couldn't save the hub."));
      setBusy(false);
    }
  };
  if (lookOpen)
    return (
      <LookDialog
        title={title || "Untitled hub"}
        look={look}
        uploadTo={null}
        onSave={(next) => setLook(next)}
        onClose={() => setLookOpen(false)}
      />
    );
  return (
    <Dialog
      title={isNew ? "New hub" : "Edit hub"}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!title.trim()}
            onClick={() => void save()}
          >
            Save
          </Button>
        </>
      }
    >
      <Field label="Title">
        <Input
          autoFocus
          required
          maxLength={40}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <div className="today-hub-look">
        <span>
          {look.icon ? (
            <LookIcon icon={look.icon} />
          ) : (
            <span className="muted small">No icon</span>
          )}
        </span>
        <span className="muted small">
          {look.cover_file_id ? "Has a cover picture" : "No cover picture"}
        </span>
        <Button onClick={() => setLookOpen(true)}>Cover and icon</Button>
      </div>
      <h3>
        Links{" "}
        <span className="muted small">
          {links.length} of {MAX_HUB_LINKS}
        </span>
      </h3>
      {links.length ? (
        <ul className="today-hub-edit">
          {links.map((link, i) => (
            <li key={`${link.kind}:${link.id}`}>
              <span className="today-hub-name" dir="auto">
                {nameOf(link, sources)}
              </span>
              <Input
                aria-label={`Tag for ${link.label}`}
                placeholder={HUB_LINK_KIND_LABELS[link.kind]}
                maxLength={24}
                value={link.tag ?? ""}
                onChange={(event) =>
                  setLinks((list) =>
                    list.map((x, j) =>
                      j === i
                        ? { ...x, tag: event.target.value || undefined }
                        : x,
                    ),
                  )
                }
              />
              <IconButton
                label={`Move ${link.label} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp />
              </IconButton>
              <IconButton
                label={`Move ${link.label} down`}
                disabled={i === links.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown />
              </IconButton>
              <IconButton
                label={`Remove ${link.label}`}
                onClick={() =>
                  setLinks((list) => list.filter((_, j) => j !== i))
                }
              >
                <X />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">
          {hub.auto
            ? "No links chosen: the hub shows your latest ones."
            : "No links yet."}
        </p>
      )}
      <h3>Add a link</h3>
      <div className="today-hub-add">
        <SelectBox
          aria-label="Kind of link"
          value={kind}
          onChange={(event) => setKind(event.target.value as HubLinkKind)}
        >
          <option value="project">Projects</option>
          <option value="deck">Study decks</option>
          <option value="page">Pages</option>
          <option value="view">Views</option>
        </SelectBox>
        <Input
          aria-label="Find one"
          placeholder="Find one…"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
      </div>
      {full ? (
        <p className="muted small">
          A hub holds six links. Remove one to add another.
        </p>
      ) : shown.length ? (
        <ul className="today-hub-pick">
          {shown.slice(0, 40).map((c) => (
            <li key={c.id}>
              <button
                type="button"
                dir="auto"
                onClick={() =>
                  setLinks((list) => [
                    ...list,
                    { kind, id: c.id, label: c.label.slice(0, 80) },
                  ])
                }
              >
                <Plus aria-hidden="true" />
                <span>{c.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Nothing to add here.</p>
      )}
      {error && <ErrorNotice message={error} onRetry={() => void save()} />}
    </Dialog>
  );
}

/** Quick links in the order chosen, or the latest of their kind. */
export function Hubs({
  layout,
  sources,
}: {
  layout: HomeLayout;
  sources: Sources;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const hubs = layout.hubs;
  const [editing, setEditing] = useState<{
    hub: HomeHub;
    isNew: boolean;
  } | null>(null);
  const setHubs = (next: HomeHub[]) => saveHome({ ...layout, hubs: next });
  const quietly = (next: HomeHub[]) =>
    void setHubs(next).catch((e) =>
      toast({ text: messageOf(e, "Couldn't save your hubs."), error: true }),
    );
  const moveHub = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= hubs.length) return;
    const next = [...hubs];
    [next[i], next[j]] = [next[j], next[i]];
    quietly(next);
  };
  return (
    <section aria-label="Hubs" className="today-hubs">
      {hubs.map((hub, i) => {
        const links = linksOf(hub, sources).slice(0, MAX_HUB_LINKS);
        return (
          <article key={hub.id} className="today-hub" aria-label={hub.title}>
            <Cover fileId={hub.cover_file_id} className="today-hub-cover" />
            <header>
              <h3 dir="auto">
                {hub.icon && <LookIcon icon={hub.icon} />}
                <span>{hub.title}</span>
              </h3>
              <Menu
                label={`Options for ${hub.title}`}
                trigger={(open, expanded) => (
                  <IconButton
                    label={`Options for ${hub.title}`}
                    aria-expanded={expanded}
                    onClick={open}
                  >
                    <MoreHorizontal />
                  </IconButton>
                )}
              >
                {(close) => (
                  <>
                    <button
                      onClick={() => {
                        close();
                        setEditing({ hub, isNew: false });
                      }}
                    >
                      Edit hub
                    </button>
                    <button
                      disabled={i === 0}
                      onClick={() => {
                        close();
                        moveHub(i, -1);
                      }}
                    >
                      <ArrowLeft aria-hidden="true" /> Move left
                    </button>
                    <button
                      disabled={i === hubs.length - 1}
                      onClick={() => {
                        close();
                        moveHub(i, 1);
                      }}
                    >
                      <ArrowRight aria-hidden="true" /> Move right
                    </button>
                    <button
                      className="is-danger"
                      onClick={() => {
                        close();
                        void confirm({
                          title: `Remove the ${hub.title} hub?`,
                          body: "Only the hub goes; what it links to stays where it is.",
                          action: "Remove",
                          danger: true,
                        }).then(
                          (yes) =>
                            yes && quietly(hubs.filter((h) => h.id !== hub.id)),
                        );
                      }}
                    >
                      <Trash2 aria-hidden="true" /> Remove hub
                    </button>
                  </>
                )}
              </Menu>
            </header>
            {links.length ? (
              <ul>
                {links.map((link) => (
                  <li key={`${link.kind}:${link.id}`}>
                    <button onClick={() => go(link)}>
                      <span className="today-hub-name" dir="auto">
                        {nameOf(link, sources)}
                      </span>
                      <small>
                        {link.tag || HUB_LINK_KIND_LABELS[link.kind]}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">
                Nothing here yet.{" "}
                <button
                  className="today-inline"
                  onClick={() => setEditing({ hub, isNew: false })}
                >
                  Add links
                </button>
              </p>
            )}
          </article>
        );
      })}
      {hubs.length < MAX_HUBS && (
        <button
          className="today-hub-new"
          onClick={() =>
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
            })
          }
        >
          <Plus aria-hidden="true" /> New hub
        </button>
      )}
      {editing && (
        <EditHub
          hub={editing.hub}
          isNew={editing.isNew}
          sources={sources}
          onClose={() => setEditing(null)}
          onSave={async (hub) => {
            await setHubs(
              editing.isNew
                ? [...hubs, { ...hub, id: newHubId(hubs, hub.title) }]
                : hubs.map((h) => (h.id === hub.id ? hub : h)),
            );
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}
