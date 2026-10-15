import React, { useCallback, useEffect, useRef, useState } from "react";
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
  delete_move_restore: "Delete, move or restore",
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
  disabled = false,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  return (
    <Field label={label}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${options.find((option) => option.id === value)?.label ?? value}`}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
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
          onPress: () => {
            if (!disabled) onChange(option.id);
          },
        }))}
        onClose={() => setOpen(false)}
      />
    </Field>
  );
}

export function AssistantRulesSection({ userId }: { userId: string }) {
  return <AssistantRulesBody key={userId} userId={userId} />;
}
function AssistantRulesBody({ userId }: { userId: string }) {
  const [revision, setRevision] = useState<number | null>(null);
  const [rules, setRules] = useState<AssistantActionRule[]>([]);
  const [saved, setSaved] = useState<AssistantActionRule[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const mounted = useRef(false);
  const request = useRef(0);
  const mutation = useRef(false);

  const reload = useCallback(async () => {
    if (!userId || mutation.current) return;
    const epoch = ++request.current;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const [value, membership] = await Promise.all([
        client.assistantRules(),
        client.listTeams(),
      ]);
      if (mounted.current && epoch === request.current) {
        setRevision(value.revision);
        setRules(value.rules);
        setSaved(value.rules);
        setTeams(membership.filter((team) => team.role !== null));
        setEditing(null);
      }
    } catch {
      if (mounted.current && epoch === request.current)
        setError("Couldn't load rules. Retry.");
    } finally {
      if (mounted.current && epoch === request.current) setLoading(false);
    }
  }, [userId]);
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, [reload]);

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
    if (revision === null || mutation.current || loading) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await client.replaceAssistantRules(revision, rules);
      if (!mounted.current) return;
      setRevision(value.revision);
      setRules(value.rules);
      setSaved(value.rules);
      setEditing(null);
      setNotice("Rules saved");
    } catch {
      if (mounted.current)
        setError("Couldn't save rules. Retry or reload the latest rules.");
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy(false);
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
              disabled={busy || loading}
              onPress={() => void reload()}
            />
          )}
        </View>
      ) : rules.length ? (
        rules.map((rule) => (
          <View key={rule.id} style={s.rule}>
            {editing === rule.id ? (
              <>
                <Choice
                  disabled={busy || loading}
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
                  disabled={busy || loading}
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
                  disabled={busy || loading}
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
                  disabled={busy || loading}
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
                disabled={busy || loading}
                onPress={() => setEditing(editing === rule.id ? null : rule.id)}
              />
              <SmallAction
                label="Remove"
                destructive
                disabled={busy || loading}
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
            disabled={busy || loading || rules.length >= 100}
            onPress={add}
          />
          <SmallAction
            label={
              loading
                ? "Reloading…"
                : JSON.stringify(rules) !== JSON.stringify(saved)
                  ? "Discard changes and reload"
                  : "Reload"
            }
            disabled={busy || loading}
            onPress={() => void reload()}
          />
        </View>
      )}
      {revision !== null && (
        <Button
          title={busy ? "Saving…" : "Save rules"}
          disabled={
            busy || loading || JSON.stringify(rules) === JSON.stringify(saved)
          }
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
