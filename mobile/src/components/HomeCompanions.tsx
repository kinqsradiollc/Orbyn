import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import {
  CHARACTER_PRESETS,
  HOME_AGENT_GUIDE,
  HOME_AGENT_IDLE_NOTE,
  type PersonalAgentSettings,
} from "@orbyn/core";
import { client } from "../lib/api";
import { shared } from "../styles";
import { Character } from "./Character";
import { Pressable } from "../motion";
import { controls } from "../theme";
import { AssistantAgents } from "../screens/AssistantAgents";
import { Button } from "./Button";

/** Same read-only character browsing as desktop, with wrapping native content. */
export function HomeCompanions({
  canOpen = false,
  onOpenChat = () => {},
}: { canOpen?: boolean; onOpenChat?: (id: string) => void } = {}) {
  const [identity, setIdentity] = useState<PersonalAgentSettings | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  useEffect(() => {
    let live = true;
    let updated = false;
    const unsubscribe = client.onAgentSettings((value) => {
      updated = true;
      if (live) setIdentity(value);
    });
    void client.agentSettings({ fresh: true }).then(
      (value) => live && !updated && setIdentity(value),
      () => undefined,
    );
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return (
    <View style={[shared.card, { gap: 14 }]}>
      <AssistantAgents
        visible={agentsOpen}
        identity={identity}
        canOpen={canOpen}
        onClose={() => setAgentsOpen(false)}
        onOpenChat={onOpenChat}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        {identity && (
          <Character
            appearance={identity.character}
            name={identity.name}
            size={56}
          />
        )}
        <View style={{ flex: 1 }}>
          <Text style={shared.sectionTitle}>
            {identity?.name ?? "Your companion"}
          </Text>
          <Text style={shared.small}>
            Choose its name and appearance in assistant settings.
          </Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={{ minHeight: controls.tap, justifyContent: "center" }}
      >
        <Text style={shared.small}>
          {expanded ? "Hide companions" : "Browse companions"}
        </Text>
      </Pressable>
      <View style={{ gap: 10 }}>
        {HOME_AGENT_GUIDE.map((agent) => (
          <View key={agent.name} style={{ gap: 4 }}>
            <Text style={shared.sectionTitle}>{agent.name}</Text>
            <Text style={shared.small}>{agent.summary}</Text>
            <Text style={shared.small}>{agent.result}</Text>
          </View>
        ))}
        <Text style={shared.small}>{HOME_AGENT_IDLE_NOTE}</Text>
      </View>
      <Button
        title="View agent activity"
        secondary
        onPress={() => setAgentsOpen(true)}
      />
      {expanded && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {CHARACTER_PRESETS.map(({ name, appearance }) => (
            <View
              key={name}
              style={{
                flexGrow: 1,
                flexBasis: 120,
                alignItems: "center",
                gap: 8,
                padding: 12,
              }}
            >
              <Character
                appearance={appearance}
                name={name}
                size={72}
                preview
              />
              <Text style={[shared.small, { textAlign: "center" }]}>
                {name}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
