import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import {
  ASSISTANT_RULE_ACTIONS,
  type AssistantActionRule,
  type Team,
} from "@orbyn/core";
import { Button } from "../../components/Button";
import { Field } from "../../components/Field";
import { ActionSheet } from "../../components/MoreMenu";
import { SmallAction } from "../../components/SmallAction";
import { Pressable } from "../../motion";
import { client } from "../../lib/api";
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";
import { SettingsSection } from "./SettingsSection";

const actions: Record<AssistantActionRule["action"], string> = {
  read: "Read",
  any_change: "Any change",
  create: "Create",
  edit: "Edit",
  delete_move_restore: "Delete or move",
  email: "Email",
  notify: "Notify",
  publish: "Publish",
  fetch: "Fetch",
  handoff: "Handoff",
};
const lanes = {
  interactive: "Chat",
  background: "Background",
  overnight: "Overnight",
} as const;

function scopeName(rule: AssistantActionRule, teams: Team[]) {
  const scope = rule.scope;
  return scope.kind === "all"
    ? "Every space"
    : scope.kind === "personal"
      ? "Personal"
      : (teams.find((team) => team.id === scope.id)?.name ?? "Team");
}

/** One bounded native choice sheet, rather than several dense chip rows. */
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Field label={label}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${options.find((option) => option.id === value)?.label ?? value}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={s.choice}
      >
        <Text style={shared.body}>
          {options.find((option) => option.id === value)?.label ?? value}
        </Text>
      </Pressable>
      <ActionSheet
        visible={open}
        label={label}
        actions={options.map((option) => ({
          label: option.label,
          onPress: () => onChange(option.id),
        }))}
        onClose={() => setOpen(false)}
      />
    </Field>
  );
}

