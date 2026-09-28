import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { AssistantIdea } from "@orbyn/core";
import { client } from "../lib/api";
import { openReview } from "../lib/review";
import { FadeIn } from "../motion";
import { fonts, colors, themed } from "../theme";
import { shared } from "../styles";
import { SmallAction } from "./SmallAction";

/**
 * Ready-to-review ideas surfaced on Today, laid out like "Needs a look": a
 * heading, then one row per idea (title, then its summary) with Review.
 */
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
      <Text style={shared.sectionTitle} accessibilityRole="header">
        For today
      </Text>
      <Text style={[shared.small, s.hint]}>
        Ideas from {agentName}, ready to review.
      </Text>
      {ideas.map((idea) => {
        const detail = idea.summary?.trim() ?? "";
        return (
          <View key={idea.id} style={s.row}>
            <View style={s.flex}>
              <Text style={s.title} numberOfLines={1}>
                {idea.title}
              </Text>
              {!!detail && detail !== idea.title.trim() && (
                <Text style={shared.small} numberOfLines={2}>
                  {detail}
                </Text>
              )}
            </View>
            <SmallAction
              label="Review"
              disabled={!idea.proposal_id}
              onPress={() => idea.proposal_id && openReview(idea.proposal_id)}
            />
          </View>
        );
      })}
    </FadeIn>
  );
}

const s = themed(() =>
  StyleSheet.create({
    hint: { marginTop: 2, marginBottom: 12 },
    flex: { flex: 1, minWidth: 0 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 6,
    },
    title: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
  }),
);
