import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Alert } from "../../lib/alert";
import { Pressable } from "../../motion";
import {
  describeRrule,
  findRepeat,
  firstRepeatDay,
  hasTeamPermission,
  localDateKey,
  repeatRrule,
  type Item,
  type ProjectTemplate,
  type Proposal,
  type Team,
} from "@orbyn/core";
import { MoreMenu } from "../../components/MoreMenu";
import { InlineDetails } from "../../components/InlineDetails";
import { Button } from "../../components/Button";
import { Chip, ChipRow } from "../../components/Chip";
import { Icon } from "../../components/Icon";
import { ProposalReview } from "../review/ProposalReview";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { deviceTimeZone } from "../planner/planning";
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";

/** A rhythm typed in plain words ("every other Friday"), as a rule. */
function rhythmFrom(text: string) {
  const zone = deviceTimeZone();
  const today = localDateKey(new Date(), zone);
  const found = findRepeat(text.trim(), today);
  if (!found || found.perPeriod) return null;
  const first = firstRepeatDay(found, today);
  return first ? repeatRrule(found, first) : null;
}

/**
 * Templates inside the Projects sheet: pick one, name the project, review
 * its plan, approve. Your own and your team's can start themselves on a
 * rhythm — you're asked to review each one, never surprised by it.
 */
