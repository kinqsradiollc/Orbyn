import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "../../../motion";
import {
  addDays,
  blankDate,
  blanksIn,
  eventNoteFor,
  fillTitle,
  hasTeamPermission,
  localDateKey,
  seriesNoteFor,
  templateTodos,
  type CalendarEntry,
  type Doc,
  type EventNoteRef,
  type Folder,
  type PageTemplate,
  type Project,
  type Team,
} from "@orbyn/core";
import { BottomSheet } from "../../../components/BottomSheet";
import { InlineDetails } from "../../../components/InlineDetails";
import { Button } from "../../../components/Button";
import { Chip, ChipRow } from "../../../components/Chip";
import { Icon } from "../../../components/Icon";
import { MoreMenu } from "../../../components/MoreMenu";
import { SmallAction } from "../../../components/SmallAction";
import { Switch } from "../../../components/Switch";
import { client } from "../../../lib/api";
import { confirmAction } from "../../../lib/confirm";
import { errorText } from "../../../lib/errors";
import { deviceTimeZone } from "../../planner/planning";
import { shared } from "../../../styles";
import { colors, fonts, radii, themed } from "../../../theme";

/** One time of an event: a repeating one is the same event many times. */
const eventKey = (e: CalendarEntry) => `${e.item_id}|${e.start_at}`;

const eventLabel = (e: CalendarEntry) =>
  `${new Date(e.start_at).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })} · ${e.title}`;

