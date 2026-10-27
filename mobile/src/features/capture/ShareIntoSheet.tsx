import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "../../motion";
import {
  captureTask,
  choiceKey,
  choiceLabel,
  readChoices,
  rememberChoice,
  shortAddress,
  siteOf,
  type CaptureDestination,
  type CaptureResult,
  type DocSummary,
  type Folder,
  type Project,
  type ShareChoice,
  type SharedContent,
} from "@orbyn/core";
import * as Crypto from "expo-crypto";
import { session } from "../../lib/session";
import { InlineDetails } from "../../components/InlineDetails";
import { AssistChips } from "../assistant/capture/AssistChips";
import { BottomSheet } from "../../components/BottomSheet";
import { Button } from "../../components/Button";
import { Chip, ChipRow } from "../../components/Chip";
import { Icon, type IconName } from "../../components/Icon";
import { client } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { readLocal, saveLocal } from "../../lib/localPrefs";
import { deviceTimeZone } from "../planner/planning";
import {
  inputFontSize,
  colors,
  controls,
  fonts,
  radii,
  themed,
} from "../../theme";

/** Where the last three destinations are kept, on this device. */
const CHOICES_KEY = "orbyn-share-choices";

type Kind = ShareChoice["kind"];

/**
 * "Save to Orbyn", for a link or some text shared from another app: the
 * link's title and site at the top, the last three places used as chips,
 * then where it can go — an Inbox task "Read: …", today's agenda, a page,
 * a new page in a folder, or a project — and one Save.
 */
