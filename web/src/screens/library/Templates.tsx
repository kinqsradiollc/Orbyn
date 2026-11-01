import "./Templates.css";
import { useLibraryOwner } from "./lifetime";
import {
  addDays,
  localDateKey,
  type CalendarEntry,
  type Doc,
  type EventNoteRef,
  type PageTemplate,
  type Project,
  HttpError,
} from "@orbyn/core";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { messageOf } from "../../lib/resource";
import { useNavigate } from "../../lib/router";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  type DialogPortalLease,
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
  const navigate = useNavigate();
  const owned = useLibraryOwner(),
    portalLease = useRef<DialogPortalLease | null>(null);
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
  const attemptDetails = useRef<{
    templateId: string;
    input: Parameters<typeof client.usePageTemplate>[1];
  } | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null),
    [unknown, setUnknown] = useState(false);
  const confirming = useRef(false);
  const close = async () => {
    if (
      !owned() ||
      running.current ||
      confirming.current ||
      openingSaved.current
    )
      return;
    if (unknown) {
      setError(
        "The template result is unconfirmed. Keep its original details here; no repeat request will be sent.",
      );
      return;
    }
    confirming.current = true;
    try {
      if (
        !createdId &&
        (title.trim() ||
          projectId ||
          eventId ||
          makeTasks ||
          space ||
          folder !== (folderId ?? "")) &&
        !(await confirm({
          title: "Discard this page setup?",
          body: "No additional page will be created.",
          action: "Discard setup",
          danger: true,
        }))
      )
        return;
      if (owned() && !running.current) onClose();
    } finally {
      confirming.current = false;
    }
  };
  const openingSaved = useRef(false);
  const openSaved = async (id: string) => {
    if (!owned() || openingSaved.current) return;
    openingSaved.current = true;
    setBusy(true);
    try {
      portalLease.current?.retire();
      const result = await navigate(`/app/doc/${id}`);
      if (!owned()) return;
      if (result.kind !== "committed") {
        portalLease.current?.restore();
        setError(
          result.kind === "refused"
            ? `Page saved, but ${result.reason}`
            : "Page saved. Opening it was interrupted; try Open saved page.",
        );
      } else onClose();
    } catch (failure) {
      if (owned()) {
        portalLease.current?.restore();
        setError(messageOf(failure, "Page saved, but it couldn't be opened."));
      }
    } finally {
      openingSaved.current = false;
      if (owned()) setBusy(running.current);
    }
  };

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
        if (!live || !owned()) return;
        const listed = view.entries
          .filter((entry) => entry.kind === "event")
          .sort((a, b) => a.start_at.localeCompare(b.start_at));
        const refs = listed.length
          ? await client.eventNotes(listed.map((entry) => entry.item_id))
          : [];
        if (!live || !owned()) return;
        setTemplates(list);
        setProjects(
          projectRows.filter((project) => project.status === "active"),
        );
        setEvents(listed);
        setNotes(refs);
      } catch (failure) {
        if (live && owned())
          setError(messageOf(failure, "Couldn't load templates."));
      }
    })();
    return () => {
      live = false;
    };
  }, [attempt]);
  const existing = notes.find((note) => note.item_id === eventId);
  const create = async () => {
    if (!owned() || !picked || running.current || unknown || createdId) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const event = events.find((one) => one.item_id === eventId);
      const input = {
        title: title.trim() || undefined,
        team_id: space || null,
        project_id: projectId || null,
        event_id: event ? event.item_id : null,
        ...(event ? { event_at: event.start_at } : {}),
        ...(event?.occurrence ? { occurrence: event.occurrence } : {}),
        folder_id: folder || null,
        make_tasks: makeTasks,
      };
      attemptDetails.current = { templateId: picked.id, input };
      const result = await client.usePageTemplate(picked.id, input);
      if (!owned()) return;
      setCreatedId(result.doc.id);
      void loadLibrary();
      await openSaved(result.doc.id);
      if (!owned()) return;
      toast({
        text: result.existing
          ? "That event already has a note. It's open now."
          : result.tasks_created
            ? `Page created with ${result.tasks_created} tasks.`
            : "Page created.",
      });
    } catch (failure) {
      if (!owned()) return;
      const status = failure instanceof HttpError ? failure.statusCode : 0;
      const uncertain =
        !status || status >= 500 || status === 408 || status === 429;
      setUnknown(uncertain);
      setError(
        uncertain
          ? "The result of this template request is unconfirmed. Its setup is retained; no repeat request will be sent."
          : messageOf(failure, "Couldn't create the page."),
      );
    } finally {
      running.current = false;
      if (owned()) setBusy(false);
    }
  };
  const remove = async (template: PageTemplate) => {
    if (!owned() || running.current || confirming.current || unknown) return;
    confirming.current = true;
    try {
      const ok = await confirm({
        title: `Delete “${template.name}”?`,
        body: "Pages made from it stay as they are.",
        action: "Delete",
        danger: true,
      });
      if (!ok || !owned()) return;
      running.current = true;
      setBusy(true);
      await client.deletePageTemplate(template.id);
      if (!owned()) return;
      setTemplates(
        (all) => all?.filter((one) => one.id !== template.id) ?? all,
      );
    } catch (failure) {
      if (owned())
        setError(
          messageOf(
            failure,
            "Couldn't delete this template. Refresh the template list before trying again.",
          ),
        );
    } finally {
      confirming.current = false;
      running.current = false;
      if (owned()) setBusy(false);
    }
  };

  const writable = teams.filter((team) => canWriteDoc(teams, team.id));
  return (
    <Dialog
      title={picked ? picked.name : "New page from a template"}
      portalLease={portalLease}
      wide
      onClose={() => void close()}
    >
      {error && (
        <ErrorNotice
          message={error}
          onRetry={templates ? undefined : () => setAttempt((n) => n + 1)}
        />
      )}
      {createdId && (
        <p role="status">
          This page is saved.{" "}
          <Button disabled={busy} onClick={() => void openSaved(createdId)}>
            Open saved page
          </Button>
        </p>
      )}
      {unknown && attemptDetails.current && (
        <details>
          <summary>Original request details</summary>
          <pre className="small">
            {JSON.stringify(attemptDetails.current, null, 2)}
          </pre>
        </details>
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
        <fieldset
          className="lib-form lib-template-fields"
          disabled={busy || unknown || createdId !== null}
        >
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
            <Button variant="ghost" onClick={() => void close()}>
              Cancel
            </Button>
            <Button variant="primary" busy={busy} onClick={() => void create()}>
              Create page
            </Button>
          </div>
        </fieldset>
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