export function TemplatesPanel({
  teams,
  items,
  initialId,
  busy,
  run,
  onStarted,
}: {
  teams: Team[];
  items: Item[];
  initialId?: string | null;
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<unknown>;
  onStarted: () => void;
}) {
  const mutation = useRef(false);
  const alive = useRef(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const act = async (work: () => Promise<void>) => {
    if (mutation.current || busy) return;
    mutation.current = true;
    try {
      return await run(work);
    } finally {
      mutation.current = false;
    }
  };
  const [templates, setTemplates] = useState<ProjectTemplate[] | null>(null);
  const [picked, setPicked] = useState<ProjectTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [teamId, setTeamId] = useState("");
  const [rhythm, setRhythm] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [state, setState] = useState<"pending" | "applied">("pending");
  const [note, setNote] = useState("");
  const writable = teams.filter((t) =>
    hasTeamPermission(t.role, "items:write"),
  );

  const choose = (t: ProjectTemplate) => {
    setPicked(t);
    setTitle(t.name);
    setTeamId(writable.some((team) => team.id === t.team_id) ? t.team_id! : "");
    setProposal(null);
    setState("pending");
    setRhythm("");
    setNote("");
  };
  const load = async () => {
    setLoadFailed(false);
    try {
      const all = await client.listTemplates();
      if (alive.current) setTemplates(all);
      return all;
    } catch (reason) {
      if (alive.current) setLoadFailed(true);
      throw reason;
    }
  };
  useEffect(() => {
    alive.current = true;
    void act(async () => {
      const all = await load();
      if (!alive.current) return;
      const first =
        initialId && all.find((template) => template.id === initialId);
      if (first) choose(first);
    });
    return () => {
      alive.current = false;
    };
  }, []);

  if (!picked)
    return (
      <View style={s.list}>
        {loadFailed && (
          <View accessibilityRole="alert">
            <Text style={shared.small}>Couldn't load templates.</Text>
            <SmallAction
              label="Retry"
              disabled={busy}
              onPress={() =>
                void act(async () => {
                  await load();
                })
              }
            />
          </View>
        )}
        {!loadFailed && templates?.length === 0 && (
          <Text style={shared.small}>No templates yet.</Text>
        )}
        {templates === null
          ? !loadFailed && <Text style={shared.small}>Loading…</Text>
          : (["team", "personal", "starter"] as const).map((source) => {
              const list = templates.filter((t) => t.source === source);
              if (!list.length) return null;
              return (
                <View key={source} style={s.group}>
                  <Text style={shared.eyebrow}>
                    {source === "starter"
                      ? "Starters"
                      : source === "team"
                        ? "Your teams"
                        : "Yours"}
                  </Text>
                  {list.map((t) => (
                    <Pressable
                      key={t.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${t.name}, ${t.tasks.length} tasks`}
                      disabled={busy}
                      onPress={() => {
                        if (!mutation.current) choose(t);
                      }}
                      style={({ pressed }) => [s.card, pressed && s.pressed]}
                    >
                      <Icon name="layoutGrid" size={17} color={colors.accent} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.name}>{t.name}</Text>
                        <Text style={shared.small}>
                          {t.description || `${t.tasks.length} tasks`}
                        </Text>
                        <Text style={s.meta}>
                          {t.tasks.length} tasks
                          {t.team_name ? ` · ${t.team_name}` : ""}
                          {t.rrule ? ` · ${describeRrule(t.rrule)}` : ""}
                        </Text>
                      </View>
                      <Icon
                        name="chevronRight"
                        size={16}
                        color={colors.muted}
                      />
                    </Pressable>
                  ))}
                </View>
              );
            })}
      </View>
    );

  if (proposal)
    return (
      <View style={s.list}>
        <Text style={shared.small}>
          Approve to create the project using your current calendar.
        </Text>
        <ProposalReview
          proposal={proposal}
          items={items}
          busy={busy}
          state={state}
          onApprove={() =>
            void act(async () => {
              await client.applyProposal(proposal.id);
              setState("applied");
              onStarted();
            })
          }
          onDiscard={() => {
            if (!mutation.current) setProposal(null);
          }}
        />
      </View>
    );

  const saveRhythm = () =>
    void act(async () => {
      const rrule = rhythm.trim() ? rhythmFrom(rhythm) : null;
      if (rhythm.trim() && !rrule)
        throw new Error(
          'Try a rhythm like "every other Friday" or "first Monday of the month".',
        );
      const saved =
        picked.source === "starter"
          ? await client.createTemplate({
              name: picked.name,
              description: picked.description,
              tasks: picked.tasks,
              page: picked.page,
              rrule,
            })
          : await client.updateTemplate(picked.id, { rrule });
      setPicked(saved);
      setRhythm("");
      setNote(
        saved.rrule
          ? `Saved. ${describeRrule(saved.rrule)}, you’ll be asked to review the next one.`
          : "Saved. It no longer starts itself.",
      );
      await load();
    });

  const preview = rhythm.trim() ? rhythmFrom(rhythm) : null;
  return (
    <View style={s.list}>
      <View style={s.headingRow}>
        <SmallAction
          label="All templates"
          disabled={busy}
          onPress={() => {
            if (!mutation.current) setPicked(null);
          }}
        />
        {picked.can_edit && (
          <MoreMenu
            label="Template options"
            disabled={busy}
            actions={[
              {
                label: "Delete template",
                destructive: true,
                onPress: () =>
                  Alert.alert(
                    `Delete “${picked.name}”?`,
                    "Projects made from it stay as they are.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: () =>
                          void act(async () => {
                            await client.deleteTemplate(picked.id);
                            setPicked(null);
                            await load();
                          }),
                      },
                    ],
                  ),
              },
            ]}
          />
        )}
      </View>
      {!!picked.description && (
        <Text style={shared.body}>{picked.description}</Text>
      )}
      <View style={shared.card}>
        {picked.tasks.map((t, n) => (
          <View key={t.id} style={[s.task, n > 0 && s.divider]}>
            <Text style={s.taskTitle}>{t.title}</Text>
            <Text style={shared.small}>
              Day {t.due_in_days + 1} · {t.estimate_minutes} min
              {t.target_value != null
                ? ` · target ${t.target_value}${t.value_unit ? " " + t.value_unit : ""}`
                : ""}
            </Text>
          </View>
        ))}
      </View>
      <Text style={shared.label}>Project name</Text>
      <TextInput
        style={shared.input}
        editable={!busy}
        value={title}
        maxLength={120}
        onChangeText={setTitle}
        accessibilityLabel="Project name"
      />
      {writable.length > 0 && (
        <ChipRow label="For">
          <Chip
            label="Just me"
            disabled={busy}
            selected={!teamId}
            onPress={() => setTeamId("")}
          />
          {writable.map((t) => (
            <Chip
              key={t.id}
              label={t.name}
              disabled={busy}
              selected={teamId === t.id}
              onPress={() => setTeamId(t.id)}
            />
          ))}
        </ChipRow>
      )}
      <Button
        title={busy ? "Planning…" : "Review plan"}
        disabled={busy}
        onPress={() =>
          void act(async () => {
            setProposal(
              await client.useTemplate(picked.id, {
                title: title.trim() || picked.name,
                team_id: teamId || null,
              }),
            );
            setState("pending");
          })
        }
      />

      {(picked.source === "starter" || picked.can_edit) && (
        <InlineDetails title="Repeat project">
          <View style={s.rhythm}>
            <Text style={shared.small}>
              {picked.rrule
                ? `${describeRrule(picked.rrule)}. You’re asked to review each one.`
                : "Each scheduled project needs your approval."}
            </Text>
            <TextInput
              style={shared.input}
              value={rhythm}
              editable={!busy}
              onChangeText={setRhythm}
              placeholder={
                picked.rrule
                  ? "A new rhythm, or empty to stop"
                  : "every other Friday"
              }
              placeholderTextColor={colors.faint}
              accessibilityLabel="Rhythm, in words"
            />
            {!!rhythm.trim() && (
              <Text style={shared.small}>
                {preview ? describeRrule(preview) : "Not a rhythm yet"}
              </Text>
            )}
            <SmallAction
              label={picked.source === "starter" ? "Save a copy" : "Save"}
              disabled={busy}
              onPress={saveRhythm}
            />
            {!!note && <Text style={s.note}>{note}</Text>}
          </View>
        </InlineDetails>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    list: { gap: 12 },
    headingRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 8,
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
    task: { paddingVertical: 8, gap: 2 },
    taskTitle: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    rhythm: { gap: 8 },
    note: { fontFamily: fonts.medium, fontSize: 13, color: colors.accent },
  }),
);
