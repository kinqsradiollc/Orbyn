import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import {
  CHARACTER_PRESETS,
  HOME_AGENT_GUIDE,
  HOME_AGENT_IDLE_NOTE,
  type AutomationAgentIdentity,
} from "@orbyn/core";
import { client } from "../lib/api";
import { session } from "../lib/session";
import { shared } from "../styles";
import { Character } from "./Character";
import { Pressable } from "../motion";
import { controls, colors } from "../theme";
import { AssistantAgents } from "../screens/AssistantAgents";

/** Same read-only character browsing as desktop, with wrapping native content. */
export function HomeCompanions({
  canOpen = false,
  onOpenChat = () => {},
}: { canOpen?: boolean; onOpenChat?: (id: string) => void } = {}) {
  const accountBinding = session.token;
  const [identityState, setIdentityState] = useState<{
    binding: string;
    values: Partial<
      Record<"background" | "overnight", AutomationAgentIdentity>
    >;
  }>({ binding: accountBinding, values: {} });
  const identities =
    identityState.binding === accountBinding ? identityState.values : {};
  const [expanded, setExpanded] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [openLane, setOpenLane] = useState<"background" | "overnight">(
    "background",
  );
  const [guideOpen, setGuideOpen] = useState(false);
  useEffect(() => {
    let live = true;
    const token = session.token;
    const updated = new Set<string>();
    const unsubscribe = client.onAutomationAgentIdentity((value) => {
      updated.add(value.lane);
      if (live && token === session.token)
        setIdentityState((old) => ({
          binding: token,
          values: {
            ...(old.binding === token ? old.values : {}),
            [value.lane]: value,
          },
        }));
    });
    for (const lane of ["background", "overnight"] as const) {
      void client.automationAgentIdentity(lane).then(
        (value) => {
          if (live && token === session.token && !updated.has(lane))
            setIdentityState((old) => ({
              binding: token,
              values: {
                ...(old.binding === token ? old.values : {}),
                [lane]: value,
              },
            }));
        },
        () => undefined,
      );
    }
    return () => {
      live = false;
      unsubscribe();
    };
  }, [accountBinding]);
  return (
    <View style={[shared.card, { gap: 14 }]}>
      <AssistantAgents
        visible={agentsOpen}
        lane={openLane}
        canOpen={canOpen}
        onClose={() => setAgentsOpen(false)}
        onOpenChat={onOpenChat}
      />
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
        }}
      >
        <View style={{ flexGrow: 1, flexBasis: 120, minWidth: 0 }}>
          <Text style={shared.sectionTitle}>Your agents</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(!expanded)}
          style={{ minHeight: controls.tap, justifyContent: "center" }}
        >
          <Text style={shared.small}>
            {expanded ? "Hide companions" : "Companions"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: guideOpen }}
          onPress={() => setGuideOpen(!guideOpen)}
          style={{ minHeight: controls.tap, justifyContent: "center" }}
        >
          <Text style={shared.small}>
            {guideOpen ? "Hide guide" : "How agents work"}
          </Text>
        </Pressable>
      </View>
      <View style={{ gap: 10 }}>
        {HOME_AGENT_GUIDE.map((agent) => (
          <View
            key={agent.name}
            style={{
              gap: 6,
              paddingVertical: 12,
              borderTopWidth: 1,
              borderTopColor: colors.border,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${agent.name} work`}
              onPress={() => {
                setOpenLane(
                  agent.name === "Background" ? "background" : "overnight",
                );
                setAgentsOpen(true);
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                minHeight: controls.tap,
              }}
            >
              <Character
                appearance={
                  identities[
                    agent.name === "Background" ? "background" : "overnight"
                  ]?.character
                }
                name={
                  identities[
                    agent.name === "Background" ? "background" : "overnight"
                  ]?.name ?? agent.name
                }
                size={40}
              />
              <View style={{ flex: 1 }}>
                <Text style={shared.sectionTitle}>
                  {identities[
                    agent.name === "Background" ? "background" : "overnight"
                  ]?.name ?? agent.name}
                </Text>
                {(identities[
                  agent.name === "Background" ? "background" : "overnight"
                ]?.name ?? agent.name) !== agent.name && (
                  <Text style={shared.small}>{agent.name}</Text>
                )}
              </View>
              <Text style={shared.small}>View work</Text>
            </Pressable>
            <Text style={shared.small}>
              {agent.name === "Background"
                ? "Assigned work between sessions"
                : "Work during your night window"}
            </Text>
            {guideOpen && (
              <View style={{ gap: 8, marginTop: 6 }}>
                <Text style={shared.small}>{agent.brief}</Text>
                <Text style={shared.small}>{agent.timing}</Text>
                <Text style={shared.small}>
                  {agent.result} {agent.pause}
                </Text>
              </View>
            )}
          </View>
        ))}
        {guideOpen && <Text style={shared.small}>{HOME_AGENT_IDLE_NOTE}</Text>}
      </View>
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
