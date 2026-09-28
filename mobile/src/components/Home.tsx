import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  DEFAULT_HOME,
  friendlyDay,
  HUB_LINK_KIND_LABELS,
  homePanels,
  type DocSummary,
  type HomeHub,
  type HomeLayout,
  type HomeSummary,
  type HubLink,
  type Project,
  type StudyOverview,
} from "@orbyn/core";
import { client } from "../lib/api";
import { CoverImage, LookIconView } from "./Look";
import { Pressable } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { ProgressBar } from "./ProgressBar";
import { AssistantUpcoming } from "./AssistantUpcoming";

/**
 * Home on the phone (W1, W6): a compact strip of the same hubs as the web,
 * and the goals, routines and reflection panels, on the Today tab. The
 * layout is the account's (prefs.home); arranging it is the web's.
 */

// ---------------------------------------------------------------- hubs ---

type Sources = {
  projects: Project[];
  docs: DocSummary[];
  study: StudyOverview | null;
};

function linksOf(hub: HomeHub, s: Sources): HubLink[] {
  if (hub.links.length || !hub.auto) return hub.links;
  if (hub.auto === "projects")
    return s.projects
      .filter((p) => p.status === "active")
      .slice(0, 3)
      .map((p) => ({ kind: "project", id: p.id, label: p.name }));
  if (hub.auto === "study")
    return (s.study?.decks ?? []).slice(0, 3).map((d) => ({
      kind: "deck",
      id: d.doc_id,
      label: d.title || "Untitled",
    }));
  return s.docs
    .filter((d) => d.kind !== "agenda")
    .slice(0, 3)
    .map((d) => ({ kind: "page", id: d.id, label: d.title || "Untitled" }));
}