/** What a template holds, in a few words, for its row. */
function summary(t: PageTemplate) {
  const todos = templateTodos(t.content);
  return [
    todos ? `${todos} to-do${todos === 1 ? "" : "s"}` : "",
    t.folder_name ? `Files in ${t.folder_name}` : "",
    t.tags.length ? t.tags.map((g) => `#${g.name}`).join(" ") : "",
    t.team_name ?? "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Which space a page goes in: "" for your own, or a team's id. */
type Space = string;

/**
 * Where a page from `t` goes to begin with: a team template's team, else
 * the team of the folder being looked at, else your own pages — only ever
 * a space you can write in.
 */
function startingSpace(
  t: PageTemplate,
  here: Folder | undefined,
  writable: Team[],
): Space {
  const can = (id: string | null | undefined) =>
    !!id && writable.some((team) => team.id === id);
  if (can(t.team_id)) return t.team_id!;
  if (can(here?.team_id)) return here!.team_id!;
  return "";
}

/**
 * New page from a template, on the phone: pick one, name the page, choose
 * where it goes (your pages or a team's), its project, event and folder,
 * and whether its to-dos become tasks.
 */
export function PageTemplatesPanel({
  folders,
  folderId,
  onCreated,
  onCancel,
}: {
  folders: Folder[];
  folderId: string | null;
  onCreated: (doc: Doc, note: string, tasks: number) => void;
  onCancel: () => void;
}) {
  const mutation = useRef(false);
  const request = useRef(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [templates, setTemplates] = useState<PageTemplate[] | null>(null);
  const [picked, setPicked] = useState<PageTemplate | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [events, setEvents] = useState<CalendarEntry[]>([]);
  const [title, setTitle] = useState("");
  const [named, setNamed] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [eventId, setEventId] = useState("");
  const [folder, setFolder] = useState("");
  const [makeTasks, setMakeTasks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Teams whose pages you can write: the other places a page can go. */
  const [teams, setTeams] = useState<Team[]>([]);
  const [space, setSpace] = useState<Space>("");
  /** The notes the listed events have, which open instead of a new page. */
  const [notes, setNotes] = useState<EventNoteRef[]>([]);

  const load = async () => {
    const epoch = ++request.current;
    setLoadFailed(false);
    setError("");
    const today = localDateKey(new Date(), deviceTimeZone());
    try {
      const [nextTemplates, nextProjects, nextTeams, view] = await Promise.all([
        client.listPageTemplates(),
        client.listProjects(),
        client.listTeams(),
        client.calendar(
          new Date(`${addDays(today, -3)}T00:00:00`).toISOString(),
          new Date(`${addDays(today, 8)}T00:00:00`).toISOString(),
        ),
      ]);
      const listed = view.entries
        .filter((event) => event.kind === "event")
        .sort((a, b) => a.start_at.localeCompare(b.start_at));
      const nextNotes = listed.length
        ? await client.eventNotes(listed.map((event) => event.item_id))
        : [];
      if (epoch !== request.current) return;
      setTemplates(nextTemplates);
      setProjects(
        nextProjects.filter((project) => project.status === "active"),
      );
      setTeams(
        nextTeams.filter((team) => hasTeamPermission(team.role, "items:write")),
      );
      setEvents(listed);
      setNotes(nextNotes);
      setLoaded(true);
    } catch (reason) {
      if (epoch === request.current) {
        setLoadFailed(true);
        setError(errorText(reason));
      }
    }
  };
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, []);

  const team = space || null;
  const inSpace = (x: { team_id?: string | null }) =>
    (x.team_id ?? null) === team;
  const event = events.find((e) => eventKey(e) === eventId && inSpace(e));
  /** Whether an event (this class of it) has a note, which opens instead. */
  const noted = (e: CalendarEntry) => !!eventNoteFor(notes, e);
  /** The note the chosen event already has: choosing it opens that note. */
  const opens = event ? eventNoteFor(notes, event) : undefined;
  /**
   * On one class of a repeating event, the note the whole series keeps
   * (a running note, or one written before classes had their own): the
   * class gets a page of its own, and this says the series' is still there.
   */
  const seriesNote = event && !opens ? seriesNoteFor(notes, event) : undefined;
  const project = projects.find((p) => p.id === projectId && inSpace(p));
  const usesEvent = picked ? blanksIn(picked).includes("event") : false;
  const todos = picked ? templateTodos(picked.content) : 0;
  const suggested = useMemo(
    () =>
      picked
        ? fillTitle(
            picked.title,
            {
              date: blankDate(
                event ? new Date(event.start_at) : new Date(),
                deviceTimeZone(),
              ),
              project: project?.name ?? "",
              event: event?.title ?? "",
            },
            picked.name,
          ) || picked.name
        : "",
    [picked, event, project],
  );
  useEffect(() => {
    if (!named) setTitle(suggested);
  }, [suggested, named]);

  /**
   * The folder a page starts in, in `to`: the template's own when it's
   * there, else the folder being looked at when it's there, else none.
   */
  const startingFolder = (t: PageTemplate, to: Space) => {
    const fits = (id: string | null | undefined) =>
      !!id && folders.some((f) => f.id === id && (f.team_id ?? "") === to);
    if (fits(t.folder_id)) return t.folder_id!;
    if (fits(folderId)) return folderId!;
    return "";
  };

  const choose = (t: PageTemplate) => {
    const to = startingSpace(
      t,
      folders.find((f) => f.id === folderId),
      teams,
    );
    setPicked(t);
    setNamed(false);
    setProjectId("");
    setEventId("");
    setMakeTasks(false);
    setSpace(to);
    setFolder(startingFolder(t, to));
    setError("");
  };

  /** Move the page to another space; choices from the old one go. */
  const moveTo = (to: Space) => {
    if (!picked) return;
    setSpace(to);
    setProjectId("");
    setEventId("");
    setMakeTasks(false);
    setFolder(startingFolder(picked, to));
  };

  const create = () => {
    if (!picked || !loaded || loadFailed || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    client
      .usePageTemplate(picked.id, {
        title: title.trim() || undefined,
        team_id: team,
        project_id: project?.id ?? null,
        event_id: event ? event.item_id : null,
        ...(event ? { event_at: event.start_at } : {}),
        ...(event?.occurrence ? { occurrence: event.occurrence } : {}),
        folder_id: folder || null,
        make_tasks: makeTasks,
      })
      .then(
        ({ doc, tasks_created, existing }) =>
          onCreated(
            doc,
            existing
              ? `“${event?.title ?? doc.title}” already has a note, so it’s open.`
              : tasks_created
                ? `Made from ${picked.name}. ${tasks_created} to-do${tasks_created === 1 ? " is" : "s are"} now ${tasks_created === 1 ? "a task" : "tasks"}${project ? ` in ${project.name}` : ""}.`
                : `Made from ${picked.name}.`,
            tasks_created,
          ),
        (e: Error) => setError(errorText(e)),
      )
      .finally(() => {
        mutation.current = false;
        setBusy(false);
      });
  };

  const remove = (t: PageTemplate) =>
    confirmAction(
      `Delete the template “${t.name}”?`,
      "Pages made from it stay as they are.",
      "Delete",
      () => {
        if (mutation.current || !t.can_edit) return;
        mutation.current = true;
        setBusy(true);
        client
          .deletePageTemplate(t.id)
          .then(
            () => {
              setPicked(null);
              return load();
            },
            (e: Error) => setError(errorText(e)),
          )
          .finally(() => {
            mutation.current = false;
            setBusy(false);
          });
      },
    );

  return (
    <View style={s.panel}>
      <View style={s.head}>
        {picked && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="All templates"
            disabled={busy}
            hitSlop={10}
            onPress={() => setPicked(null)}
            style={s.back}
          >
            <Icon name="chevronLeft" size={18} color={colors.muted} />
          </Pressable>
        )}
        <Text style={s.title} accessibilityRole="header">
          {picked ? picked.name : "From a template"}
        </Text>
        {picked?.can_edit && (
          <MoreMenu
            label="Template options"
            disabled={busy}
            actions={[
              {
                label: "Delete template",
                destructive: true,
                onPress: () => remove(picked),
              },
            ]}
          />
        )}
        <SmallAction label="Cancel" disabled={busy} onPress={onCancel} />
      </View>
      {!!error && (
        <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
      {loadFailed && (
        <SmallAction
          label="Retry"
          disabled={busy}
          onPress={() => void load()}
        />
      )}
      {!picked && loaded && templates?.length === 0 && (
        <Text style={shared.small}>No templates yet.</Text>
      )}
      {!picked ? (
        templates === null ? (
          !loadFailed && <Text style={shared.small}>Loading…</Text>
        ) : (
          (
            [
              ["personal", "Yours"],
              ["team", "Your teams"],
              ["starter", "Starters"],
            ] as const
          ).map(([source, label]) => {
            const list = templates.filter((t) => t.source === source);
            if (!list.length) return null;
            return (
              <View key={source} style={s.group}>
                <Text style={s.name}>{label}</Text>
                {list.map((t) => (
                  <Pressable
                    key={t.id}
                    accessibilityRole="button"
                    accessibilityLabel={t.name}
                    disabled={busy || !loaded || loadFailed}
                    onPress={() => choose(t)}
                    style={({ pressed }) => [s.card, pressed && s.pressed]}
                  >
                    <Icon
                      name="layoutTemplate"
                      size={17}
                      color={colors.accent}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={s.name}>{t.name}</Text>
                      {!!t.description && (
                        <Text style={shared.small}>{t.description}</Text>
                      )}
                      {!!summary(t) && <Text style={s.meta}>{summary(t)}</Text>}
                    </View>
                    <Icon name="chevronRight" size={16} color={colors.muted} />
                  </Pressable>
                ))}
              </View>
            );
          })
        )
      ) : (
        <View style={s.form}>
          {!opens && (
            <View>
              <Text style={shared.label}>Title</Text>
              <TextInput
                style={shared.input}
                editable={!busy}
                value={title}
                maxLength={200}
                onChangeText={(text) => {
                  setTitle(text);
                  setNamed(true);
                }}
                accessibilityLabel="Title"
              />
            </View>
          )}
          {teams.length > 0 && (
            <View>
              <Text style={shared.label}>Where</Text>
              <ChipRow label="Where">
                <Chip
                  disabled={busy}
                  label="Your pages"
                  selected={!space}
                  onPress={() => moveTo("")}
                />
                {teams.map((t) => (
                  <Chip
                    disabled={busy}
                    key={t.id}
                    label={t.name}
                    selected={space === t.id}
                    onPress={() => moveTo(t.id)}
                  />
                ))}
              </ChipRow>
            </View>
          )}
          {!opens && (
            <View>
              <InlineDetails title={`Project: ${project?.name ?? "None"}`}>
                <ChipRow label="Project">
                  <Chip
                    disabled={busy}
                    label="None"
                    selected={!project}
                    onPress={() => {
                      setProjectId("");
                      setMakeTasks(false);
                    }}
                  />
                  {projects.filter(inSpace).map((p) => (
                    <Chip
                      disabled={busy}
                      key={p.id}
                      label={p.name}
                      selected={projectId === p.id}
                      onPress={() => setProjectId(p.id)}
                    />
                  ))}
                </ChipRow>
              </InlineDetails>
            </View>
          )}
          {usesEvent && (
            <View>
              <Text style={shared.label}>Event</Text>
              <ChipRow label="Event">
                <Chip
                  disabled={busy}
                  label="None"
                  selected={!event}
                  onPress={() => setEventId("")}
                />
                {events.filter(inSpace).map((e) => (
                  <Chip
                    disabled={busy}
                    key={eventKey(e)}
                    label={`${eventLabel(e)}${noted(e) ? " · has a note" : ""}`}
                    selected={eventId === eventKey(e)}
                    onPress={() => setEventId(eventKey(e))}
                  />
                ))}
              </ChipRow>
              {!!opens && (
                <Text style={[shared.small, s.noted]}>
                  This event already has a note
                  {event?.occurrence ? " for this day" : ""}, “
                  {opens.title || "Untitled"}”. It opens instead of a new page.
                </Text>
              )}
              {!!seriesNote && (
                <Text style={[shared.small, s.noted]}>
                  The series has a note of its own too, “
                  {seriesNote.title || "Untitled"}”. This page is for this day.
                </Text>
              )}
            </View>
          )}
          {!opens && (
            <View>
              <InlineDetails
                title={`Folder: ${folders.find((value) => value.id === folder)?.name ?? "Unfiled"}`}
              >
                <ChipRow label="Folder">
                  <Chip
                    disabled={busy}
                    label="Unfiled"
                    selected={!folder}
                    onPress={() => setFolder("")}
                  />
                  {folders
                    .filter((f) => (f.team_id ?? "") === space)
                    .map((f) => (
                      <Chip
                        disabled={busy}
                        key={f.id}
                        label={f.name}
                        selected={folder === f.id}
                        onPress={() => setFolder(f.id)}
                      />
                    ))}
                </ChipRow>
              </InlineDetails>
            </View>
          )}
          {todos > 0 && !opens && (
            <View style={s.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>
                  Create {todos} task{todos === 1 ? "" : "s"}
                </Text>
                <Text style={shared.small}>
                  {project
                    ? `In ${project.name}. Ticking one on the page ticks the task.`
                    : `In your tasks. Choose a project to put ${todos === 1 ? "it" : "them"} there.`}
                </Text>
              </View>
              <Switch
                disabled={busy}
                value={makeTasks}
                onValueChange={setMakeTasks}
                trackColor={{ true: colors.accent }}
                accessibilityLabel="Make the to-dos tasks"
              />
            </View>
          )}
          {opens ? (
            <Button
              title={busy ? "Opening…" : "Open note"}
              icon="fileText"
              disabled={busy || !loaded || loadFailed}
              onPress={create}
            />
          ) : (
            <Button
              title={busy ? "Making…" : "Create page"}
              icon="plus"
              disabled={busy || !loaded || loadFailed}
              onPress={create}
            />
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Save the open page as a template, on the phone. A team page makes a
 * template for the team unless you keep it as your own.
 */
export function SaveTemplatePanel(
  props: Parameters<typeof SaveTemplateBody>[0],
) {
  return <SaveTemplateBody key={props.doc.id} {...props} />;
}

function SaveTemplateBody({
  doc,
  canShare,
  onClose,
  onSaved,
}: {
  doc: Pick<Doc, "id" | "title" | "team_id" | "team_name">;
  /** Whether a team page's template may be the team's (you can write there). */
  canShare: boolean;
  onClose: () => void;
  onSaved: (t: PageTemplate) => void;
}) {
  const mutation = useRef(false);
  const [name, setName] = useState(doc.title || "");
  const [shareWithTeam, setShareWithTeam] = useState(canShare);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = () => {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    client
      .savePageAsTemplate(doc.id, {
        name: name.trim() || undefined,
        personal: !!doc.team_id && !shareWithTeam,
      })
      .then(
        (t) => {
          onSaved(t);
          onClose();
        },
        (e: Error) => setError(errorText(e)),
      )
      .finally(() => {
        mutation.current = false;
        setBusy(false);
      });
  };
  return (
    <BottomSheet
      visible
      title="Save as template"
      onClose={() => {
        if (!mutation.current) onClose();
      }}
    >
      <View style={s.savePanel}>
        <TextInput
          style={shared.input}
          editable={!busy}
          value={name}
          maxLength={120}
          placeholder="Untitled"
          placeholderTextColor={colors.faint}
          onChangeText={setName}
          accessibilityLabel="Template name"
        />
        <InlineDetails title="Template placeholders">
          <Text style={shared.small}>
            Use {"{date}"}, {"{title}"}, {"{project}"} or {"{event}"} for values
            filled when creating a page.
          </Text>
        </InlineDetails>
        {!!doc.team_id && !canShare && (
          <Text style={shared.small}>
            Saved to your templates. You have read-only access to{" "}
            {doc.team_name ?? "this team"}.
          </Text>
        )}
        {!!doc.team_id && canShare && (
          <View style={s.switchRow}>
            <Text style={[s.name, { flex: 1 }]}>
              Share with {doc.team_name ?? "the team"}
            </Text>
            <Switch
              disabled={busy}
              value={shareWithTeam}
              onValueChange={setShareWithTeam}
              trackColor={{ true: colors.accent }}
              accessibilityLabel="Share with the team"
            />
          </View>
        )}
        {!!error && <Text style={s.error}>{error}</Text>}
        <View style={s.saveActions}>
          <SmallAction label="Cancel" disabled={busy} onPress={onClose} />
          <SmallAction
            label={busy ? "Saving…" : "Save template"}
            disabled={busy}
            onPress={save}
          />
        </View>
      </View>
    </BottomSheet>
  );
}

const s = themed(() =>
  StyleSheet.create({
    panel: { gap: 12 },
    head: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
    },
    back: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    title: {
      flex: 1,
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
    },
    group: { gap: 8, marginBottom: 6 },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 14,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    pressed: { backgroundColor: colors.surfaceMuted },
    name: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    meta: {
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.muted,
      marginTop: 2,
    },
    form: { gap: 14 },
    switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    noted: { marginTop: 6 },
    error: { color: colors.danger, fontSize: 13 },
    savePanel: {
      gap: 10,
      paddingVertical: 8,
    },
    saveActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "flex-end",
      gap: 8,
    },
  }),
);