export function AssistantRulesSection({ userId }: { userId: string }) {
  const [revision, setRevision] = useState<number | null>(null);
  const [rules, setRules] = useState<AssistantActionRule[]>([]);
  const [saved, setSaved] = useState<AssistantActionRule[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const reload = async () => {
    const value = await client.assistantRules();
    setRevision(value.revision);
    setRules(value.rules);
    setSaved(value.rules);
    setEditing(null);
    setError("");
  };
  useEffect(() => {
    let live = true;
    setRevision(null);
    setRules([]);
    setSaved([]);
    if (!userId) return;
    void Promise.all([client.assistantRules(), client.listTeams()]).then(
      ([value, membership]) => {
        if (!live) return;
        setRevision(value.revision);
        setRules(value.rules);
        setSaved(value.rules);
        setTeams(membership.filter((team) => team.role !== null));
      },
      () => {
        if (live) setError("Couldn't load rules. Retry.");
      },
    );
    return () => {
      live = false;
    };
  }, [userId]);

  const change = (id: string, next: AssistantActionRule) =>
    setRules((list) => list.map((rule) => (rule.id === id ? next : rule)));
  const add = () => {
    const id = Crypto.randomUUID();
    setRules((list) => [
      ...list,
      {
        id,
        lane: "background",
        action: "any_change",
        scope: { kind: "all" },
        decision: "ask",
      },
    ]);
    setEditing(id);
    setNotice("");
  };
  const save = async () => {
    if (revision === null || busy) return;
    setBusy(true);
    setError("");
    try {
      const value = await client.replaceAssistantRules(revision, rules);
      setRevision(value.revision);
      setRules(value.rules);
      setSaved(value.rules);
      setEditing(null);
      setNotice("Rules saved");
    } catch {
      setError("Couldn't save rules. Reload if they changed elsewhere.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title="Assistant rules">
      <Text style={shared.small}>
        Limits for Orbyn's Chat, Background and Overnight agents.
      </Text>
      {revision === null ? (
        <View>
          <Text
            accessibilityRole={error ? "alert" : undefined}
            style={shared.small}
          >
            {error || "Loading rules…"}
          </Text>
          {!!error && (
            <SmallAction
              label="Retry"
              disabled={busy}
              onPress={() =>
                void reload().catch(() =>
                  setError("Couldn't load rules. Retry."),
                )
              }
            />
          )}
        </View>
      ) : rules.length ? (
        rules.map((rule) => (
          <View key={rule.id} style={s.rule}>
            {editing === rule.id ? (
              <>
                <Choice
                  label="Agent"
                  value={rule.lane}
                  options={Object.entries(lanes).map(([id, label]) => ({
                    id,
                    label,
                  }))}
                  onChange={(lane) =>
                    change(rule.id, {
                      ...rule,
                      lane: lane as AssistantActionRule["lane"],
                    })
                  }
                />
                <Choice
                  label="Action"
                  value={rule.action}
                  options={ASSISTANT_RULE_ACTIONS.map((id) => ({
                    id,
                    label: actions[id],
                  }))}
                  onChange={(action) =>
                    change(rule.id, {
                      ...rule,
                      action: action as AssistantActionRule["action"],
                    })
                  }
                />
                <Choice
                  label="Space"
                  value={
                    rule.scope.kind === "team" ? rule.scope.id : rule.scope.kind
                  }
                  options={[
                    { id: "all", label: "Every space" },
                    { id: "personal", label: "Personal" },
                    ...teams.map((team) => ({ id: team.id, label: team.name })),
                  ]}
                  onChange={(space) =>
                    change(rule.id, {
                      ...rule,
                      scope:
                        space === "all"
                          ? { kind: "all" }
                          : space === "personal"
                            ? { kind: "personal" }
                            : { kind: "team", id: space },
                    })
                  }
                />
                <Choice
                  label="Rule"
                  value={rule.decision}
                  options={[
                    { id: "allow", label: "Allow" },
                    { id: "ask", label: "Ask first" },
                    { id: "deny", label: "Block" },
                  ]}
                  onChange={(decision) =>
                    change(rule.id, {
                      ...rule,
                      decision: decision as AssistantActionRule["decision"],
                    })
                  }
                />
                {rule.action === "read" && rule.decision !== "allow" && (
                  <Text style={shared.small}>Agents skip this space.</Text>
                )}
              </>
            ) : (
              <Text style={shared.body}>
                {lanes[rule.lane]} · {actions[rule.action]} ·{" "}
                {scopeName(rule, teams)} · {rule.decision}
              </Text>
            )}
            <View style={s.actions}>
              <SmallAction
                label={editing === rule.id ? "Done" : "Edit"}
                disabled={busy}
                onPress={() => setEditing(editing === rule.id ? null : rule.id)}
              />
              <SmallAction
                label="Remove"
                destructive
                disabled={busy}
                onPress={() => {
                  setRules((list) =>
                    list.filter((item) => item.id !== rule.id),
                  );
                  setEditing(null);
                }}
              />
            </View>
          </View>
        ))
      ) : (
        <Text style={shared.small}>No extra rules.</Text>
      )}
      {revision !== null && (
        <View style={s.actions}>
          <SmallAction
            label="Add rule"
            disabled={busy || rules.length >= 100}
            onPress={add}
          />
          <SmallAction
            label="Reload"
            disabled={busy}
            onPress={() =>
              void reload().catch(() =>
                setError("Couldn't reload rules. Retry."),
              )
            }
          />
        </View>
      )}
      {revision !== null && (
        <Button
          title={busy ? "Saving…" : "Save rules"}
          disabled={busy || JSON.stringify(rules) === JSON.stringify(saved)}
          onPress={() => void save()}
        />
      )}
      {!!error && revision !== null && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      {!!notice && (
        <Text accessibilityLiveRegion="polite" style={shared.small}>
          {notice}
        </Text>
      )}
      <Text style={shared.small}>
        Rules restrict existing access. Block wins.
      </Text>
    </SettingsSection>
  );
}

const s = themed(() =>
  StyleSheet.create({
    rule: {
      padding: 12,
      gap: 10,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
    },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    choice: {
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
    },
    error: { color: colors.danger, fontFamily: fonts.medium },
  }),
);
