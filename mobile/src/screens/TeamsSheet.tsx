import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { Team, User } from "@orbyn/core";
import { Button } from "../components/Button";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
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
export function TeamsSheet({
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
  const banner = <ErrorBanner error={error} onDismiss={clearError} />;
  const close = () => {
    setSelected(null);
    clearError();
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      title={selected ? "Team" : "Teams"}
      onClose={close}
      onBack={selected ? () => setSelected(null) : undefined}
      onDismiss={onDismiss}
    >
      {selected ? (
        <TeamDetailPage
          key={selected}
          teamId={selected}
          user={user}
          busy={busy}
          act={act}
          banner={banner}
          onGone={() => setSelected(null)}
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
            <Text style={[shared.subtitle, s.intro]}>
              Share plans with a team. Access depends on each person's role.
            </Text>
            {teams.length > 0 ? (
              <TeamList teams={teams} onSelect={(t) => setSelected(t.id)} />
            ) : (
              <View style={[shared.card, shared.empty]}>
                <View style={shared.emptyIcon}>
                  <Icon name="users" size={26} color={colors.accent} />
                </View>
                <Text style={shared.sectionTitle}>No teams yet.</Text>
                <Text style={[shared.subtitle, s.center]}>
                  Start one below, or ask a teammate to add you.
                </Text>
              </View>
            )}
            <View style={shared.card}>
              <Text style={shared.label}>Start a team</Text>
              <TextInput
                style={[shared.input, s.input]}
                value={name}
                onChangeText={setName}
                maxLength={80}
                placeholder="Team name"
                placeholderTextColor={colors.faint}
                returnKeyType="done"
              />
              <Button
                title="Create team"
                icon="plus"
                style={{ marginBottom: 0 }}
                disabled={busy || !name.trim()}
                onPress={() =>
                  act(async () => {
                    const team = await client.createTeam({ name: name.trim() });
                    setName("");
                    await refresh();
                    setSelected(team.id);
                  })
                }
              />
            </View>
          </View>
        </ScrollView>
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  intro: { marginTop: 0, marginBottom: 18 },
  center: { textAlign: "center" },
  input: { marginBottom: 12 },
});