/** The hubs, side by side, three links each; swipe for more. */
function HubStrip({
  layout,
  onOpen,
}: {
  layout: HomeLayout;
  onOpen: (link: HubLink) => void;
}) {
  const [sources, setSources] = useState<Sources>({
    projects: [],
    docs: [],
    study: null,
  });
  useEffect(() => {
    let live = true;
    void Promise.all([
      client.listProjects().catch(() => [] as Project[]),
      client.listDocs().catch(() => [] as DocSummary[]),
      client.study().catch(() => null),
    ]).then(([projects, docs, study]) => {
      if (live) setSources({ projects, docs, study });
    });
    return () => {
      live = false;
    };
  }, []);
  if (!layout.hubs.length) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.strip}
      style={s.stripScroll}
    >
      {layout.hubs.map((hub) => {
        const links = linksOf(hub, sources).slice(0, 3);
        return (
          <View key={hub.id} style={s.hub}>
            <CoverImage fileId={hub.cover_file_id} height={56} />
            <View style={s.hubBody}>
              <View style={s.hubHead}>
                <LookIconView icon={hub.icon} size={15} />
                <Text style={s.hubTitle} numberOfLines={1}>
                  {hub.title}
                </Text>
              </View>
              {links.length ? (
                links.map((l) => (
                  <Pressable
                    key={`${l.kind}:${l.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${l.label}, ${l.tag || HUB_LINK_KIND_LABELS[l.kind]}`}
                    onPress={() => onOpen(l)}
                    style={({ pressed }) => [s.hubLink, pressed && s.pressed]}
                    hitSlop={4}
                  >
                    <Text style={s.hubLinkText} numberOfLines={1}>
                      {l.label}
                    </Text>
                    <Text style={s.tag}>
                      {l.tag || HUB_LINK_KIND_LABELS[l.kind]}
                    </Text>
                  </Pressable>
                ))
              ) : (
                <Text style={shared.small}>Nothing here yet.</Text>
              )}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

// -------------------------------------------------------------- panels ---

function PanelHead({
  icon,
  title,
  action,
}: {
  icon: IconName;
  title: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={s.panelHead}>
      <Icon name={icon} size={18} color={colors.textSoft} />
      <Text style={[shared.sectionTitle, s.panelTitle]}>{title}</Text>
      {action && (
        <Pressable
          accessibilityRole="button"
          onPress={action.onPress}
          hitSlop={8}
          style={({ pressed }) => pressed && s.pressed}
        >
          <Text style={s.action}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * Home on the Today tab: the hub strip and the goals, routines and
 * reflection panels, in the account's order, hidden ones left out.
 */
export function HomeSection({
  layout,
  agentName,
  onOpenLink,
  onOpenStudy,
  onOpenDoc,
}: {
  layout: HomeLayout | undefined;
  agentName: string;
  onOpenLink: (link: { kind: "project" | "doc" | "view"; id: string }) => void;
  onOpenStudy: () => void;
  onOpenDoc: (id: string) => void;
}) {
  const home = layout ?? DEFAULT_HOME;
  const [data, setData] = useState<HomeSummary | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [upcoming, setUpcoming] = useState(false);
  useEffect(() => {
    let live = true;
    client.getHome().then(
      (d) => live && setData(d),
      () => live && setData(null),
    );
    return () => {
      live = false;
    };
  }, []);

  const add = async () => {
    const line = text.trim();
    if (!line || busy) return;
    setBusy(true);
    setNote("");
    try {
      const saved = await client.addReflection(line);
      setText("");
      setData((d) =>
        d
          ? { ...d, reflection: saved.reflection, agenda_doc_id: saved.doc_id }
          : d,
      );
      setNote("Added to today's agenda.");
    } catch {
      setNote("That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const openHubLink = (l: HubLink) => {
    if (l.kind === "deck") onOpenStudy();
    else if (l.kind === "page") onOpenLink({ kind: "doc", id: l.id });
    else onOpenLink({ kind: l.kind, id: l.id });
  };

  const panel = (p: string) => {
    if (p === "hubs")
      return <HubStrip key={p} layout={home} onOpen={openHubLink} />;
    if (p === "goals")
      return (
        <View key={p} style={shared.card}>
          <PanelHead
            icon="target"
            title="Goals"
            action={{ label: "Upcoming", onPress: () => setUpcoming(true) }}
          />
          {!data ? (
            <Text style={shared.small}>Loading…</Text>
          ) : data.goals.length ? (
            data.goals.map((g) => (
              <View key={g.id} style={s.row}>
                <Text style={s.rowTitle}>{g.title}</Text>
                {g.progress !== null && (
                  <ProgressBar
                    value={g.progress * 100}
                    height={6}
                    label={`Progress on ${g.title}`}
                  />
                )}
                <Text style={shared.small}>
                  {g.next_checkin
                    ? `Check-in ${friendlyDay(g.next_checkin)}`
                    : "Paused"}
                  {g.progress_label ? ` · ${g.progress_label}` : ""}
                </Text>
              </View>
            ))
          ) : (
            <Text style={shared.small}>
              No active goals. Add one in Upcoming.
            </Text>
          )}
        </View>
      );
    if (p === "routines")
      return (
        <View key={p} style={shared.card}>
          <PanelHead
            icon="repeat"
            title="Routines"
            action={{ label: "Upcoming", onPress: () => setUpcoming(true) }}
          />
          {!data ? (
            <Text style={shared.small}>Loading…</Text>
          ) : data.routines.length ? (
            data.routines.map((r) => (
              <View key={r.id} style={s.row}>
                <Text style={s.rowTitle} numberOfLines={2}>
                  {r.name}
                </Text>
                <Text style={shared.small}>
                  {new Date(r.next_run_at).toLocaleString([], {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: r.timezone,
                  })}
                </Text>
              </View>
            ))
          ) : (
            <Text style={shared.small}>No routines scheduled.</Text>
          )}
        </View>
      );
    return (
      <View key={p} style={shared.card}>
        <PanelHead icon="squarePen" title="Reflection" />
        {data?.brief && (
          <Pressable
            accessibilityRole="button"
            onPress={() => onOpenDoc(data.brief!.doc_id)}
            style={({ pressed }) => [s.brief, pressed && s.pressed]}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>Today's brief</Text>
              <Text style={shared.small} numberOfLines={1}>
                {data.brief.title}
              </Text>
            </View>
            <Icon name="arrowRight" size={16} color={colors.accent} />
          </Pressable>
        )}
        <TextInput
          style={shared.input}
          placeholder="How did today go?"
          placeholderTextColor={colors.faint}
          value={text}
          maxLength={500}
          onChangeText={setText}
          onSubmitEditing={() => void add()}
          returnKeyType="done"
          accessibilityLabel="How did today go?"
        />
        <View style={s.reflectRow}>
          {note ? (
            <Text style={[shared.small, { flex: 1 }]}>{note}</Text>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <Button
            title="Add"
            secondary
            disabled={busy || !text.trim()}
            onPress={() => void add()}
            style={s.addButton}
          />
        </View>
        {(data?.reflection ?? []).slice(-3).map((l, i) => (
          <Text key={i} style={s.reflection}>
            • {l}
          </Text>
        ))}
      </View>
    );
  };

  return (
    <>
      {homePanels(home).map(panel)}
      <AssistantUpcoming
        agentName={agentName}
        visible={upcoming}
        onClose={() => setUpcoming(false)}
      />
    </>
  );
}

const s = themed(() =>
  StyleSheet.create({
    stripScroll: { marginHorizontal: -20, marginBottom: 16 },
    // Hub cards in the strip line up at the same height.
    strip: { paddingHorizontal: 20, gap: 10, alignItems: "stretch" },
    hub: {
      width: 220,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: "hidden",
    },
    hubBody: { padding: 14, gap: 6 },
    hubHead: { flexDirection: "row", alignItems: "center", gap: 8 },
    hubTitle: {
      flex: 1,
      fontFamily: fonts.display,
      fontSize: 15,
      color: colors.text,
    },
    hubLink: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 34,
    },
    hubLinkText: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.text,
    },
    tag: {
      fontFamily: fonts.semibold,
      fontSize: 11,
      color: colors.textSoft,
      backgroundColor: colors.surfaceMuted,
      borderRadius: radii.pill,
      paddingHorizontal: 8,
      paddingVertical: 2,
      overflow: "hidden",
    },
    panelHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 10,
    },
    panelTitle: { flex: 1 },
    action: { fontFamily: fonts.semibold, fontSize: 13, color: colors.accent },
    row: { gap: 6, paddingVertical: 8 },
    rowTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    brief: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      padding: 12,
      marginBottom: 10,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
    },
    reflectRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 10,
    },
    addButton: { marginBottom: 0 },
    reflection: {
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.textSoft,
      marginTop: 6,
    },
    pressed: { opacity: 0.6 },
  }),
);
