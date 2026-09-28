import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { AssistantIdea } from "@orbyn/core";
import { client } from "../lib/api";
import { openReview } from "../lib/review";
import { FadeIn, PressableScale } from "../motion";
import { colors, fonts, themed } from "../theme";
import { shared } from "../styles";
import { Icon } from "./Icon";

/** Ready-to-review ideas surfaced on Today. */
export function AssistantIdeasCard() {
  const [ideas, setIdeas] = useState<AssistantIdea[]>([]);
  const [agentName, setAgentName] = useState("Orbyn");
  useEffect(() => {
    let live = true;
    void client
      .agentSettings()
      .then((value) => live && setAgentName(value.name || "Orbyn"))
      .catch(() => undefined);
    void client
      .assistantIdeas()
      .then(
        (rows) =>
          live &&
          setIdeas(
            rows
              .filter((idea) => idea.status === "pending" && idea.proposal_id)
              .slice(0, 3),
          ),
      )
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!ideas.length) return null;
  return (
    <FadeIn style={shared.card}>
      <View style={s.heading}>
        <Icon name="sparkles" size={16} color={colors.accent} />
        <View style={s.flex}>
          <Text style={shared.sectionTitle}>For today</Text>
          <Text style={shared.small}>
            Ideas from {agentName}, ready for Review.
          </Text>
        </View>
      </View>
      {ideas.map((idea) => (
        <PressableScale
          key={idea.id}
          accessibilityRole="button"
          accessibilityLabel={`Review idea: ${idea.title}`}
          onPress={() => idea.proposal_id && openReview(idea.proposal_id)}
          style={s.idea}
        >
          <View style={s.flex}>
            <Text style={s.title}>{idea.title}</Text>
            <Text style={shared.small}>{idea.summary}</Text>
          </View>
          <Text style={s.action}>Review</Text>
        </PressableScale>
      ))}
    </FadeIn>
  );
}

const s = themed(() =>
  StyleSheet.create({
    heading: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      marginBottom: 8,
    },
    flex: { flex: 1, minWidth: 0, gap: 3 },
    idea: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    title: { fontFamily: fonts.semibold, color: colors.text, fontSize: 15 },
    action: { fontFamily: fonts.semibold, color: colors.accent, fontSize: 13 },
  }),
);
