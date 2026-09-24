import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  addDays,
  blankDate,
  blanksIn,
  fillTitle,
  localDateKey,
  templateTodos,
  type CalendarEntry,
  type Doc,
  type Folder,
  type PageTemplate,
  type Project,
} from "@orbyn/core";
import { Button } from "../../components/Button";
import { Chip, ChipRow } from "../../components/Chip";
import { Icon } from "../../components/Icon";
import { SmallAction } from "../../components/SmallAction";
import { Switch } from "../../components/Switch";
import { client } from "../../lib/api";
import { confirmAction } from "../../lib/confirm";
import { errorText } from "../../lib/errors";
import { deviceTimeZone } from "../../lib/planning";
import { shared } from "../../styles";
import { colors, fonts, radii, themed } from "../../theme";

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

/**
 * New page from a template, on the phone: pick one, name the page, choose
 * its project, event and folder, and whether its to-dos become tasks.
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

  const load = () =>
    client.listPageTemplates().then(setTemplates, (e: Error) => {
      setTemplates([]);
      setError(errorText(e));
    });
  useEffect(() => {
    void load();
    client.listProjects().then(
      (all) => setProjects(all.filter((p) => p.status === "active")),
      () => setProjects([]),
    );
    const today = localDateKey(new Date(), deviceTimeZone());
    client
      .calendar(
        new Date(`${addDays(today, -3)}T00:00:00`).toISOString(),
        new Date(`${addDays(today, 8)}T00:00:00`).toISOString(),
      )
      .then(
        (view) =>
          setEvents(
            view.entries
              .filter((e) => e.kind === "event")
              .sort((a, b) => a.start_at.localeCompare(b.start_at)),
          ),
        () => setEvents([]),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const space = picked?.team_id ?? null;
  const event = events.find(
    (e) => eventKey(e) === eventId && e.team_id === space,
  );
  const project = projects.find((p) => p.id === projectId);
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

  const choose = (t: PageTemplate) => {
    setPicked(t);
    setNamed(false);
    setProjectId("");
    setEventId("");
    setMakeTasks(false);
    const here = folders.find((f) => f.id === folderId);
    setFolder(
      t.folder_id ??
        (here && (here.team_id ?? null) === (t.team_id ?? null) ? here.id : ""),
    );
    setError("");
  };

  const create = () => {
    if (!picked) return;
    setBusy(true);
    setError("");
    client
      .usePageTemplate(picked.id, {
        title: title.trim() || undefined,
        project_id: projectId || null,
        event_id: event ? event.item_id : null,
        ...(event ? { event_at: event.start_at } : {}),
        folder_id: folder || null,
        make_tasks: makeTasks,
      })
      .then(
        ({ doc, tasks_created }) =>
          onCreated(
            doc,
            tasks_created
              ? `Made from ${picked.name}. ${tasks_created} to-do${tasks_created === 1 ? " is" : "s are"} now ${tasks_created === 1 ? "a task" : "tasks"}${project ? ` in ${project.name}` : ""}.`
              : `Made from ${picked.name}.`,
            tasks_created,
          ),
        (e: Error) => setError(errorText(e)),
      )
      .finally(() => setBusy(false));
  };

  const remove = (t: PageTemplate) =>
    confirmAction(
      `Delete the template “${t.name}”?`,
      "Pages made from it stay as they are.",
      "Delete",
      () => {
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
          .finally(() => setBusy(false));
      },
    );

  return (
    <View style={s.panel}>
      <View style={s.head}>
        {picked && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="All templates"
            hitSlop={10}
            onPress={() => setPicked(null)}
            style={s.back}
          >
            <Icon name="chevronLeft" size={18} color={colors.muted} />
          </Pressable>
        )}
        <Text style={s.title} accessibilityRole="header" numberOfLines={1}>
          {picked ? picked.name : "From a template"}
        </Text>
        <SmallAction label="Cancel" disabled={false} onPress={onCancel} />
      </View>
      {!!error && <Text style={s.error}>{error}</Text>}
      {!picked ? (
        templates === null ? (
          <Text style={shared.small}>Loading…</Text>
        ) : (
          (
            [
              ["personal", "YOURS"],
              ["team", "YOUR TEAMS’"],
              ["starter", "STARTERS"],
            ] as const
          ).map(([source, label]) => {
            const list = templates.filter((t) => t.source === source);
            if (!list.length) return null;
            return (
              <View key={source} style={s.group}>
                <Text style={shared.eyebrow}>{label}</Text>
                {list.map((t) => (
                  <Pressable
                    key={t.id}
                    accessibilityRole="button"
                    accessibilityLabel={t.name}
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
                        <Text style={shared.small} numberOfLines={2}>
                          {t.description}
                        </Text>
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
          <View>
            <Text style={shared.label}>Title</Text>
            <TextInput
              style={shared.input}
              value={title}
              maxLength={200}
              onChangeText={(text) => {
                setTitle(text);
                setNamed(true);
              }}
              accessibilityLabel="Title"
            />
          </View>
          <View>
            <Text style={shared.label}>Project</Text>
            <ChipRow label="Project">
              <Chip
                label="None"
                selected={!projectId}
                onPress={() => {
                  setProjectId("");
                  setMakeTasks(false);
                }}
              />
              {projects
                .filter((p) => (p.team_id ?? null) === space)
                .map((p) => (
                  <Chip
                    key={p.id}
                    label={p.name}
                    selected={projectId === p.id}
                    onPress={() => setProjectId(p.id)}
                  />
                ))}
            </ChipRow>
          </View>
          {usesEvent && (
            <View>
              <Text style={shared.label}>Event</Text>
              <ChipRow label="Event">
                <Chip
                  label="None"
                  selected={!event}
                  onPress={() => setEventId("")}
                />
                {events
                  .filter((e) => e.team_id === space)
                  .slice(0, 12)
                  .map((e) => (
                    <Chip
                      key={eventKey(e)}
                      label={eventLabel(e)}
                      selected={eventId === eventKey(e)}
                      onPress={() => setEventId(eventKey(e))}
                    />
                  ))}
              </ChipRow>
            </View>
          )}
          <View>
            <Text style={shared.label}>Folder</Text>
            <ChipRow label="Folder">
              <Chip
                label="Unfiled"
                selected={!folder}
                onPress={() => setFolder("")}
              />
              {folders
                .filter((f) => (f.team_id ?? null) === space)
                .map((f) => (
                  <Chip
                    key={f.id}
                    label={f.name}
                    selected={folder === f.id}
                    onPress={() => setFolder(f.id)}
                  />
                ))}
            </ChipRow>
          </View>
          {todos > 0 && (
            <View style={s.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>
                  Make its {todos} to-do{todos === 1 ? "" : "s"}{" "}
                  {todos === 1 ? "a task" : "tasks"}
                </Text>
                <Text style={shared.small}>
                  {project
                    ? `In ${project.name}. Ticking one on the page ticks the task.`
                    : `In your tasks. Choose a project to put ${todos === 1 ? "it" : "them"} there.`}
                </Text>
              </View>
              <Switch
                value={makeTasks}
                onValueChange={setMakeTasks}
                trackColor={{ true: colors.accent }}
                accessibilityLabel="Make the to-dos tasks"
              />
            </View>
          )}
          <Button
            title={busy ? "Making…" : "Create page"}
            icon="plus"
            disabled={busy}
            onPress={create}
          />
          {picked.can_edit && (
            <SmallAction
              label="Delete template"
              destructive
              disabled={busy}
              onPress={() => remove(picked)}
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
export function SaveTemplatePanel({
  doc,
  onClose,
  onSaved,
}: {
  doc: Pick<Doc, "id" | "title" | "team_id" | "team_name">;
  onClose: () => void;
  onSaved: (t: PageTemplate) => void;
}) {
  const [name, setName] = useState(doc.title || "");
  const [shareWithTeam, setShareWithTeam] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = () => {
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
      .finally(() => setBusy(false));
  };
  return (
    <View style={s.savePanel}>
      <Text style={s.name}>Save as template</Text>
      <TextInput
        style={shared.input}
        value={name}
        maxLength={120}
        placeholder="Untitled"
        placeholderTextColor={colors.faint}
        onChangeText={setName}
        accessibilityLabel="Template name"
      />
      <Text style={shared.small}>
        Blanks like {"{date}"}, {"{title}"}, {"{project}"} and {"{event}"} in
        the page fill themselves in each time it’s used.
      </Text>
      {!!doc.team_id && (
        <View style={s.switchRow}>
          <Text style={[s.name, { flex: 1 }]}>
            Share with {doc.team_name ?? "the team"}
          </Text>
          <Switch
            value={shareWithTeam}
            onValueChange={setShareWithTeam}
            trackColor={{ true: colors.accent }}
            accessibilityLabel="Share with the team"
          />
        </View>
      )}
      {!!error && <Text style={s.error}>{error}</Text>}
      <View style={s.saveActions}>
        <SmallAction label="Cancel" disabled={false} onPress={onClose} />
        <SmallAction
          label={busy ? "Saving…" : "Save template"}
          disabled={busy}
          onPress={save}
        />
      </View>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    panel: { gap: 12 },
    head: { flexDirection: "row", alignItems: "center", gap: 8 },
    back: {
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
    },
    title: {
      flex: 1,
      fontFamily: fonts.display,
      fontSize: 18,
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
      fontSize: 11,
      color: colors.muted,
      marginTop: 2,
    },
    form: { gap: 14 },
    switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    error: { color: colors.danger, fontSize: 13 },
    savePanel: {
      gap: 10,
      padding: 14,
      borderRadius: radii.card,
      backgroundColor: colors.surfaceMuted,
    },
    saveActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 8,
    },
  }),
);