type ShareIntoProps = {
  shared: SharedContent | null;
  userId?: string;
  teamNames?: Record<string, string>;
  canWriteIn: (teamId: string | null) => boolean;
  onClose: () => void;
  onSaved: (result: CaptureResult) => void;
};
export function ShareIntoSheet(props: ShareIntoProps) {
  return props.shared ? (
    <ShareIntoBody
      key={`${session.token}:${JSON.stringify(props.shared)}`}
      {...props}
      shared={props.shared}
    />
  ) : null;
}
function ShareIntoBody({
  shared,
  userId,
  teamNames = {},
  canWriteIn,
  onClose,
  onSaved,
}: {
  /** What was shared; the sheet shows while there is something. */
  shared: SharedContent;
  userId?: string;
  teamNames?: Record<string, string>;
  /** Whether this person may add to a team's things (null: their own). */
  canWriteIn: (teamId: string | null) => boolean;
  onClose: () => void;
  onSaved: (result: CaptureResult) => void;
}) {
  const destinationLabel = (label: string, teamId: string | null) =>
    `${label} · ${teamId ? (teamNames[teamId] ?? "Shared") : "Personal"}`;
  const choicesKey = userId ? `${CHOICES_KEY}:${userId}` : null;
  const [title, setTitle] = useState<string | null>(null);
  const [site, setSite] = useState("");
  const [kept, setKept] = useState<ShareChoice[]>(() =>
    choicesKey ? readChoices(readLocal(choicesKey)) : [],
  );
  const [kind, setKind] = useState<Kind>("inbox");
  /** The page, folder or project chosen for the kinds that need one. */
  const [picked, setPicked] = useState<{
    id: string | null;
    label: string;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState<DocSummary[] | null>(null);
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [searchRetry, setSearchRetry] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [captured, setCaptured] = useState<CaptureResult | null>(null);
  const owner = useRef(session.token);
  const mounted = useRef(false);
  const lock = useRef(false);
  const requests = useRef(new Map<string, string>());
  const owns = () => mounted.current && owner.current === session.token;
  const locked = busy || !!captured;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** The lists that couldn't be fetched, each offered again. */
  const [failed, setFailed] = useState<Partial<Record<Kind, boolean>>>({});
  /**
   * Pages found on the server for the words typed (older ones too), as
   * found: which of them can be written to is decided when they're shown,
   * with the teams as they are then.
   */
  const [found, setFound] = useState<
    { id: string; title: string; team_id: string | null }[] | null
  >(null);

  // A new share starts from the place used last, with its title looked up.
  useEffect(() => {
    if (!shared) return;
    const last = choicesKey ? readChoices(readLocal(choicesKey)) : [];
    setKept(last);
    choose(last[0] ?? { kind: "inbox" });
    setError("");
    setQuery("");
    setTitle(null);
    setSite(shared.url ? siteOf(shared.url) : "");
    // A preview that comes back after another share opened is dropped, so
    // one link's title never lands on another's task.
    let current = true;
    if (shared.url)
      client.linkPreview(shared.url).then(
        (p) => {
          if (!current || !owns() || lock.current) return;
          setTitle(p.title);
          setSite(p.site);
        },
        () => {},
      );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared]);

  // The lists a destination chooses from, fetched when first needed.
  useEffect(() => {
    if (!shared || failed[kind]) return;
    let live = true;
    const fail = (e: unknown) => {
      if (!live || !owns()) return;
      setFailed((f) => ({ ...f, [kind]: true }));
      setError(errorText(e));
    };
    if (kind === "page" && !pages)
      client.listDocs().then((value) => {
        if (live && owns()) setPages(value);
      }, fail);
    if (kind === "new_page" && !folders)
      client.listFolders().then((value) => {
        if (live && owns()) setFolders(value);
      }, fail);
    if (kind === "project" && !projects)
      client.listProjects().then((value) => {
        if (live && owns()) setProjects(value);
      }, fail);
    return () => {
      live = false;
    };
  }, [kind, shared, pages, folders, projects, failed]);

  // Words typed to find a page look through all of them on the server, not
  // just the newest the list brought.
  useEffect(() => {
    const words = query.trim();
    setFound(null);
    setSearchError("");
    if (kind !== "page" || words.length < 2) return;
    let current = true;
    const wait = setTimeout(() => {
      client.search(words, { type: "doc", limit: 20 }).then(
        (hits) => {
          if (current && owns())
            setFound(
              hits
                .filter((h) => h.kind !== "agenda")
                .map((h) => ({ id: h.id, title: h.title, team_id: h.team_id })),
            );
        },
        () => {
          if (current && owns())
            setSearchError("Couldn’t search pages. Try again.");
        },
      );
    }, 250);
    return () => {
      current = false;
      clearTimeout(wait);
    };
    // canWriteIn is left out on purpose: it is a new function on every
    // parent render, and a search needn't run again for that. The hits are
    // filtered below, where the current teams are used.
  }, [kind, query, searchRetry]);

  /** Offer a list that couldn't be fetched again. */
  const retry = (k: Kind) => {
    setError("");
    setFailed((f) => ({ ...f, [k]: false }));
  };

  const choose = (c: ShareChoice) => {
    if (lock.current || captured) return;
    setShowAll(false);
    setKind(c.kind);
    setPicked("id" in c ? { id: c.id, label: c.label } : null);
    setQuery("");
  };

  const task = shared
    ? captureTask({ url: shared.url, title, text: shared.text })
    : null;
  const writablePages = useMemo(() => {
    const words = query.trim().toLowerCase();
    const listed = (pages ?? [])
      .filter((d) => d.kind !== "agenda" && canWriteIn(d.team_id))
      .filter((d) =>
        words ? (d.title || "Untitled").toLowerCase().includes(words) : true,
      )
      .map((d) => ({
        id: d.id,
        title: destinationLabel(d.title || "Untitled", d.team_id),
      }));
    // The newest that match first, then older ones the server found.
    const seen = new Set(listed.map((d) => d.id));
    const writable = (found ?? [])
      .filter((d) => !seen.has(d.id) && canWriteIn(d.team_id))
      .map((d) => ({
        id: d.id,
        title: destinationLabel(d.title || "Untitled", d.team_id),
      }));
    return [...listed, ...writable];
  }, [pages, query, found, canWriteIn, teamNames]);

  const matchingFolders = (folders ?? []).filter(
    (folder) =>
      canWriteIn(folder.team_id) &&
      destinationLabel(folder.name, folder.team_id)
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const matchingProjects = (projects ?? []).filter(
    (project) =>
      canWriteIn(project.team_id) &&
      destinationLabel(project.name, project.team_id)
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const pickerSearch = (
    <TextInput
      editable={!locked}
      style={s.search}
      value={query}
      placeholder="Search destinations"
      placeholderTextColor={colors.faint}
      autoCorrect={false}
      accessibilityLabel="Search destinations"
      onChangeText={(value) => {
        setQuery(value);
        setShowAll(false);
      }}
    />
  );
  const ready = kind === "inbox" || kind === "agenda" || !!picked;
  const destination = (): CaptureDestination | null => {
    if (kind === "inbox") return { kind: "inbox" };
    if (kind === "agenda") return { kind: "agenda" };
    if (!picked) return null;
    if (kind === "page") return { kind: "page", doc_id: picked.id! };
    if (kind === "project") return { kind: "project", project_id: picked.id! };
    return { kind: "new_page", folder_id: picked.id };
  };

  const save = async () => {
    const to = destination();
    if (!shared || !to || lock.current || !owns()) return;
    if (captured) {
      onSaved(captured);
      return;
    }
    const target =
      kind === "page"
        ? ((pages ?? []).find((page) => page.id === picked?.id) ??
          (found ?? []).find((page) => page.id === picked?.id))
        : kind === "project"
          ? (projects ?? []).find((project) => project.id === picked?.id)
          : kind === "new_page"
            ? (folders ?? []).find((folder) => folder.id === picked?.id)
            : null;
    if (target && !canWriteIn(target.team_id)) {
      setError("Choose a destination you can edit.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const input = {
        url: shared.url,
        text: shared.text,
        title,
        to,
        timezone: deviceTimeZone(),
      };
      const key = JSON.stringify(input);
      let requestId = requests.current.get(key);
      if (!requestId) {
        requestId = Crypto.randomUUID();
        requests.current.set(key, requestId);
      }
      const result = await client.once(requestId, () => client.capture(input));
      if (!owns()) return;
      setCaptured(result);
      const choice: ShareChoice =
        kind === "inbox" || kind === "agenda"
          ? { kind }
          : kind === "new_page"
            ? { kind, id: picked!.id, label: picked!.label }
            : { kind, id: picked!.id!, label: picked!.label };
      const next = rememberChoice(kept, choice);
      setKept(next);
      if (choicesKey) saveLocal(choicesKey, JSON.stringify(next));
      onSaved(result);
    } catch (e) {
      if (owns()) setError(errorText(e));
    } finally {
      lock.current = false;
      if (owns()) setBusy(false);
    }
  };

  const row = (k: Kind, icon: IconName, label: string, detail?: string) => (
    <Pressable
      key={k}
      accessibilityRole="radio"
      disabled={locked}
      accessibilityState={{ checked: kind === k }}
      onPress={() => {
        if (kind !== k) choose({ kind: k } as ShareChoice);
      }}
      style={({ pressed }) => [
        s.row,
        kind === k && s.rowOn,
        pressed && kind !== k && { backgroundColor: colors.surfaceMuted },
      ]}
    >
      <Icon
        name={icon}
        size={19}
        color={kind === k ? colors.accent : colors.textSoft}
      />
      <View style={s.rowWords}>
        <Text style={[s.rowLabel, kind === k && { color: colors.accent }]}>
          {label}
        </Text>
        {!!detail && <Text style={s.rowDetail}>{detail}</Text>}
      </View>
      {kind === k && <Icon name="check" size={16} color={colors.accent} />}
    </Pressable>
  );

  const option = (
    key: string,
    label: string,
    id: string | null,
    icon: IconName,
  ) => {
    const on = picked?.id === id;
    return (
      <Pressable
        key={key}
        accessibilityRole="radio"
        disabled={locked}
        accessibilityState={{ checked: on }}
        onPress={() => setPicked({ id, label })}
        style={({ pressed }) => [
          s.option,
          on && s.optionOn,
          pressed && !on && { backgroundColor: colors.surfaceMuted },
        ]}
      >
        <Icon name={icon} size={16} color={on ? colors.accent : colors.muted} />
        <Text style={[s.optionText, on && { color: colors.accent }]}>
          {label}
        </Text>
      </Pressable>
    );
  };

  const retryRow = (k: Kind) => (
    <Pressable
      accessibilityRole="button"
      onPress={() => retry(k)}
      style={({ pressed }) => [
        s.option,
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
    >
      <Icon name="refreshCw" size={16} color={colors.muted} />
      <Text style={s.optionText} numberOfLines={1}>
        Couldn’t load. Try again
      </Text>
    </Pressable>
  );

  return (
    <BottomSheet
      visible={!!shared}
      title="Save to Orbyn"
      onClose={() => {
        if (!lock.current && owns()) onClose();
      }}
      closeDisabled={busy}
      footer={
        <Button
          title={busy ? "Saving…" : captured ? "Open saved item" : "Save"}
          disabled={busy || !ready}
          onPress={() => void save()}
        />
      }
    >
      {shared && (
        <View style={s.body}>
          <View style={s.card}>
            {shared.url ? (
              <>
                <Text style={s.cardTitle} numberOfLines={2}>
                  {title || site || shared.url}
                </Text>
                <Text style={s.cardSite} numberOfLines={1}>
                  {title ? site : shortAddress(shared.url)}
                </Text>
              </>
            ) : null}
            {!!shared.text && (
              <Text style={s.cardText} numberOfLines={shared.url ? 2 : 4}>
                {shared.text}
              </Text>
            )}
          </View>

          <InlineDetails title="Shared content">
            <Text selectable style={s.cardText}>
              {[shared.url, shared.text].filter(Boolean).join("\n\n")}
            </Text>
          </InlineDetails>
          {/* Optional: the assistant reads the words shared in (AI-01). */}
          {(shared.text ?? "").trim().length >= 80 && (
            <AssistChips
              text={shared.text}
              title={title || site || "What you shared"}
            />
          )}

          {kept.length > 0 && (
            <ChipRow label="Places used last">
              {kept.map((c) => (
                <Chip
                  key={choiceKey(c)}
                  disabled={locked}
                  label={choiceLabel(c)}
                  selected={
                    kind === c.kind &&
                    ("id" in c
                      ? picked?.id === c.id && picked?.label === c.label
                      : true)
                  }
                  onPress={() => choose(c)}
                />
              ))}
            </ChipRow>
          )}

          <View style={s.rows} accessibilityRole="radiogroup">
            {row(
              "inbox",
              "inbox",
              shared.url ? `Inbox task “${task?.title}”` : "Inbox task",
              shared.url ? "With the link on it" : task?.title,
            )}
            {row("agenda", "newspaper", "Add to today’s agenda", "Under Notes")}
            {row(
              "page",
              "fileText",
              kind === "page" && picked
                ? `Add to “${picked.label}”`
                : "Add to a page…",
            )}
            {kind === "page" && (
              <View style={s.picker}>
                <TextInput
                  editable={!locked}
                  style={s.search}
                  value={query}
                  placeholder="Find a page"
                  placeholderTextColor={colors.faint}
                  autoCorrect={false}
                  onChangeText={setQuery}
                  accessibilityLabel="Find a page"
                />
                {failed.page ? (
                  retryRow("page")
                ) : pages === null ? (
                  <Text style={s.muted}>Loading…</Text>
                ) : writablePages.length === 0 ? (
                  <Text style={s.muted}>
                    {!query.trim()
                      ? "No pages you can add to yet."
                      : query.trim().length >= 2 &&
                          found === null &&
                          !searchError
                        ? "Looking…"
                        : "No page by that name."}
                  </Text>
                ) : (
                  writablePages
                    .slice(0, showAll ? undefined : 8)
                    .map((d) =>
                      option(d.id, d.title || "Untitled", d.id, "fileText"),
                    )
                )}
                {searchError && (
                  <View>
                    <Text accessibilityRole="alert" style={s.error}>
                      {searchError}
                    </Text>
                    <Button
                      title="Retry search"
                      secondary
                      disabled={locked}
                      onPress={() => setSearchRetry((value) => value + 1)}
                    />
                  </View>
                )}
                {writablePages.length > 8 && (
                  <Button
                    secondary
                    title={
                      showAll
                        ? "Show fewer"
                        : `Show all ${writablePages.length} pages`
                    }
                    onPress={() => setShowAll(!showAll)}
                  />
                )}
              </View>
            )}
            {row(
              "new_page",
              "filePlus",
              kind === "new_page" && picked
                ? `New page in ${picked.label}`
                : "New page in folder…",
            )}
            {kind === "new_page" && (
              <View style={s.picker}>
                {pickerSearch}
                {option("none", "Unfiled · Personal", null, "fileText")}
                {failed.new_page ? (
                  retryRow("new_page")
                ) : folders === null ? (
                  <Text style={s.muted}>Loading…</Text>
                ) : (
                  matchingFolders
                    .slice(0, showAll ? undefined : 8)
                    .map((f) =>
                      option(
                        f.id,
                        destinationLabel(f.name, f.team_id),
                        f.id,
                        "folder",
                      ),
                    )
                )}
                {matchingFolders.length > 8 && (
                  <Button
                    secondary
                    disabled={locked}
                    title={
                      showAll
                        ? "Show fewer"
                        : `Show all ${matchingFolders.length} folders`
                    }
                    onPress={() => setShowAll(!showAll)}
                  />
                )}
              </View>
            )}
            {row(
              "project",
              "boxes",
              kind === "project" && picked ? picked.label : "Project…",
              kind === "project" && picked ? "As a task" : undefined,
            )}
            {kind === "project" && (
              <View style={s.picker}>
                {pickerSearch}
                {failed.project ? (
                  retryRow("project")
                ) : projects === null ? (
                  <Text style={s.muted}>Loading…</Text>
                ) : matchingProjects.length === 0 ? (
                  <Text style={s.muted}>
                    {query.trim()
                      ? "No matching projects."
                      : "No projects you can add to."}
                  </Text>
                ) : (
                  matchingProjects
                    .slice(0, showAll ? undefined : 8)
                    .map((p) =>
                      option(
                        p.id,
                        destinationLabel(p.name, p.team_id),
                        p.id,
                        "boxes",
                      ),
                    )
                )}
                {matchingProjects.length > 8 && (
                  <Button
                    secondary
                    disabled={locked}
                    title={
                      showAll
                        ? "Show fewer"
                        : `Show all ${matchingProjects.length} projects`
                    }
                    onPress={() => setShowAll(!showAll)}
                  />
                )}
              </View>
            )}
          </View>
          {!!error && (
            <Text style={s.error} accessibilityRole="alert">
              {error}
            </Text>
          )}
        </View>
      )}
    </BottomSheet>
  );
}

const s = themed(() =>
  StyleSheet.create({
    body: { gap: 14, paddingTop: 4 },
    card: {
      gap: 4,
      padding: 14,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    cardTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    cardSite: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    cardText: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSoft,
    },
    rows: { gap: 2 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: controls.tap + 8,
      paddingHorizontal: 12,
      borderRadius: radii.input,
    },
    rowOn: { backgroundColor: colors.accentSoft },
    rowWords: { flex: 1, minWidth: 0 },
    rowLabel: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
    rowDetail: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    picker: { gap: 2, paddingLeft: 12, paddingBottom: 6 },
    search: {
      minHeight: controls.tap,
      paddingHorizontal: 12,
      marginBottom: 4,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: inputFontSize,
    },
    option: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: controls.tap,
      paddingHorizontal: 10,
      borderRadius: radii.input,
    },
    optionOn: { backgroundColor: colors.accentSoft },
    optionText: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: 15,
      color: colors.text,
    },
    muted: {
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.muted,
      paddingVertical: 6,
    },
    error: { color: colors.danger, fontSize: 13 },
  }),
);
