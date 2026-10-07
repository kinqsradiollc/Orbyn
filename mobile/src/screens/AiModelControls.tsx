import React, { useEffect, useState } from "react";
import { Text } from "react-native";
import {
  aiModelCapabilities,
  aiModelControlError,
  editedAiModelOptions,
  type AiProvider,
  type AiProviderOptions,
} from "@orbyn/core";
import { Disclosure } from "../components/Disclosure";
import { Segmented } from "../components/Segmented";
import { Button } from "../components/Button";
import { shared } from "../styles";

/** Native controls use the same saved defaults and model capability contract as web. */
export function AiModelControls({
  provider,
  model,
  busy,
  onSave,
}: {
  provider: AiProvider;
  model: string;
  busy: boolean;
  onSave: (options: AiProviderOptions, revision: string) => void;
}) {
  const savedRevision = provider.controls_revision ?? provider.updated_at;
  const [revision, setRevision] = useState(savedRevision);
  useEffect(() => setRevision(savedRevision), [savedRevision]);
  const [effort, setEffort] = useState<string>(
    provider.options.reasoningEffort ?? "",
  );
  const [mode, setMode] = useState<string>(provider.options.cacheMode ?? "");
  const [retention, setRetention] = useState<string>(
    provider.options.cacheRetention ?? "",
  );
  const saved = JSON.stringify(provider.options);
  useEffect(() => {
    setEffort(provider.options.reasoningEffort ?? "");
    setMode(provider.options.cacheMode ?? "");
    setRetention(provider.options.cacheRetention ?? "");
  }, [provider.id, saved]);
  if (provider.kind !== "openai") return null;
  const caps = aiModelCapabilities(provider.kind, model.trim());
  const options = editedAiModelOptions(
    provider.options,
    effort,
    mode,
    retention,
  );
  const error = aiModelControlError(provider.kind, model.trim(), options);
  const changed =
    effort !== (provider.options.reasoningEffort ?? "") ||
    mode !== (provider.options.cacheMode ?? "") ||
    retention !== (provider.options.cacheRetention ?? "");
  return (
    <Disclosure
      title="Model controls"
      detail={model.trim() || "Choose a model first"}
    >
      <Text style={shared.label}>Reasoning effort</Text>
      <Segmented
        wrap
        accessibilityLabel={`Reasoning effort for ${provider.name}`}
        disabled={busy}
        options={["", ...caps.efforts]}
        labels={{ "": "Model default", xhigh: "Extra high", max: "Maximum" }}
        value={effort}
        onChange={setEffort}
      />
      <Text style={shared.label}>Prompt cache</Text>
      <Segmented
        wrap
        accessibilityLabel={`Prompt cache for ${provider.name}`}
        disabled={busy}
        options={["", ...caps.cacheModes]}
        labels={{
          "": "Provider default",
          implicit: "Conversation",
          explicit: "Instructions",
          off: "No cache writes",
        }}
        value={mode}
        onChange={setMode}
      />
      {(caps.retentions.length > 0 || retention) && (
        <>
          <Text style={shared.label}>Cache retention</Text>
          <Segmented
            wrap
            accessibilityLabel={`Cache retention for ${provider.name}`}
            disabled={busy}
            options={["", ...caps.retentions]}
            labels={{
              "": "Provider default",
              in_memory: "In memory",
              "24h": "24 hours",
            }}
            value={retention}
            onChange={setRetention}
          />
        </>
      )}
      {error && (
        <Text style={shared.small} accessibilityRole="alert">
          {error}
        </Text>
      )}
      <Text style={shared.small}>
        Applies to this connection. Cache reuse depends on the request.
      </Text>
      <Button
        secondary
        title="Save model controls"
        disabled={busy || !changed || !!error}
        onPress={() => onSave(options, revision)}
      />
    </Disclosure>
  );
}
