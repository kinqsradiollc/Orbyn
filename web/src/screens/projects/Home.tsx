import {
  MAX_ALIASES,
  deadlineOf,
  type DocSummary,
  type Item,
  type Project,
  type ProjectLink,
  type ProjectSession,
  type TeamMember,
  type WorkRecord,
} from "@orbyn/core";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { messageOf } from "../../lib/resource";
import { navigate } from "../../lib/router";
import { client } from "../../lib/session";
import { Button, ErrorNotice, Input, useToast } from "../../ui/kit";
import { tasks } from "../shared-task";
import { FieldsPanel } from "../views/Fields";
import { Milestones } from "./Milestones";
import { LinkedHere_, Related } from "./Related";
import { shortDate } from "./shared";

function Aliases({
  aliases,
  canWrite,
  onSave,
}: {
  aliases: string[];
  canWrite: boolean;
  onSave: (next: string[]) => Promise<string[]>;
}) {
  const [list, setList] = useState(aliases);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setList(aliases), [aliases]);
  const save = async (next: string[], added = false) => {
    if (busy || !canWrite) return;
    setBusy(true);
    setError("");
    try {
      setList(await onSave(next));
      if (added) setTyped("");
    } catch {
      setError("Couldn't save names. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const add = () => {
    const next = typed.trim();
    if (!next) return;
    if (list.some((a) => a.toLowerCase() === next.toLowerCase()))
      return setTyped("");
    void save([...list, next], true);
  };
  return (
    <div className="pj-aliases">
      {list.map((alias) => (
        <span key={alias} className="pill" dir="auto">
          {alias}
          {canWrite && (
            <button
              aria-label={`Remove ${alias}`}
              disabled={busy}
              onClick={() => void save(list.filter((x) => x !== alias))}
            >
              <X aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
      {canWrite && list.length < MAX_ALIASES && (
        <Input
          value={typed}
          placeholder={
            list.length ? "Add another" : "Add another name, like COMP3100"
          }
          aria-label="Add another name"
          maxLength={80}
          disabled={busy}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== ",") return;
            event.preventDefault();
            add();
          }}
          onBlur={add}
        />
      )}
      {error && <ErrorNotice message={error} />}
    </div>
  );
}

export type HomeData = {
  notes: DocSummary[];
  records: WorkRecord[];
  links: ProjectLink[];
};

/** A project at rest: what's next, what's written and who's in it. */
export function Home({
  project,
  items,
  sessions,
  data,
  members,
  canWrite,
  busy,
  onItemsChanged,
  onChanged,
  onLinks,
  onMode,
  onNewPage,
  onBrief,
  onFiles,
  uploadBusy,
  linkDraft,
}: {
  project: Project;
  items: Item[];
  sessions: ProjectSession[];
  data: HomeData | undefined;
  members: TeamMember[];
  canWrite: boolean;
  busy: boolean;
  onItemsChanged: () => void;
  onChanged: (project: Project) => void;
  onLinks: (next: ProjectLink[]) => void;
  onMode: (mode: "notes" | "decisions") => void;
  onNewPage: () => void;
  onBrief: () => void;
  onFiles: (files: File[]) => void;
  uploadBusy: boolean;
  linkDraft: { current: boolean };
}) {
  const toast = useToast();
  const [addingLink, setAddingLink] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [linkError, setLinkError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  linkDraft.current = !!url.trim() || !!title.trim();
  const mine = items.filter((i) => i.project_id === project.id);
  const dueOf = (i: Item) => deadlineOf(i);
  const coming = mine
    .filter(
      (i) =>
        i.kind === "task" && i.status !== "done" && i.status !== "cancelled",
    )
    .sort(
      (a, b) =>
        Date.parse(dueOf(a) ?? project.deadline ?? "9999-12-31") -
        Date.parse(dueOf(b) ?? project.deadline ?? "9999-12-31"),
    )
    .slice(0, 5);
  const week = sessions
    .filter(
      (s) =>
        Date.parse(s.start_at) >= Date.now() &&
        Date.parse(s.start_at) < Date.now() + 7 * 86_400_000,
    )
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .slice(0, 7);
  const links = data?.links ?? [];
  const notes = data?.notes ?? [];
  const questions = (data?.records ?? []).filter(
    (r) =>
      r.status === "open" &&
      ((r.kind === "decision" && !r.linked_item_id) ||
        (r.kind === "promise" &&
          r.due_at &&
          Date.parse(r.due_at) < Date.now() + 7 * 86_400_000)),
  );
  const saveLink = async () => {
    if (!canWrite || !url.trim() || saving) return;
    setSaving(true);
    setLinkError("");
    try {
      await client.addProjectLink(project.id, {
        url: url.trim(),
        title: title.trim(),
      });
      onLinks(await client.listProjectLinks(project.id));
      setUrl("");
      setTitle("");
      setAddingLink(false);
    } catch (failure) {
      setLinkError(
        messageOf(failure, "Couldn't save the link. It's still here."),
      );
    } finally {
      setSaving(false);
    }
  };
  const removeLink = async (id: string) => {
    if (saving) return;
    setSaving(true);
    try {
      await client.removeProjectLink(project.id, id);
      onLinks(links.filter((l) => l.id !== id));
    } catch (failure) {
      toast({
        text: messageOf(failure, "Couldn't remove the link."),
        error: true,
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="pj-home">
      <div className="pj-home-main">
        <Milestones
          projectId={project.id}
          items={mine}
          canWrite={canWrite}
          onChanged={onItemsChanged}
          refreshKey={sessions}
        />
        {coming.length > 0 && (
          <section className="pj-block">
            <h3>Coming due</h3>
            <ul className="pj-lines">
              {coming.map((item) => (
                <li key={item.id}>
                  <button
                    className="pj-link"
                    dir="auto"
                    onClick={() => tasks.open(item)}
                  >
                    {item.title}
                  </button>
                  <small>
                    {dueOf(item)
                      ? shortDate(dueOf(item)!)
                      : project.deadline
                        ? `No deadline · project ends ${shortDate(project.deadline)}`
                        : "No deadline"}
                  </small>
                </li>
              ))}
            </ul>
          </section>
        )}
        {week.length > 0 && (
          <section className="pj-block">
            <h3>Next 7 days</h3>
            <ul className="pj-lines">
              {week.map((session) => {
                const item = items.find((t) => t.id === session.item_id);
                return (
                  <li key={session.id}>
                    {item ? (
                      <button
                        className="pj-link"
                        dir="auto"
                        onClick={() => tasks.open(item)}
                      >
                        {item.title}
                      </button>
                    ) : (
                      <span>Session</span>
                    )}
                    <small>
                      {new Date(session.start_at).toLocaleString([], {
                        weekday: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </small>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {(notes.length > 0 || links.length > 0 || canWrite) && (
          <section className="pj-block">
            <h3>Pages &amp; files</h3>
            <ul className="pj-lines">
              {links.map((link) => (
                <li key={link.id}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    dir="auto"
                  >
                    {link.title || link.url}
                  </a>
                  {canWrite && (
                    <Button
                      variant="ghost"
                      disabled={saving}
                      aria-label={`Remove ${link.title || link.url}`}
                      onClick={() => void removeLink(link.id)}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
              {notes.slice(0, 5).map((note) => (
                <li key={note.id}>
                  <button
                    className="pj-link"
                    dir="auto"
                    onClick={() => navigate(`/app/doc/${note.id}`)}
                  >
                    {note.title || "Untitled"}
                  </button>
                  {note.preview && <small dir="auto">{note.preview}</small>}
                </li>
              ))}
            </ul>
            {addingLink && canWrite && (
              <div className="pj-link-form">
                <Input
                  ref={input}
                  autoFocus
                  disabled={saving}
                  value={url}
                  placeholder="https://…"
                  aria-label="Link URL"
                  maxLength={2000}
                  onChange={(event) => setUrl(event.target.value)}
                />
                <Input
                  disabled={saving}
                  value={title}
                  placeholder="Title (optional)"
                  aria-label="Link title"
                  maxLength={200}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <Button
                  busy={saving}
                  disabled={!url.trim()}
                  onClick={() => void saveLink()}
                >
                  Save link
                </Button>
                <Button
                  variant="ghost"
                  disabled={saving}
                  onClick={() => setAddingLink(false)}
                >
                  Cancel
                </Button>
                {linkError && <ErrorNotice message={linkError} />}
              </div>
            )}
            <div className="pj-row-wrap">
              {notes.length > 0 && (
                <Button variant="ghost" onClick={() => onMode("notes")}>
                  All pages &amp; files
                </Button>
              )}
              {canWrite && (
                <Button variant="ghost" disabled={busy} onClick={onNewPage}>
                  New page
                </Button>
              )}
              {canWrite && links.length < 20 && !addingLink && (
                <Button variant="ghost" onClick={() => setAddingLink(true)}>
                  Add link
                </Button>
              )}
              {canWrite && (
                <FilePick busy={busy || uploadBusy} onFiles={onFiles} />
              )}
            </div>
          </section>
        )}
        {questions.length > 0 && (
          <section className="pj-block">
            <h3>Open questions</h3>
            <ul className="pj-lines">
              {questions.slice(0, 5).map((r) => (
                <li key={r.id}>
                  <span dir="auto">{r.title}</span>
                  <small>
                    {r.kind === "decision" ? "Decision" : "Promise due soon"}
                  </small>
                </li>
              ))}
            </ul>
            <Button variant="ghost" onClick={() => onMode("decisions")}>
              All decisions
            </Button>
          </section>
        )}
      </div>
      <aside className="pj-home-aside" aria-label="Project details">
        {(project.doc_id || canWrite) && (
          <section className="pj-side">
            <h3>Brief</h3>
            {project.doc_id ? (
              <Button onClick={() => navigate(`/app/doc/${project.doc_id}`)}>
                Open brief
              </Button>
            ) : (
              <Button disabled={busy} onClick={onBrief}>
                Write a brief
              </Button>
            )}
          </section>
        )}
        {members.length > 0 && (
          <section className="pj-side" aria-label="Members">
            <h3>Members</h3>
            <ul className="pj-members">
              {members.map((member) => (
                <li key={member.user_id}>
                  <span className="pj-avatar" aria-hidden="true">
                    {(member.name || "?").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="pj-grow" dir="auto">
                    {member.name}
                  </span>
                  <small>{member.role}</small>
                </li>
              ))}
            </ul>
            <Button
              variant="ghost"
              onClick={() => navigate(`/app/teams?team=${project.team_id}`)}
            >
              Manage in Teams
            </Button>
          </section>
        )}
        {(canWrite || (project.aliases ?? []).length > 0) && (
          <section className="pj-side">
            <h3>Also called</h3>
            <Aliases
              aliases={project.aliases ?? []}
              canWrite={canWrite}
              onSave={async (aliases) => {
                const next = await client.updateProject(project.id, {
                  aliases,
                });
                onChanged(next);
                return next.aliases ?? aliases;
              }}
            />
          </section>
        )}
        <FieldsPanel
          target="project"
          targetId={project.id}
          revision={project.updated_at}
        />
        <LinkedHere_ id={project.id} />
      </aside>
      <div className="pj-home-wide">
        <Related id={project.id} revision={project.updated_at} />
      </div>
    </div>
  );
}

function FilePick({
  busy,
  onFiles,
}: {
  busy: boolean;
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        variant="ghost"
        disabled={busy}
        title="Import a PDF, Word file or photo of notes"
        onClick={() => input.current?.click()}
      >
        {busy ? "Uploading…" : "Add a file"}
      </Button>
      <input
        ref={input}
        hidden
        multiple
        type="file"
        aria-label="Choose files to import"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}
