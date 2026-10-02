import React, { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { AI_PROVIDERS, type AiProvider, type AiSettings } from "@orbyn/core";
import { Segmented } from "../components/Segmented";
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
  providers,
  busy,
  act,
  onSettings,
  onChanged,
}: {
  settings: AiSettings;
  providers: AiProvider[];
  busy: boolean;
  act: (fn: () => Promise<void>) => Promise<void>;
  onSettings: (s: AiSettings) => void;
  onChanged: () => Promise<void>;
}) {
  const [model, setModel] = useState(settings.embedding_model ?? "");
  const [accept, setAccept] = useState(false);
  const [providerId, setProviderId] = useState(
    settings.embedding_provider_id ?? "",
  );
  useEffect(() => {
    setModel(settings.embedding_model ?? "");
    setProviderId(settings.embedding_provider_id ?? "");
    setAccept(false);
  }, [
    settings.embedding_model,
    settings.embedding_provider_id,
    settings.embedding_generation,
  ]);
  const eligible = providers.filter(
    (provider) =>
      provider.enabled && AI_PROVIDERS[provider.kind].format !== "anthropic",
  );
  const selected = eligible.find((provider) => provider.id === providerId);
  const providerName = providers.find(
    (provider) => provider.id === settings.embedding_provider_id,
  )?.name;
  const on = settings.semantic_search && !!settings.semantic_accepted_at;
  const steps = [
    {
      done: settings.semantic_possible,
      text: settings.semantic_possible
        ? "The database can store measurements."
        : "Database measurements are unavailable.",
    },
    {
      done: !!settings.measure_running,
      text: settings.measure_running
        ? "The measuring service is running."
        : "The measuring service is offline.",
    },
    {
      done: !!selected,
      text: selected
        ? "An independent embedding provider is selected."
        : "Select an embedding provider.",
    },
  ];
  const ready = steps.every((x) => x.done);
  const change = (next: boolean) =>
    act(async () => {
      try {
        onSettings(
          await client.setSemanticSearch(
            next
              ? {
                  on: true,
                  embedding_model: model.trim(),
                  embedding_provider_id: providerId,
                  expected_generation: settings.embedding_generation,
                  accept,
                }
              : {
                  on: false,
                  expected_generation: settings.embedding_generation,
                },
          ),
        );
      } finally {
        setAccept(false);
        await onChanged();
      }
    });
  return (
    <FadeIn style={shared.card}>
      <View style={s.head}>
        <Text style={[shared.sectionTitle, { flex: 1 }]}>
          Search by meaning
        </Text>
        <Pill label={on ? "On" : "Off"} tone={on ? "accent" : "muted"} />
      </View>
      {settings.embedding_needs_validation && (
        <Text style={shared.small}>
          The saved provider changed or was removed. Validate a provider again
          before any more page text is sent.
        </Text>
      )}
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
          <Text accessibilityLiveRegion="polite" style={shared.small}>
            {typeof settings.embedding_indexed_pages === "number" &&
            typeof settings.embedding_pending_pages === "number"
              ? `${settings.embedding_indexed_pages} pages measured; ${settings.embedding_pending_pages} pages waiting.`
              : "Indexing status is unavailable. Refresh to check again."}
            {!settings.measure_running &&
              " The measuring service is offline; queued pages will wait until it starts."}
          </Text>
          <Button
            secondary
            title="Refresh indexing status"
            disabled={busy}
            onPress={() => void act(onChanged)}
          />
          <Text style={shared.body}>
            Measuring with {settings.embedding_model}
            {providerName ? ` on ${providerName}` : ""}.{" "}
            {settings.embedding_dimensions
              ? `${settings.embedding_dimensions} dimensions verified.`
              : ""}
          </Text>
          <Button
            secondary
            title="Turn off and forget the measurements"
            disabled={busy}
            onPress={() => void change(false)}
          />
        </>
      ) : (
        <>
          <Text style={shared.label}>Embedding provider</Text>
          <Segmented
            wrap
            options={eligible.map((provider) => provider.id)}
            labels={Object.fromEntries(
              eligible.map((provider) => [provider.id, provider.name]),
            )}
            value={providerId}
            accessibilityLabel="Embedding provider"
            disabled={busy || !settings.semantic_possible}
            onChange={(next) => {
              setProviderId(next);
              setModel("");
              setAccept(false);
            }}
          />
          {!eligible.length && (
            <Text style={shared.small}>
              Add and enable an OpenAI-compatible or Azure provider below. Chat
              can remain off.
            </Text>
          )}
          <TextInput
            style={shared.input}
            value={model}
            editable={ready}
            maxLength={200}
            placeholder="Model that measures text"
            placeholderTextColor={colors.faint}
            accessibilityLabel="Model that measures text"
            onChangeText={(next) => {
              setModel(next);
              setAccept(false);
            }}
          />
          <View style={s.accept}>
            <Text style={[shared.small, { flex: 1 }]}>
              I understand that the words of every page (except projects and
              teams kept out of the assistant) are sent to{" "}
              {selected?.name ?? "the selected embedding provider"} to be
              measured.
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
            title="Validate and turn on search by meaning"
            disabled={busy || !ready || !accept || !model.trim()}
            onPress={() => void change(true)}
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
