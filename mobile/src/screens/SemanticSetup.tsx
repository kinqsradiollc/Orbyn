import React, { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, TextInput, View } from "react-native";
import type { AiSettings } from "@orbyn/core";
import { client } from "../lib/api";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Pill } from "../components/Pill";
import { FadeIn } from "../motion";
import { colors, fonts, themed } from "../theme";
import { shared } from "../styles";

/**
 * Search by meaning's own setup in the admin console (as on the web): off
 * by default, and on only with the pgvector image, the measuring service, a
 * model that measures text, and the admin's agreement that every page is
 * sent to the provider to be measured.
 */
export function SemanticSetup({
  settings,
  providerName,
  busy,
  act,
  onSettings,
}: {
  settings: AiSettings;
  providerName: string | null;
  busy: boolean;
  act: (fn: () => Promise<void>) => Promise<void>;
  onSettings: (s: AiSettings) => void;
}) {
  const [model, setModel] = useState(settings.embedding_model ?? "");
  const [accept, setAccept] = useState(false);
  useEffect(
    () => setModel(settings.embedding_model ?? ""),
    [settings.embedding_model],
  );
  const on = settings.semantic_search && !!settings.semantic_accepted_at;
  const steps = [
    {
      done: settings.semantic_possible,
      text: "The database can store measurements (the pgvector image).",
    },
    {
      done: !!settings.measure_running,
      text: "The measuring service is running.",
    },
    {
      done: settings.source === "database",
      text: "A provider is connected for the assistant.",
    },
  ];
  const ready = steps.every((x) => x.done);
  return (
    <FadeIn style={shared.card}>
      <View style={s.head}>
        <Text style={[shared.sectionTitle, { flex: 1 }]}>
          Search by meaning
        </Text>
        <Pill label={on ? "On" : "Off"} tone={on ? "accent" : "muted"} />
      </View>
      <Text style={shared.small}>
        Finds a page that says the same thing in other words. It stays off
        unless you set it up: every page is sent to the provider to be measured,
        not just the pages a question needs.
      </Text>
      <View style={s.steps}>
        {steps.map((x) => (
          <View key={x.text} style={s.step}>
            <Icon
              name={x.done ? "check" : "clock"}
              size={14}
              color={x.done ? colors.accent : colors.muted}
            />
            <Text style={[shared.small, x.done && { color: colors.text }]}>
              {x.text}
            </Text>
          </View>
        ))}
      </View>
      {on ? (
        <>
          <Text style={shared.body}>
            Measuring with {settings.embedding_model}
            {providerName ? ` on ${providerName}` : ""}.
          </Text>
          <Button
            secondary
            title="Turn off and forget the measurements"
            disabled={busy}
            onPress={() =>
              void act(async () =>
                onSettings(await client.setSemanticSearch({ on: false })),
              )
            }
          />
        </>
      ) : (
        <>
          <TextInput
            style={shared.input}
            value={model}
            editable={ready}
            maxLength={200}
            placeholder="Model that measures text"
            placeholderTextColor={colors.faint}
            accessibilityLabel="Model that measures text"
            onChangeText={setModel}
          />
          <View style={s.accept}>
            <Text style={[shared.small, { flex: 1 }]}>
              I understand that the words of every page (except projects kept
              out of the assistant) are sent to {providerName ?? "the provider"}{" "}
              to be measured.
            </Text>
            <Switch
              trackColor={{ true: colors.accent }}
              accessibilityLabel="I understand every page is sent to be measured"
              disabled={!ready}
              value={accept}
              onValueChange={setAccept}
            />
          </View>
          <Button
            title="Turn on search by meaning"
            disabled={busy || !ready || !accept || !model.trim()}
            onPress={() =>
              void act(async () => {
                onSettings(
                  await client.setSemanticSearch({
                    on: true,
                    embedding_model: model.trim(),
                    accept,
                  }),
                );
                setAccept(false);
              })
            }
          />
        </>
      )}
    </FadeIn>
  );
}

const s = themed(() =>
  StyleSheet.create({
    head: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 6,
    },
    steps: { gap: 6, marginVertical: 10 },
    step: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    accept: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginVertical: 10,
    },
    text: { fontFamily: fonts.regular, fontSize: 15, color: colors.text },
  }),
);
