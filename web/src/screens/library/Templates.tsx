import {
  addDays,
  localDateKey,
  type CalendarEntry,
  type Doc,
  type EventNoteRef,
  type PageTemplate,
  type Project,
} from "@orbyn/core";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { messageOf } from "../../lib/resource";
import { navigate } from "../../lib/router";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  IconButton,
  Input,
  Loading,
  TextArea,
  useConfirm,
  useToast,
} from "../../ui/kit";
import { deviceTimeZone } from "../shared-task";
import { canWriteDoc, loadLibrary, useLibraryState } from "./store";

/** Start a page from a template: for a project, an event or just a title. */
export function TemplatesDialog({
  onClose,
  folderId,
}: {
  onClose: () => void;
  folderId: string | null;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const { folders, teams } = useLibraryState();
  const [templates, setTemplates] = useState<PageTemplate[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [events, setEvents] = useState<CalendarEntry[]>([]);
  const [notes, setNotes] = useState<EventNoteRef[]>([]);
  const [picked, setPicked] = useState<PageTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [eventId, setEventId] = useState("");
  const [folder, setFolder] = useState(folderId ?? "");
  const [space, setSpace] = useState("");
  const [makeTasks, setMakeTasks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);
  useEffect(() => {
    let live = true;
    setError("");
    const today = localDateKey(new Date(), deviceTimeZone());
    void (async () => {
      try {
        const [list, projectRows, view] = await Promise.all([
          client.listPageTemplates(),
          client.listProjects(),
          client.calendar(
            new Date(`${addDays(today, -7)}T00:00:00`).toISOString(),
            new Date(`${addDays(today, 15)}T00:00:00`).toISOString(),
          ),
        ]);
        const listed = view.entries
          .filter((entry) => entry.kind === "event")
          .sort((a, b) => a.start_at.localeCompare(b.start_at));
        const refs = listed.length
          ? await client.eventNotes(listed.map((entry) => entry.item_id))
          : [];
        if (!live) return;
        setTemplates(list);
        setProjects(
          projectRows.filter((project) => project.status === "active"),
        );
        setEvents(listed);
        setNotes(refs);
      } catch (failure) {
        if (live) setError(messageOf(failure, "Couldn't load templates."));
      }
    })();
    return () => {
      live = false;
    };
  }, [attempt]);
  const existing = notes.find((note) => note.item_id === eventId);
  const create = async () => {
    if (!picked || running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const event = events.find((one) => one.item_id === eventId);
      const result = await client.usePageTemplate(picked.id, {
        title: title.trim() || undefined,
        team_id: space || null,
        project_id: projectId || null,
        event_id: event ? event.item_id : null,
        ...(event ? { event_at: event.start_at } : {}),
        ...(event?.occurrence ? { occurrence: event.occurrence } : {}),
        folder_id: folder || null,
        make_tasks: makeTasks,
      });
      void loadLibrary();
      onClose();
      navigate(`/app/doc/${result.doc.id}`);
      toast({
        text: result.existing
          ? "That event already has a note. It's open now."
          : result.tasks_created
            ? `Page created with ${result.tasks_created} tasks.`
            : "Page created.",
      });
    } catch (failure) {
      setError(messageOf(failure, "Couldn't create the page."));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const remove = async (template: PageTemplate) => {
    const ok = await confirm({
      title: `Delete “${template.name}”?`,
      body: "Pages made from it stay as they are.",
      action: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await client.deletePageTemplate(template.id);
      setTemplates(
        (all) => all?.filter((one) => one.id !== template.id) ?? all,
      );
    } catch (failure) {
      setError(messageOf(failure, "Couldn't delete this template."));
    }
  };
  const writable = teams.filter((team) => canWriteDoc(teams, team.id));
  return (
    <Dialog
      title={picked ? picked.name : "New page from a template"}
      wide
      onClose={onClose}
    >
      {error && (
        <ErrorNotice
          message={error}
          onRetry={templates ? undefined : () => setAttempt((n) => n + 1)}
        />
      )}
      {!templates && !error && <Loading label="Loading templates" />}
      {templates && !picked && (
        <div className="lib-picklist" role="listbox" aria-label="Templates">
          {!templates.length && (
            <p className="small muted">
              No templates yet. Save a page as a template to start.
            </p>
          )}
          {templates.map((template) => (
            <div key={template.id} className="row">
              <button
                type="button"
                className="row-main lib-pick-template"
                onClick={() => {
                  setPicked(template);
                  setTitle("");
                }}
              >
                <span className="row-title" dir="auto">
                  {template.name}
                </span>
                {template.description && (
                  <span className="small muted" dir="auto">
                    {template.description}
                  </span>
                )}
              </button>
              {template.can_edit && template.source !== "starter" && (
                <IconButton
                  label={`Delete ${template.name}`}
                  onClick={() => void remove(template)}
                >
                  <Trash2 />
                </IconButton>
              )}
            </div>
          ))}
        </div>
      )}
      {picked && (
        <div className="lib-form">
          <Button variant="ghost" onClick={() => setPicked(null)}>
            <ArrowLeft /> All templates
          </Button>
          <Field label="Title">
            <Input
              autoFocus
              value={title}
              maxLength={200}
              dir="auto"
              placeholder={picked.name}
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
          </Field>
          <div className="page-share-options">
            <Field label="Project">
              <select
                className="input"
                value={projectId}
                onChange={(event) => setProjectId(event.currentTarget.value)}
              >
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Event">
              <select
                className="input"
                value={eventId}
                onChange={(event) => setEventId(event.currentTarget.value)}
              >
                <option value="">No event</option>
                {events.map((event) => (
                  <option
                    key={`${event.item_id}:${event.start_at}`}
                    value={event.item_id}
                  >
                    {event.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Folder">
              <select
                className="input"
                value={folder}
                onChange={(event) => setFolder(event.currentTarget.value)}
              >
                <option value="">Unfiled</option>
                {folders
                  .filter(
                    (one) => !one.archived_at && (one.team_id ?? "") === space,
                  )
                  .map((one) => (
                    <option key={one.id} value={one.id}>
                      {one.name}
                    </option>
                  ))}
              </select>
            </Field>
            {writable.length > 0 && (
              <Field label="Space">
                <select
                  className="input"
                  value={space}
                  onChange={(event) => {
                    setSpace(event.currentTarget.value);
                    setFolder("");
                  }}
                >
                  <option value="">Personal</option>
                  {writable.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          <label className="check small">
            <input
              type="checkbox"
              checked={makeTasks}
              onChange={(event) => setMakeTasks(event.currentTarget.checked)}
            />
            Make tasks from its checklist lines
          </label>
          {existing && (
            <p className="small muted">
              This event already has a note. Creating opens it.
            </p>
          )}
          <div className="dialog-actions">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" busy={busy} onClick={() => void create()}>
              Create page
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function SaveTemplateDialog({
  doc,
  onClose,
}: {
  doc: Doc;
  onClose: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(doc.title);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await client.savePageAsTemplate(doc.id, {
        name: name.trim(),
        description: description.trim(),
      });
      toast({ text: "Saved as a template." });
      onClose();
    } catch (failure) {
      setError(messageOf(failure, "Couldn't save this template."));
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Save as template"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!name.trim()}
            onClick={() => void save()}
          >
            Save template
          </Button>
        </>
      }
    >
      {error && <ErrorNotice message={error} />}
      <Field label="Name">
        <Input
          autoFocus
          dir="auto"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </Field>
      <Field label="Description">
        <TextArea
          dir="auto"
          value={description}
          onChange={(event) => setDescription(event.currentTarget.value)}
        />
      </Field>
    </Dialog>
  );
}
