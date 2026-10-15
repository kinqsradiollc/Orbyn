import React, { useEffect, useRef, useState } from "react";
import { session } from "../lib/session";
import { errorText } from "../lib/errors";
import { ActionSheet } from "../components/MoreMenu";
import * as Crypto from "expo-crypto";
import { ScrollView, Text, TextInput, View } from "react-native";
import type { Team, User } from "@orbyn/core";
import { Button } from "../components/Button";
import { ErrorBanner } from "../components/ErrorBanner";
import type { Editing } from "../components/ItemEditor";
import { Sheet, sheetStyles } from "../components/Sheet";
import { TeamList } from "../components/TeamList";
import { client } from "../lib/api";
import { colors } from "../theme";
import { shared } from "../styles";
import { TeamDetailPage } from "./TeamDetail";

/**
 * Teams page sheet: your teams + create, with a team's detail pushed inside
 * the sheet. The selected team lives outside the Modal so it survives the
 * sheet being hidden while a team plan is open in the item editor.
 */
export function TeamsSheet(props: React.ComponentProps<typeof TeamsBody>) {
  return (
    <TeamsBody key={`${session.token}:${props.user?.id ?? ""}`} {...props} />
  );
}
function TeamsBody({
  visible,
  user,
  teams,
  busy,
  error,
  clearError,
  act,
  refresh,
  onClose,
  onDismiss,
  onOpenItem,
  onOpenChange,
}: {
  visible: boolean;
  user: User | null;
  teams: Team[];
  busy: boolean;
  error: string;
  clearError: () => void;
  act: (fn: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
  onClose: () => void;
  onDismiss?: () => void;
  onOpenItem: (editing: Editing) => void;
  /** Open a page or task from the team's recent changes (SHR-02). */
  onOpenChange?: (kind: "doc" | "task", id: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [writing, setWriting] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [created, setCreated] = useState<Team | null>(null);
  const [localError, setLocalError] = useState("");
  const [discard, setDiscard] = useState(false);
  const teamBeforeLeave = useRef<(() => Promise<boolean>) | null>(null);
  const lock = useRef(false),
    mounted = useRef(true);
  const owner = useRef(session.token).current;
  const owns = () => mounted.current && session.token === owner;
  const requests = useRef(new Map<string, string>());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (created && teams.some((team) => team.id === created.id))
      setCreated(null);
  }, [created, teams]);
  const availableTeams =
    created && !teams.some((team) => team.id === created.id)
      ? [created, ...teams]
      : teams;
  const banner = <ErrorBanner error={error} onDismiss={clearError} />;
  const depart = (action: () => void) => {
    if (busy || writing || detailBusy || lock.current || !owns()) return;
    void (async () => {
      if (teamBeforeLeave.current && !(await teamBeforeLeave.current())) return;
      if (owns()) action();
    })();
  };
  const close = () =>
    depart(() => {
      setSelected(null);
      clearError();
      onClose();
    });
  const closeCreate = () => {
    if (busy || lock.current || !owns()) return;
    if (name.trim()) setDiscard(true);
    else {
      setCreating(false);
      setLocalError("");
    }
  };
  const create = async () => {
    const value = name.trim();
    if (!value || busy || lock.current || !owns()) return;
    lock.current = true;
    setWriting(true);
    setLocalError("");
    const request = requests.current.get(value) ?? Crypto.randomUUID();
    requests.current.set(value, request);
    try {
      const team = await client.once(request, () =>
        client.createTeam({ name: value }),
      );
      if (!owns()) return;
      setCreated(team);
      setName("");
      setCreating(false);
      setSelected(team.id);
      try {
        await refresh();
      } catch (e) {
        if (owns()) setLocalError("Team created. Couldn't refresh teams.");
      }
    } catch (e) {
      if (owns()) setLocalError(errorText(e));
    } finally {
      lock.current = false;
      if (owns()) setWriting(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      title={selected ? "Team" : "Teams"}
      guardedClose
      closeDisabled={busy || writing || detailBusy}
      onClose={close}
      onBack={selected ? () => depart(() => setSelected(null)) : undefined}
      onDismiss={onDismiss}
    >
      {selected ? (
        <TeamDetailPage
          key={selected}
          teamId={selected}
          beforeLeave={teamBeforeLeave}
          onBusyChange={setDetailBusy}
          user={user}
          busy={busy}
          act={act}
          banner={
            <>
              {banner}
              <ErrorBanner
                error={localError}
                onDismiss={() => setLocalError("")}
              />
            </>
          }
          onGone={() => {
            setCreated(null);
            setSelected(null);
          }}
          onChanged={refresh}
          onOpenItem={onOpenItem}
          onOpenChange={onOpenChange}
        />
      ) : (
        <ScrollView
          contentContainerStyle={sheetStyles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
        >
          <View style={sheetStyles.column}>
            {banner}
            <ErrorBanner error={localError} />
            <Button
              title="New team"
              icon="plus"
              disabled={busy || writing}
              onPress={() => setCreating(true)}
            />
            {availableTeams.length > 0 ? (
              <TeamList
                teams={availableTeams}
                onSelect={(t) => setSelected(t.id)}
              />
            ) : (
              <Text style={shared.small}>No teams yet.</Text>
            )}
          </View>
        </ScrollView>
      )}
      <Sheet
        visible={creating}
        title="New team"
        guardedClose
        closeDisabled={busy || writing}
        onClose={closeCreate}
      >
        <ScrollView
          contentContainerStyle={sheetStyles.body}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <View style={sheetStyles.column}>
            <Text style={shared.label}>Team name</Text>
            <TextInput
              style={shared.input}
              value={name}
              onChangeText={setName}
              editable={!writing}
              maxLength={80}
              placeholder="Team name"
              accessibilityLabel="Team name"
              placeholderTextColor={colors.faint}
              returnKeyType="done"
              onSubmitEditing={() => {
                void create();
              }}
            />
            <ErrorBanner error={localError} />
            <Button
              title={writing ? "Creating…" : "Create team"}
              disabled={busy || writing || !name.trim()}
              onPress={() => {
                void create();
              }}
            />
          </View>
        </ScrollView>
      </Sheet>
      <ActionSheet
        visible={discard}
        label="Discard team draft"
        title="Discard this team draft?"
        actions={[
          {
            label: "Discard",
            destructive: true,
            onPress: () => {
              if (owns()) {
                setName("");
                setLocalError("");
                setCreating(false);
              }
            },
          },
        ]}
        onClose={() => setDiscard(false)}
      />
    </Sheet>
  );
}
