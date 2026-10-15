import { ViewDraftStore } from "@orbyn/api-client";
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Pressable } from "../../motion";
import {
  fullDefinition,
  hasTeamPermission,
  groupRows,
  layoutsFor,
  searchSavedViews,
  VIEW_GROUP_LABELS,
  VIEW_GROUPS,
  VIEW_LAYOUT_LABELS,
  VIEW_PRESETS,
  VIEW_SORT_LABELS,
  VIEW_SORTS,
  VIEW_SOURCE_LABELS,
  VIEW_SOURCES,
  viewFileName,
  type SavedView,
  type Team,
  type ViewDefinition,
  type ViewDefinitionInput,
  type ViewFilters,
  type ViewLayout,
  type ViewResult,
  type ViewRow,
  type ViewSource,
} from "@orbyn/core";
import { ChoicePicker } from "../../components/ChoicePicker";
import { BottomSheet } from "../../components/BottomSheet";
import { Chip, ChipRow } from "../../components/Chip";
import { Disclosure } from "../../components/Disclosure";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { ActionSheet, MoreMenu } from "../../components/MoreMenu";
import * as Crypto from "expo-crypto";
import { Segmented } from "../../components/Segmented";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { SmallAction } from "../../components/SmallAction";
import * as outbox from "../../lib/outbox";
import { session } from "../../lib/session";
import { client } from "../../lib/api";
import { saveFile } from "../../lib/download";
import { errorText } from "../../lib/errors";
import { usePlanning } from "../../lib/planningContext";
import { shared } from "../../styles";
import { colors, fonts, radii, themed } from "../../theme";
import { applyEdit, type CellEdit, type TaskActions } from "./edits";
import { ViewBody } from "./ViewBody";

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

type Due = "any" | "overdue" | "today" | "week" | "month" | "none";
const DUE_LABELS: Record<Due, string> = {
  any: "Any time",
  overdue: "Overdue",
  today: "Today",
  week: "Next 7 days",
  month: "Next 30 days",
  none: "No deadline",
};
const dueOf = (f: ViewFilters): Due =>
  f.overdue
    ? "overdue"
    : f.no_due
      ? "none"
      : f.due_within_days === 0
        ? "today"
        : f.due_within_days === 7
          ? "week"
          : f.due_within_days === 30
            ? "month"
            : "any";
const tidy = (f: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(f).filter(
      ([, v]) => v !== undefined && v !== "" && v !== false,
    ),
  ) as ViewFilters;

/**
 * Saved views on a phone (DATA-01): your own and your teams', each a named
 * filter, sort, grouping and layout over tasks, pages or projects. Opened
 * from Browse, a pinned view, or a link (orbyn://view/<id>). Changes to a
 * view you may change are saved as you make them.
 */
