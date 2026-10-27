import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import {
  pluginAiPermissionInput,
  type PluginAiPermissionView,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { Field, NumberInput } from "../../components/Field";
import { Button } from "../../components/Button";
import { SmallAction } from "../../components/SmallAction";
import { shared } from "../../styles";

/** Explicit workspace-provider permission for a plugin; separate from personal ChatGPT. */
export function PluginAiPermission(props: {
  grantId: string;
  onBusyChange?: (grantId: string, busy: boolean) => void;
}) {
  return <PermissionBody key={props.grantId} {...props} />;
}
function PermissionBody({
  grantId,
  onBusyChange,
}: {
  grantId: string;
  onBusyChange?: (grantId: string, busy: boolean) => void;
}) {
  const mounted = useRef(true);
  const mutation = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PluginAiPermissionView | null>(null);
  const [output, setOutput] = useState("512"),
    [calls, setCalls] = useState("10");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    onBusyChange?.(grantId, pending);
    return () => onBusyChange?.(grantId, false);
  }, [grantId, pending, onBusyChange]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const controller = new AbortController();
    setView(null);
    setError("");
    void client
      .pluginAiPermission(grantId, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setView(next);
        setOutput(String(next.max_output_tokens));
        setCalls(String(next.daily_call_limit));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Could not load AI permission. Try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [grantId, open, refresh]);
  const save = async (enabled: boolean) => {
    if (!view || mutation.current || loading) return;
    const provider = view.available_provider;
    const input = pluginAiPermissionInput.safeParse({
      enabled,
      expected_version: view.version,
      ...(enabled && provider
        ? {
            provider: {
              id: provider.id,
              revision: provider.revision,
              model: provider.model,
            },
            max_output_tokens: Number(output),
            daily_call_limit: Number(calls),
          }
        : {}),
    });
    if (!input.success) {
      setError("Choose 1–2048 output tokens and 1–100 calls per day.");
      return;
    }
    mutation.current = true;
    setPending(true);
    setError("");
    try {
      const value = await client.setPluginAiPermission(grantId, input.data);
      if (mounted.current) setView(value);
    } catch {
      if (mounted.current)
        setError(
          "Permission changed or could not be saved. Refresh before trying again.",
        );
    } finally {
      mutation.current = false;
      if (mounted.current) setPending(false);
    }
  };
  return (
    <View style={shared.card}>
      <SmallAction
        label={open ? "Hide workspace AI" : "Workspace AI"}
        disabled={pending}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <>
          {view && (
            <>
              <Text style={shared.label}>
                {view.active
                  ? "Enabled"
                  : view.enabled
                    ? "Needs review"
                    : "Off"}
                {view.available_provider
                  ? ` · ${view.available_provider.name} · ${view.available_provider.model}`
                  : " · No workspace provider available"}
              </Text>
              <Text style={shared.small}>
                This plugin may send text to the workspace provider. Workspace
                usage may incur costs. Your ChatGPT plan is separate.
              </Text>
              <Field label="Output tokens per call">
                <NumberInput
                  value={output}
                  onChangeText={setOutput}
                  accessibilityLabel="Output tokens per call"
                  editable={!pending}
                />
              </Field>
              <Field label="Calls per day (UTC)">
                <NumberInput
                  value={calls}
                  onChangeText={setCalls}
                  accessibilityLabel="Calls per day"
                  editable={!pending}
                />
              </Field>
              <Button
                title={view.enabled ? "Save permission" : "Allow workspace AI"}
                disabled={pending || !view.available_provider}
                onPress={() => void save(true)}
              />
              {view.enabled && (
                <SmallAction
                  label="Turn off"
                  disabled={pending}
                  onPress={() => void save(false)}
                />
              )}
            </>
          )}
          {!view && !error && (
            <Text style={shared.small}>Loading permission…</Text>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={shared.small}>
              {error}
            </Text>
          )}
          <SmallAction
            label="Refresh permission"
            disabled={pending || loading}
            onPress={() => setRefresh(refresh + 1)}
          />
        </>
      )}
    </View>
  );
}
