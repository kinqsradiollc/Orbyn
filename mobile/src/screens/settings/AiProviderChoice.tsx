import React, { useEffect, useRef, useState } from "react";
import { Text, View, Switch } from "react-native";
import type { AiProviderChoice } from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { errorText } from "../../lib/errors";
import { SmallAction } from "../../components/SmallAction";
import { shared } from "../../styles";
import { colors } from "../../theme";
export function AiProviderChoiceControls({
  userId,
  selection,
}: {
  userId: string;
  selection: { connection_id: string; executor_id: string } | null;
}) {
  const [ownedChoice, setOwnedChoice] = useState<{
      userId: string;
      token: string | null;
      value: AiProviderChoice;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const choice =
    ownedChoice?.userId === userId && ownedChoice.token === session.token
      ? ownedChoice.value
      : null;
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const abort = new AbortController(),
      token = session.token;
    lifetime.current?.abort();
    lifetime.current = abort;
    setOwnedChoice(null);
    setError(null);
    setBusy(false);
    if (!userId || !token) return () => abort.abort();
    void client.aiProviderChoice(abort.signal).then(
      (value) => {
        if (!abort.signal.aborted && token === session.token)
          setOwnedChoice({ userId, token, value });
      },
      (e) => {
        if (!abort.signal.aborted && token === session.token)
          setError(errorText(e));
      },
    );
    return () => abort.abort();
  }, [userId, reload]);
  const save = async (primary: "default" | "chatgpt", fallback: boolean) => {
    const active = lifetime.current;
    if (
      !choice ||
      busy ||
      !active ||
      active.signal.aborted ||
      (primary === "chatgpt" && !selection)
    )
      return;
    const token = session.token;
    setBusy(true);
    setError(null);
    try {
      const next = await client.saveAiProviderChoice(
        primary === "default"
          ? {
              primary,
              fallback_to_default: false,
              expected_version: choice.version,
            }
          : {
              primary,
              ...selection,
              fallback_to_default: fallback,
              expected_version: choice.version,
            },
        active.signal,
      );
      if (!active.signal.aborted && token === session.token)
        setOwnedChoice({ userId, token, value: next });
    } catch (e) {
      if (!active.signal.aborted && token === session.token)
        setError(errorText(e));
    } finally {
      if (!active.signal.aborted && token === session.token) setBusy(false);
    }
  };
  return (
    <View style={{ gap: 10 }}>
      <Text style={shared.label}>Provider</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <SmallAction
          label={
            choice?.primary === "default"
              ? "Orbyn default · selected"
              : "Orbyn default"
          }
          disabled={busy || !choice}
          onPress={() => void save("default", false)}
        />
        <SmallAction
          label={
            choice?.primary === "chatgpt" ? "ChatGPT · selected" : "ChatGPT"
          }
          disabled={busy || !choice || !selection}
          onPress={() =>
            void save("chatgpt", choice?.fallback_to_default ?? false)
          }
        />
      </View>
      {choice?.primary === "chatgpt" && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={[shared.body, { flex: 1 }]}>
            Use Orbyn default if ChatGPT is unavailable
          </Text>
          <Switch
            value={choice.fallback_to_default}
            disabled={busy || !selection}
            trackColor={{ true: colors.accent }}
            onValueChange={(value) => void save("chatgpt", value)}
          />
        </View>
      )}
      <Text style={shared.small}>
        Fallback uses Orbyn's configured provider. Interrupted or unknown
        ChatGPT results are not retried through it.
      </Text>
      {error && (
        <Text accessibilityRole="alert" style={shared.small}>
          {error}
        </Text>
      )}
      {error && (
        <SmallAction
          label="Reload provider"
          disabled={busy}
          onPress={() => setReload((value) => value + 1)}
        />
      )}
    </View>
  );
}