export function ViewsSheet(props: React.ComponentProps<typeof ViewsBody>) {
  return <ViewsBody key={session.token} {...props} />;
}
function ViewsBody({
  visible,
  teams,
  userId,
  openViewId,
  onViewOpened,
  actions,
  onOpenRow,
  onClose,
  onDismiss,
}: {
  visible: boolean;
  teams: Team[];
  userId?: string;
  /** A view to open (from a link), then cleared. */
  openViewId: string | null;
  onViewOpened: () => void;
  actions: TaskActions;
  onOpenRow: (row: ViewRow) => void;
  onClose: () => void;
  onDismiss?: () => void;
}) {
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [stars, setStars] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const selectedOwner = useRef(selected);
  selectedOwner.current = selected;
  const rowWork = useRef<{ id: string | null; busy: boolean }>({
    id: null,
    busy: false,
  });
  const [rowWorkShown, setRowWorkShown] = useState(rowWork.current);
  const rowsBusy = rowWorkShown.id === selected && rowWorkShown.busy;
  const rowPending = () =>
    rowWork.current.id === selectedOwner.current && rowWork.current.busy;
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<SavedView | null>(null);
  const creationRequests = useRef(new Map<string, string>());
  const [creating, setCreating] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  /** The name being typed while an open view is renamed. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      libraryRead.current++;
    };
  }, []);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const libraryRead = useRef(0);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryFailed, setLibraryFailed] = useState(false);
  const report = (e: unknown) => {
    if (mounted.current && binding === session.token && visibleRef.current)
      setError(errorText(e as Error));
  };
  const reportRef = useRef(report);
  reportRef.current = report;

  const binding = session.token;
  const draftStore = useMemo(
    () =>
      new ViewDraftStore(
        async (id, definition) =>
          (await client.updateView(id, { definition })).definition,
        () => !!binding && session.token === binding,
        (error) => reportRef.current(error),
      ),
    [binding],
  );
  const draftRevision = useSyncExternalStore(
    draftStore.subscribe,
    draftStore.getSnapshot,
  );
  const appliedDraftRevision = useRef(0);
  useEffect(() => {
    draftStore.start();
    appliedDraftRevision.current = 0;
    return () => draftStore.stop();
  }, [draftStore]);
  useEffect(() => {
    const after = appliedDraftRevision.current;
    appliedDraftRevision.current = draftRevision;
    setViews(
      (list) =>
        list?.map((entry) => {
          const saved = draftStore.saved.get(entry.id);
          return saved && saved.version > after
            ? { ...entry, definition: saved.definition }
            : entry;
        }) ?? list,
    );
  }, [draftRevision, draftStore]);
  const load = async () => {
    const request = ++libraryRead.current;
    setLibraryLoading(true);
    setLibraryFailed(false);
    const started = draftStore.getSnapshot();
    const [list, favourites] = await Promise.all([
      client.listViews(),
      client.listFavourites(),
    ]);
    if (
      !mounted.current ||
      !visibleRef.current ||
      request !== libraryRead.current ||
      binding !== session.token
    )
      return list;
    setLibraryLoading(false);
    setViews(
      list.map((entry) => {
        const saved = draftStore.saved.get(entry.id);
        return saved && saved.version > started
          ? { ...entry, definition: saved.definition }
          : entry;
      }),
    );
    setStars(
      new Set(
        favourites.filter((f) => f.kind === "view").map((f) => f.target_id),
      ),
    );
    return list;
  };
  useEffect(() => {
    setViews(null);
    setStars(new Set());
    setSelected(null);
    setRenaming(null);
    setCreating(false);
    setCreateBusy(false);
    setManagementBusy(false);
    creatingNow.current = false;
    managementLock.current = false;
    setError("");
    libraryRead.current += 1;
  }, [binding]);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    load().then(
      (list) => {
        if (!alive || !mounted.current || binding !== session.token) return;
        if (openViewId) {
          if (list.some((view) => view.id === openViewId))
            setSelected(openViewId);
          else
            reportRef.current(
              new Error("That view isn't shared with you, or was deleted."),
            );
          onViewOpened();
        }
      },
      (error) => {
        if (alive && mounted.current && binding === session.token) {
          setLibraryLoading(false);
          setLibraryFailed(true);
          reportRef.current(error);
        }
      },
    );
    return () => {
      alive = false;
      libraryRead.current += 1;
    };
  }, [visible, openViewId, binding]);

  const visibleViews =
    views === null ? null : searchSavedViews(views, libraryQuery);
  const view = views?.find((v) => v.id === selected) ?? null;
  const replace = (saved: SavedView) => {
    if (!mounted.current || binding !== session.token || !visibleRef.current)
      return;
    setViews(
      (list) =>
        list?.map((entry) =>
          entry.id === saved.id
            ? { ...saved, definition: entry.definition }
            : entry,
        ) ?? list,
    );
  };

  const managementLock = useRef(false);
  const [managementBusy, setManagementBusy] = useState(false);
  const manage = async (operation: () => Promise<void>) => {
    if (
      managementLock.current ||
      rowPending() ||
      creatingNow.current ||
      !mounted.current ||
      binding !== session.token ||
      !visibleRef.current
    )
      return false;
    managementLock.current = true;
    setManagementBusy(true);
    try {
      await operation();
      return mounted.current && binding === session.token && visibleRef.current;
    } catch (error) {
      report(error);
      return false;
    } finally {
      if (mounted.current && binding === session.token) {
        managementLock.current = false;
        setManagementBusy(false);
      }
    }
  };
  const setStar = (id: string, on: boolean) =>
    void manage(async () => {
      await client.setFavourite("view", id, on);
      if (!mounted.current || binding !== session.token || !visibleRef.current)
        return;
      setStars((old) => {
        const next = new Set(old);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      });
    });
  const setPin = (view: SavedView, pinned: boolean) =>
    void manage(async () => {
      await client.pinView(view.id, pinned);
      replace({ ...view, pinned });
    });
  const creatingNow = useRef(false);
  const create = async (
    name: string,
    definition: ViewDefinitionInput,
    teamId: string | null,
  ) => {
    if (!mounted.current || binding !== session.token || !visibleRef.current)
      throw new Error("Your account changed.");
    if (creatingNow.current || managementLock.current || rowPending())
      throw new Error("Wait for the pending view change.");
    creatingNow.current = true;
    setCreateBusy(true);
    try {
      const key = JSON.stringify([name, definition, teamId]);
      const request = creationRequests.current.get(key) ?? Crypto.randomUUID();
      creationRequests.current.set(key, request);
      const made = await client.once(request, () =>
        client.createView({ name, definition, team_id: teamId }),
      );
      if (!mounted.current || binding !== session.token || !visibleRef.current)
        return;
      setViews((list) => [...(list ?? []), made]);
      setSelected(made.id);
      draftStore.keepCreation(null);
      setCreating(false);
    } finally {
      if (binding === session.token) {
        creatingNow.current = false;
        setCreateBusy(false);
      }
    }
  };

  const title = view ? view.name : "Views";
  return (
    <Sheet
      visible={visible}
      title={title}
      closeDisabled={createBusy || managementBusy || rowsBusy}
      onClose={() => {
        if (rowPending() || creatingNow.current || managementLock.current)
          return;
        setSelected(null);
        onClose();
      }}
      onDismiss={onDismiss}
      onBack={
        view || creating
          ? () => {
              if (
                !rowPending() &&
                !creatingNow.current &&
                !managementLock.current
              ) {
                setSelected(null);
                setCreating(false);
              }
            }
          : undefined
      }
      actions={
        view ? (
          <View style={s.headActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={stars.has(view.id) ? "Unstar" : "Star"}
              accessibilityState={{ selected: stars.has(view.id) }}
              disabled={managementBusy || createBusy || rowsBusy}
              onPress={() => setStar(view.id, !stars.has(view.id))}
              style={s.headButton}
            >
              <Icon
                name={stars.has(view.id) ? "starFilled" : "star"}
                size={18}
                color={stars.has(view.id) ? colors.accent : colors.textSoft}
              />
            </Pressable>
            <ViewMenu
              busy={managementBusy || createBusy || rowsBusy}
              view={view}
              userId={userId}
              teams={teams}
              onRename={() => setRenaming(view.name)}
              onPin={() => setPin(view, !view.pinned)}
              onShare={(teamId) =>
                manage(async () => {
                  replace(
                    await client.updateView(view.id, { team_id: teamId }),
                  );
                })
              }
              onDuplicate={() =>
                void create(`${view.name} (copy)`, view.definition, null).catch(
                  report,
                )
              }
              onExport={() =>
                void manage(async () => {
                  const { text, name } = await client.exportViewCsv(view.id);
                  if (
                    mounted.current &&
                    binding === session.token &&
                    visibleRef.current
                  )
                    await saveFile(
                      name || viewFileName(view.name),
                      text,
                      "text/csv",
                    );
                })
              }
              onDelete={() => setDeleting(view)}
            />
          </View>
        ) : undefined
      }
    >
      <ActionSheet
        visible={!!deleting}
        label="Delete view"
        title="Delete this view?"
        message={
          deleting
            ? `${deleting.name}. ${deleting.team_id ? `Removed for everyone in ${deleting.team_name ?? "the team"}. ` : ""}Items are kept.`
            : ""
        }
        actions={
          deleting
            ? [
                {
                  label: "Delete view",
                  destructive: true,
                  disabled: managementBusy || createBusy,
                  onPress: () => {
                    const target = deleting;
                    void manage(async () => {
                      await client.deleteView(target.id);
                      draftStore.forget(target.id);
                      if (
                        !mounted.current ||
                        binding !== session.token ||
                        !visibleRef.current
                      )
                        return;
                      setSelected((current) =>
                        current === target.id ? null : current,
                      );
                      await load();
                    });
                  },
                },
              ]
            : []
        }
        onClose={() => setDeleting(null)}
      />
      {managementBusy && (
        <Text style={shared.small} accessibilityLiveRegion="polite">
          Updating view…
        </Text>
      )}
      {view ? (
        <OpenView
          key={`${binding}:${view.id}`}
          draftStore={draftStore}
          view={view}
          renaming={renaming}
          onRenaming={setRenaming}
          onRename={async (name) => {
            if (
              !name.trim() ||
              binding !== session.token ||
              !visibleRef.current
            )
              return false;
            if (name.trim() !== view.name) {
              const saved = await client.updateView(view.id, {
                name: name.trim(),
              });
              if (
                !mounted.current ||
                binding !== session.token ||
                !visibleRef.current
              )
                return false;
              setViews(
                (list) =>
                  list?.map((entry) =>
                    entry.id === saved.id
                      ? { ...entry, name: saved.name }
                      : entry,
                  ) ?? list,
              );
            }
            setRenaming(null);
            return true;
          }}
          teams={teams}
          userId={userId}
          actions={actions}
          onOpenRow={onOpenRow}
          onBusyChange={(busy) => {
            if (
              !mounted.current ||
              binding !== session.token ||
              selectedOwner.current !== view.id
            )
              return;
            const next = { id: view.id, busy };
            rowWork.current = next;
            setRowWorkShown((previous) =>
              previous.id === next.id && previous.busy === next.busy
                ? previous
                : next,
            );
          }}
          onCopy={(def) =>
            void create(`${view.name} (my copy)`, def, null).catch(report)
          }
          report={report}
          error={error}
          onDismissError={() => setError("")}
        />
      ) : (
        <ScrollView
          contentContainerStyle={sheetStyles.body}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={libraryLoading}
              onRefresh={() =>
                void load().catch((error) => {
                  if (
                    mounted.current &&
                    binding === session.token &&
                    visibleRef.current
                  ) {
                    setLibraryLoading(false);
                    setLibraryFailed(true);
                    report(error);
                  }
                })
              }
            />
          }
        >
          <View style={sheetStyles.column}>
            {!!error && (
              <ErrorBanner error={error} onDismiss={() => setError("")} />
            )}
            {libraryFailed && (
              <SmallAction
                label="Retry views"
                disabled={libraryLoading}
                onPress={() =>
                  void load().catch((error) => {
                    if (
                      mounted.current &&
                      binding === session.token &&
                      visibleRef.current
                    ) {
                      setLibraryLoading(false);
                      setLibraryFailed(true);
                      report(error);
                    }
                  })
                }
              />
            )}
            <View style={[s.newRow, s.gapTop]}>
              <SmallAction
                label="New view"
                disabled={false}
                onPress={() => setCreating(true)}
              />
            </View>
            <TextInput
              style={shared.input}
              accessibilityLabel="Search saved views"
              placeholder="Search views"
              placeholderTextColor={colors.muted}
              maxLength={120}
              value={libraryQuery}
              onChangeText={setLibraryQuery}
              autoCorrect={false}
              returnKeyType="search"
            />
            {views && views.length > 0 && visibleViews?.length === 0 ? (
              <Text style={shared.small} accessibilityLiveRegion="polite">
                No matching views.
              </Text>
            ) : libraryFailed && views === null ? (
              <Text style={shared.small}>Views unavailable.</Text>
            ) : (
              <ViewList
                views={visibleViews}
                stars={stars}
                teams={teams}
                onOpen={setSelected}
              />
            )}
          </View>
        </ScrollView>
      )}
      <BottomSheet
        visible={creating && visible}
        title="New view"
        closeDisabled={createBusy}
        onClose={() => {
          if (!creatingNow.current) setCreating(false);
        }}
      >
        {creating && (
          <NewView
            key={binding}
            draftStore={draftStore}
            teams={teams}
            onCancel={() => {
              if (!creatingNow.current) setCreating(false);
            }}
            onCreate={create}
          />
        )}
      </BottomSheet>
    </Sheet>
  );
}

function ViewList({
  views,
  stars,
  teams,
  onOpen,
}: {
  views: SavedView[] | null;
  stars: Set<string>;
  teams: Team[];
  onOpen: (id: string) => void;
}) {
  if (views === null) return <Text style={shared.small}>Loading views…</Text>;
  if (!views.length) return <Text style={shared.small}>No views yet.</Text>;
  const teamIds = [
    ...new Set(views.flatMap((v) => (v.team_id ? [v.team_id] : []))),
  ];
  const sections = [
    { key: "mine", title: "Personal", list: views.filter((v) => !v.team_id) },
    ...teamIds.map((id) => {
      const list = views.filter((v) => v.team_id === id);
      return {
        key: id,
        title:
          teams.find((t) => t.id === id)?.name ?? list[0].team_name ?? "A team",
        list,
      };
    }),
  ].filter((sec) => sec.list.length);
  return (
    <>
      {sections.map((sec) => (
        <View key={sec.key} style={s.section}>
          <Text style={shared.label}>{sec.title}</Text>
          <View style={s.card}>
            {[...sec.list]
              .sort(
                (a, b) =>
                  Number(stars.has(b.id)) - Number(stars.has(a.id)) ||
                  a.name.localeCompare(b.name),
              )
              .map((v, n) => (
                <Pressable
                  key={v.id}
                  accessibilityRole="button"
                  accessibilityLabel={v.name}
                  onPress={() => onOpen(v.id)}
                  style={({ pressed }) => [
                    s.viewRow,
                    n > 0 && s.divider,
                    pressed && s.pressed,
                  ]}
                >
                  <View style={s.flex}>
                    <Text style={s.viewName}>{v.name}</Text>
                    <Text style={shared.small}>
                      {VIEW_SOURCE_LABELS[v.source]} ·{" "}
                      {VIEW_LAYOUT_LABELS[v.definition.layout]}
                    </Text>
                  </View>
                  {stars.has(v.id) && (
                    <Icon name="starFilled" size={14} color={colors.accent} />
                  )}
                  {v.pinned && (
                    <Icon name="pin" size={14} color={colors.muted} />
                  )}
                  <Icon name="chevronRight" size={16} color={colors.faint} />
                </Pressable>
              ))}
          </View>
        </View>
      ))}
    </>
  );
}

/** The ⋯ beside an open view: rename, pin, share, duplicate, CSV, delete. */
function ViewMenu({
  busy,
  view,
  userId,
  teams,
  onRename,
  onPin,
  onShare,
  onDuplicate,
  onExport,
  onDelete,
}: {
  busy: boolean;
  view: SavedView;
  userId?: string;
  teams: Team[];
  onRename: () => void;
  onPin: () => void;
  onShare: (teamId: string | null) => Promise<boolean>;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const mine = view.user_id === userId;
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState("");
  const sharingLock = useRef(false);
  const [sharingBusy, setSharingBusy] = useState(false);
  const sharingAlive = useRef(true);
  useEffect(() => {
    sharingAlive.current = true;
    return () => {
      sharingAlive.current = false;
    };
  }, []);
  const [shareTarget, setShareTarget] = useState(view.team_id ?? "");
  const sharingOwner = useRef({ id: view.id, account: session.token });
  useEffect(() => setSharing(false), [view.id, userId]);
  return (
    <>
      <MoreMenu
        label="View options"
        disabled={busy}
        title={view.name}
        actions={[
          ...(view.can_edit ? [{ label: "Rename", onPress: onRename }] : []),
          {
            label: view.pinned ? "Unpin from Browse" : "Pin to Browse",
            onPress: onPin,
          },
          ...(mine
            ? [
                {
                  label: "Sharing…",
                  onPress: () => {
                    sharingOwner.current = {
                      id: view.id,
                      account: session.token,
                    };
                    setShareError("");
                    setShareTarget(view.team_id ?? "");
                    setSharing(true);
                  },
                },
              ]
            : []),
          { label: "Duplicate", onPress: onDuplicate },
          { label: "Export as CSV", onPress: onExport },
          ...(view.can_edit
            ? [{ label: "Delete view", destructive: true, onPress: onDelete }]
            : []),
        ]}
      />
      <BottomSheet
        visible={sharing}
        title="Share view"
        closeDisabled={busy || sharingBusy}
        onClose={() => {
          if (!sharingLock.current) setSharing(false);
        }}
        footer={
          <SmallAction
            label={sharingBusy ? "Saving…" : "Save sharing"}
            disabled={
              busy || sharingBusy || shareTarget === (view.team_id ?? "")
            }
            onPress={() => {
              if (
                busy ||
                sharingOwner.current.id !== view.id ||
                sharingOwner.current.account !== session.token
              )
                return;
              if (
                shareTarget &&
                !teams.some(
                  (team) =>
                    team.id === shareTarget &&
                    hasTeamPermission(team.role, "items:write"),
                )
              ) {
                setShareError("Choose a team you can write to.");
                return;
              }
              if (sharingLock.current) return;
              sharingLock.current = true;
              setSharingBusy(true);
              setShareError("");
              const target = { ...sharingOwner.current };
              void (async () => {
                try {
                  const saved = await onShare(shareTarget || null);
                  if (
                    !sharingAlive.current ||
                    target.id !== sharingOwner.current.id ||
                    target.account !== session.token
                  )
                    return;
                  if (saved) setSharing(false);
                  else setShareError("Couldn't save sharing. Try again.");
                } catch (e) {
                  if (sharingAlive.current && target.account === session.token)
                    setShareError(errorText(e));
                } finally {
                  sharingLock.current = false;
                  if (sharingAlive.current && target.account === session.token)
                    setSharingBusy(false);
                }
              })();
            }}
          />
        }
      >
        <Text style={s.viewName}>{view.name}</Text>
        <ChoicePicker
          label="Shared with"
          value={shareTarget}
          disabled={busy || sharingBusy}
          options={[
            { value: "", label: "Only me" },
            ...teams
              .filter(
                (team) =>
                  team.id === view.team_id ||
                  hasTeamPermission(team.role, "items:write"),
              )
              .map((team) => ({ value: team.id, label: team.name })),
          ]}
          onChange={setShareTarget}
        />
        <ErrorBanner error={shareError} />
        <Text style={shared.small}>
          {shareTarget
            ? "Team members can open this view. Each sees only items they can access."
            : "Only you can open this view."}
        </Text>
      </BottomSheet>
    </>
  );
}

function OpenView({
  view,
  renaming,
  onRenaming,
  onRename,
  teams,
  userId,
  actions,
  onOpenRow,
  onBusyChange,
  draftStore,
  onCopy,
  report,
  error,
  onDismissError,
}: {
  view: SavedView;
  /** The new name being typed, while renaming. */
  renaming: string | null;
  onRenaming: (name: string | null) => void;
  onRename: (name: string) => Promise<boolean>;
  teams: Team[];
  userId?: string;
  actions: TaskActions;
  onOpenRow: (row: ViewRow) => void;
  onBusyChange: (busy: boolean) => void;
  draftStore: ViewDraftStore;
  onCopy: (def: ViewDefinition) => void;
  report: (e: unknown) => void;
  error: string;
  onDismissError: () => void;
}) {
  const planning = usePlanning();
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState("");
  const renamingNow = useRef(false);
  const rename = async () => {
    if (
      !current() ||
      renamingNow.current ||
      renaming === null ||
      !renaming.trim()
    )
      return;
    renamingNow.current = true;
    emitWork();
    setRenameBusy(true);
    setRenameError("");
    try {
      if (!(await onRename(renaming))) {
        if (current()) setRenameError("Couldn't rename. Try again.");
      }
    } catch {
      if (current()) setRenameError("Couldn't rename. Try again.");
    } finally {
      renamingNow.current = false;
      emitWork();
      if (current()) setRenameBusy(false);
    }
  };
  const [def, setDef] = useState<ViewDefinition>(
    () => draftStore.drafts.get(view.id) ?? view.definition,
  );
  const definitionRef = useRef(def);
  definitionRef.current = def;
  const saveState = draftStore.states[view.id];
  const [result, setResult] = useState<ViewResult | null>(null);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [stamp, setStamp] = useState(0);
  const owner = useRef(session.token);
  const alive = useRef(true);
  const edits = useRef(new Set<string>());
  const cellEditorOpen = useRef(false);
  const workReporter = useRef(onBusyChange);
  workReporter.current = onBusyChange;
  const emitWork = () =>
    workReporter.current(
      edits.current.size > 0 || renamingNow.current || cellEditorOpen.current,
    );
  useEffect(() => () => workReporter.current(false), []);
  const confirmedEdits = useRef(new Set<string>());
  const [refreshingRows, setRefreshingRows] = useState<Set<string>>(new Set());
  const rowRead = useRef(0);
  const [editingRows, setEditingRows] = useState<Set<string>>(new Set());
  const [queuedRows, setQueuedRows] = useState<Set<string>>(new Set());
  const [queueFailed, setQueueFailed] = useState(false);
  const previousQueue = useRef(new Set<string>());
  const resultDefinition = useRef("");
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsFailed, setRowsFailed] = useState(false);
  const current = () => alive.current && owner.current === session.token;
  useEffect(() => {
    alive.current = true;
    const queued = () => {
      if (!current()) return;
      const entries = outbox
        .outboxState()
        .entries.filter(
          (entry) =>
            entry.op.type === "item.update" || entry.op.type === "item.post",
        );
      const ids = new Set(
        entries.map((entry) => ("id" in entry.op ? entry.op.id : "")),
      );
      const settled = [...previousQueue.current].filter((id) => !ids.has(id));
      if (settled.length) {
        for (const id of settled) confirmedEdits.current.add(id);
        setRefreshingRows(new Set(confirmedEdits.current));
        rowRead.current += 1;
        setStamp((value) => value + 1);
      }
      previousQueue.current = ids;
      setQueuedRows(ids);
      setQueueFailed(entries.some((entry) => entry.state === "failed"));
    };
    queued();
    const stop = outbox.subscribeOutbox(queued);
    return () => {
      alive.current = false;
      stop();
    };
  }, []);
  // The account's time zone, as the server read the rows' days in it; the
  // phone's own until the first rows arrive.
  const tz =
    result?.time_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const reportRef = useRef(report);
  reportRef.current = report;

  useEffect(() => {
    let live = true;
    const request = ++rowRead.current;
    setRowsLoading(true);
    setRowsFailed(false);
    const key = JSON.stringify(def);
    if (resultDefinition.current !== key) setResult(null);
    const timer = setTimeout(() => {
      const awaitingRefresh = new Set(confirmedEdits.current);
      client.runDefinition(def).then(
        (r) => {
          if (live && current() && request === rowRead.current) {
            for (const id of awaitingRefresh) confirmedEdits.current.delete(id);
            setRefreshingRows(new Set(confirmedEdits.current));
            resultDefinition.current = key;
            setResult(r);
            setRowsLoading(false);
          }
        },
        (e) => {
          if (live && current() && request === rowRead.current) {
            setRowsFailed(true);
            setRowsLoading(false);
            reportRef.current(e);
          }
        },
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [def, stamp]);

  const change = (next: Partial<ViewDefinitionInput>) => {
    if (!current() || cellEditorOpen.current) return;
    const changed = fullDefinition({
      ...definitionRef.current,
      ...next,
    } as ViewDefinitionInput);
    rowRead.current += 1;
    definitionRef.current = changed;
    draftStore.change(view.id, changed, view.can_edit);
    setDef(changed);
  };
  const setFilters = (next: Partial<ViewFilters>) =>
    change({ filters: tidy({ ...definitionRef.current.filters, ...next }) });

  const names = useMemo(() => {
    const projects = new Map<string, string>();
    for (const r of result?.rows ?? [])
      if (r.project_id && r.project_name)
        projects.set(r.project_id, r.project_name);
    return {
      lists: planning.lists,
      tags: planning.tags,
      projects: [...projects].map(([id, name]) => ({ id, name })),
      userId,
      fields: result?.fields ?? [],
      people: result?.people ?? [],
    };
  }, [result, planning.lists, planning.tags, userId]);
  const groups = useMemo(
    () => (result ? groupRows(result.rows, def, names) : []),
    [result, def, names],
  );
  const edit = async (row: ViewRow, e: CellEdit) => {
    if (
      !current() ||
      !result?.rows.some(
        (candidate) => candidate.id === row.id && candidate.can_write,
      ) ||
      edits.current.has(row.id) ||
      confirmedEdits.current.has(row.id) ||
      queuedRows.has(row.id)
    )
      return false;
    edits.current.add(row.id);
    emitWork();
    setEditingRows(new Set(edits.current));
    try {
      const saved = await applyEdit(row, e, actions, tz);
      if (!current()) return false;
      if (saved === "saved") {
        // Do not offer another write against the pre-save row or accept a read
        // started before this receipt, especially for recurring completion.
        confirmedEdits.current.add(row.id);
        setRefreshingRows(new Set(confirmedEdits.current));
        rowRead.current += 1;
        setStamp((n) => n + 1);
      }
      return saved;
    } catch (error) {
      if (current()) report(error);
      return false;
    } finally {
      edits.current.delete(row.id);
      emitWork();
      if (current()) setEditingRows(new Set(edits.current));
    }
  };

  const fields = (result?.fields ?? []).filter((f) => f.type !== "text");
  const dateFields = (result?.fields ?? []).filter((f) => f.type === "date");
  const layouts = layoutsFor(def.source);
  return (
    <ScrollView
      contentContainerStyle={sheetStyles.body}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={() => setStamp((n) => n + 1)}
        />
      }
    >
      <View style={[sheetStyles.column, s.open]}>
        {!!error && <ErrorBanner error={error} onDismiss={onDismissError} />}
        <BottomSheet
          visible={renaming !== null}
          title="Rename view"
          closeDisabled={renameBusy}
          onClose={() => {
            if (!renamingNow.current) {
              onRenaming(null);
              setRenameError("");
            }
          }}
          footer={
            <SmallAction
              label={renameBusy ? "Saving…" : "Save"}
              disabled={renameBusy || !renaming?.trim()}
              onPress={() => void rename()}
            />
          }
        >
          <Text style={shared.label}>Name</Text>
          <TextInput
            style={shared.input}
            accessibilityLabel="View name"
            value={renaming ?? ""}
            maxLength={80}
            autoFocus
            editable={!renameBusy}
            returnKeyType="done"
            onChangeText={onRenaming}
            onSubmitEditing={() => void rename()}
          />
          {!!renameError && (
            <Text accessibilityRole="alert" style={shared.small}>
              {renameError}
            </Text>
          )}
        </BottomSheet>
        <Text style={shared.small}>
          {VIEW_SOURCE_LABELS[view.source]}
          {view.team_name ? ` · Shared with ${view.team_name}` : ""}
          {view.team_id && view.user_id !== userId && view.owner_name
            ? ` · by ${view.owner_name}`
            : ""}
        </Text>
        <ChoicePicker<ViewLayout>
          label="Layout"
          value={def.layout}
          options={layouts.map((layout) => ({
            value: layout,
            label: VIEW_LAYOUT_LABELS[layout],
          }))}
          onChange={(layout) => change({ layout })}
        />
        <Disclosure
          title="Filter, group and sort"
          detail={
            Object.keys(def.filters).length
              ? `${Object.keys(def.filters).length} filter${Object.keys(def.filters).length === 1 ? "" : "s"}`
              : "Everything"
          }
        >
          <View style={s.options}>
            {def.source !== "pages" && (
              <>
                <Text style={shared.label}>Status</Text>
                <ChipRow label="Status">
                  {(["open", "done", "any"] as const).map((st) => (
                    <Chip
                      key={st}
                      compact
                      label={
                        st === "open"
                          ? def.source === "projects"
                            ? "Active"
                            : "Open"
                          : st === "done"
                            ? def.source === "projects"
                              ? "Finished"
                              : "Done"
                            : "Any"
                      }
                      selected={(def.filters.status ?? "open") === st}
                      onPress={() =>
                        setFilters({ status: st === "open" ? undefined : st })
                      }
                    />
                  ))}
                </ChipRow>
                <Text style={shared.label}>Due</Text>
                <ChipRow label="Due">
                  {(Object.keys(DUE_LABELS) as Due[]).map((d) => (
                    <Chip
                      key={d}
                      compact
                      label={DUE_LABELS[d]}
                      selected={dueOf(def.filters) === d}
                      onPress={() =>
                        setFilters({
                          overdue: d === "overdue" || undefined,
                          no_due: d === "none" || undefined,
                          due_within_days:
                            d === "today"
                              ? 0
                              : d === "week"
                                ? 7
                                : d === "month"
                                  ? 30
                                  : undefined,
                        })
                      }
                    />
                  ))}
                </ChipRow>
              </>
            )}
            {teams.length > 0 && (
              <ChoicePicker
                label="Team"
                value={def.filters.team ?? ""}
                options={[
                  { value: "", label: "Everything" },
                  { value: "personal", label: "Only my own" },
                  ...teams.map((team) => ({
                    value: team.id,
                    label: team.name,
                  })),
                ]}
                onChange={(team) => setFilters({ team: team || undefined })}
              />
            )}
            <ChoicePicker
              label="Group by"
              value={def.group_by}
              options={[
                ...VIEW_GROUPS[def.source].map((group) => ({
                  value: group,
                  label: VIEW_GROUP_LABELS[group] ?? group,
                })),
                ...(def.source !== "tasks"
                  ? fields.map((field) => ({
                      value: `field:${field.id}`,
                      label: field.name,
                    }))
                  : []),
              ]}
              onChange={(group) =>
                change({ group_by: group as ViewDefinition["group_by"] })
              }
            />
            <ChoicePicker
              label="Sort by"
              value={def.sort.by}
              options={[
                ...VIEW_SORTS.filter(
                  (sort) =>
                    def.source === "tasks" ||
                    (sort !== "priority" && sort !== "estimate"),
                ).map((sort) => ({
                  value: sort,
                  label: VIEW_SORT_LABELS[sort],
                })),
                ...(def.source !== "tasks"
                  ? (result?.fields ?? []).map((field) => ({
                      value: `field:${field.id}` as const,
                      label: field.name,
                    }))
                  : []),
              ]}
              onChange={(sort) =>
                change({
                  sort: {
                    by: sort as ViewDefinition["sort"]["by"],
                    dir: def.sort.dir,
                  },
                })
              }
            />
            <Segmented
              options={["asc", "desc"] as const}
              value={def.sort.dir}
              labels={{ asc: "Ascending", desc: "Descending" }}
              onChange={(dir) => change({ sort: { ...def.sort, dir } })}
              accessibilityLabel="Sort direction"
            />
            {def.layout === "calendar" && def.source !== "tasks" && (
              <ChoicePicker
                label="Dates from"
                value={def.date_by ?? (def.source === "projects" ? "due" : "")}
                options={[
                  ...(def.source === "projects"
                    ? [{ value: "due", label: "Deadline" }]
                    : [{ value: "", label: "Choose a date field" }]),
                  ...dateFields.map((field) => ({
                    value: `field:${field.id}`,
                    label: field.name,
                  })),
                ]}
                onChange={(dateBy) =>
                  change({
                    date_by: (dateBy || undefined) as ViewDefinition["date_by"],
                  })
                }
              />
            )}
          </View>
        </Disclosure>
        {!view.can_edit && !same(def, view.definition) && (
          <View style={s.unsaved}>
            <Text style={s.unsavedText}>
              Your working copy. Shared settings are unchanged.
            </Text>
            <View style={s.newRow}>
              <SmallAction
                label="Save as my own view"
                disabled={false}
                onPress={() => onCopy(def)}
              />
              <SmallAction
                label="Reset changes"
                disabled={false}
                onPress={() => {
                  if (cellEditorOpen.current) return;
                  draftStore.drafts.delete(view.id);
                  setDef(view.definition);
                }}
              />
            </View>
          </View>
        )}
        {view.can_edit && saveState === "failed" && (
          <SmallAction
            label="Retry save"
            disabled={false}
            onPress={() => draftStore.change(view.id, def, true, true)}
          />
        )}
        {view.can_edit && saveState === "saving" && (
          <Text style={shared.small} accessibilityLiveRegion="polite">
            Saving view…
          </Text>
        )}
        {(editingRows.size > 0 ||
          queuedRows.size > 0 ||
          (rowsLoading && !!result)) && (
          <Text style={shared.small} accessibilityLiveRegion="polite">
            {editingRows.size > 0
              ? "Saving changes…"
              : queuedRows.size > 0
                ? queueFailed
                  ? "Changes need attention in Sync."
                  : "Waiting to sync."
                : "Updating results…"}
          </Text>
        )}
        {rowsFailed && (
          <SmallAction
            label="Retry results"
            disabled={rowsLoading}
            onPress={() => setStamp((n) => n + 1)}
          />
        )}
        {result ? (
          <ViewBody
            onEditorOpenChange={(open) => {
              cellEditorOpen.current = open;
              emitWork();
            }}
            blockedRows={
              new Set([...editingRows, ...refreshingRows, ...queuedRows])
            }
            def={def}
            result={result}
            groups={groups}
            timeZone={tz}
            folded={folded}
            onToggleFold={(key) =>
              setFolded((f) => {
                const next = new Set(f);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
            onOpen={onOpenRow}
            onEdit={edit}
          />
        ) : (
          <Text style={shared.small}>
            {rowsFailed ? "Results unavailable." : "Loading results…"}
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

/** A new view: what it shows, a name, where to start and who has it. */
function NewView({
  draftStore,
  teams,
  onCancel,
  onCreate,
}: {
  draftStore: ViewDraftStore;
  teams: Team[];
  onCancel: () => void;
  onCreate: (
    name: string,
    definition: ViewDefinitionInput,
    teamId: string | null,
  ) => Promise<unknown>;
}) {
  const [source, setSource] = useState<ViewSource>(
    draftStore.creation?.source ?? "tasks",
  );
  const [name, setName] = useState(draftStore.creation?.name ?? "");
  const [preset, setPreset] = useState<number | null>(
    draftStore.creation?.preset ?? null,
  );
  const [teamId, setTeamId] = useState<string | null>(
    draftStore.creation?.team_id ?? null,
  );
  useEffect(() => {
    draftStore.keepCreation({ source, name, preset, team_id: teamId });
  }, [source, name, preset, teamId, draftStore]);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const alive = useRef(true);
  const owner = useRef(session.token);
  const current = () => alive.current && owner.current === session.token;
  const [createError, setCreateError] = useState("");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const presets = VIEW_PRESETS.map((p, n) => ({ ...p, n })).filter(
    (p) => p.definition.source === source,
  );
  const chosen = preset !== null ? VIEW_PRESETS[preset] : null;
  const finalName = name.trim() || chosen?.name || "";
  return (
    <View style={s.open}>
      <Text style={shared.label}>What it shows</Text>
      <Segmented
        options={VIEW_SOURCES}
        disabled={busy}
        value={source}
        labels={VIEW_SOURCE_LABELS}
        onChange={(v) => {
          if (writing.current || !current()) return;
          setSource(v);
          setPreset(null);
        }}
        accessibilityLabel="What it shows"
      />
      <Text style={shared.label}>Name</Text>
      <TextInput
        style={shared.input}
        accessibilityLabel="Name"
        placeholder={chosen?.name ?? "Exam week"}
        placeholderTextColor={colors.faint}
        value={name}
        maxLength={80}
        editable={!busy}
        onChangeText={setName}
      />
      {presets.length > 0 && (
        <>
          <Text style={shared.label}>Start from</Text>
          <ChipRow label="Start from">
            <Chip
              compact
              disabled={busy}
              label="Everything"
              selected={preset === null}
              onPress={() => {
                if (!writing.current) setPreset(null);
              }}
            />
            {presets.map((p) => (
              <Chip
                key={p.n}
                disabled={busy}
                compact
                label={p.name}
                accessibilityHint={p.blurb}
                selected={preset === p.n}
                onPress={() => {
                  if (!writing.current) setPreset(p.n);
                }}
              />
            ))}
          </ChipRow>
          {chosen && <Text style={shared.small}>{chosen.blurb}</Text>}
        </>
      )}
      {teams.length > 0 && (
        <>
          <ChoicePicker
            label="Shared with"
            value={teamId ?? ""}
            disabled={busy}
            options={[
              { value: "", label: "Only me" },
              ...teams
                .filter((team) => hasTeamPermission(team.role, "items:write"))
                .map((team) => ({ value: team.id, label: team.name })),
            ]}
            onChange={(id) => setTeamId(id || null)}
          />
          {teamId && (
            <Text style={shared.small}>
              Team members see only items they can access.
            </Text>
          )}
        </>
      )}
      {!!createError && (
        <Text accessibilityRole="alert" style={shared.small}>
          {createError}
        </Text>
      )}
      <View style={s.newRow}>
        <SmallAction label="Cancel" disabled={busy} onPress={onCancel} />
        <SmallAction
          label="Create view"
          disabled={busy || !finalName}
          onPress={() => {
            if (writing.current || !current()) return;
            if (
              teamId &&
              !teams.some(
                (team) =>
                  team.id === teamId &&
                  hasTeamPermission(team.role, "items:write"),
              )
            ) {
              setCreateError("Choose a team you can write to.");
              return;
            }
            writing.current = true;
            setCreateError("");
            setBusy(true);
            void onCreate(
              finalName,
              chosen?.definition ?? {
                source,
                layout: source === "pages" ? "gallery" : "list",
              },
              teamId,
            )
              .catch(() => {
                if (current())
                  setCreateError("Couldn’t create the view. Try again.");
              })
              .finally(() => {
                writing.current = false;
                if (current()) setBusy(false);
              });
          }}
        />
      </View>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    flex: { flex: 1, minWidth: 0 },
    center: { textAlign: "center" },
    headActions: { flexDirection: "row", alignItems: "center", gap: 6 },
    headButton: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radii.pill,
    },
    newRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    gapTop: { marginTop: 12 },
    section: { marginTop: 18 },
    card: {
      backgroundColor: colors.surface,
      paddingHorizontal: 0,
    },
    viewRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 60,
      paddingVertical: 10,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    pressed: { backgroundColor: colors.surfaceMuted },
    viewName: {
      fontFamily: fonts.medium,
      fontSize: 15,
      color: colors.text,
      flexShrink: 1,
    },
    open: { gap: 12 },
    options: { gap: 6, paddingTop: 4 },
    unsaved: {
      gap: 8,
      padding: 12,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.warningBorder,
      backgroundColor: colors.warningSoft,
    },
    unsavedText: {
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.warningStrong,
    },
  }),
);
