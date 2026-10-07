import { useEffect, useState } from "react";
import {
  aiModelCapabilities,
  aiModelControlError,
  editedAiModelOptions,
  type AiProvider,
  type AiProviderOptions,
} from "@orbyn/core";
import { Select } from "../../components/Select";

/** Connection defaults checked against the model selected in this row. */
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
  const [open, setOpen] = useState(false);
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
    <div className="ai-model-controls">
      <button
        type="button"
        className="link-button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Model controls
      </button>
      {open && (
        <div className="ai-controls-body">
          <label>
            Reasoning effort
            <Select
              aria-label={`Reasoning effort for ${provider.name}`}
              value={effort}
              disabled={busy}
              onChange={(e) => setEffort(e.target.value)}
            >
              <option value="">Model default</option>
              {[...new Set([...caps.efforts, ...(effort ? [effort] : [])])].map(
                (value) => (
                  <option
                    key={value}
                    value={value}
                    disabled={!caps.efforts.includes(value)}
                  >
                    {value}
                  </option>
                ),
              )}
            </Select>
          </label>
          <label>
            Prompt cache
            <Select
              aria-label={`Prompt cache for ${provider.name}`}
              value={mode}
              disabled={busy}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="">Provider default</option>
              {[...new Set([...caps.cacheModes, ...(mode ? [mode] : [])])].map(
                (value) => (
                  <option
                    key={value}
                    value={value}
                    disabled={!caps.cacheModes.includes(value)}
                  >
                    {
                      (
                        {
                          implicit: "Conversation",
                          explicit: "Instructions",
                          off: "No cache writes",
                        } as Record<string, string>
                      )[value]
                    }
                  </option>
                ),
              )}
            </Select>
          </label>
          {(caps.retentions.length > 0 || retention) && (
            <label>
              Cache retention
              <Select
                aria-label={`Cache retention for ${provider.name}`}
                value={retention}
                disabled={busy}
                onChange={(e) => setRetention(e.target.value)}
              >
                <option value="">Provider default</option>
                {[
                  ...new Set([
                    ...caps.retentions,
                    ...(retention ? [retention] : []),
                  ]),
                ].map((value) => (
                  <option
                    key={value}
                    value={value}
                    disabled={!caps.retentions.includes(value)}
                  >
                    {value === "24h" ? "24 hours" : "In memory"}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {error && (
            <small role="alert" className="field-warning">
              {error}
            </small>
          )}
          <small className="field-hint">
            Applies to this connection. Cache reuse depends on the request.
          </small>
          <button
            type="button"
            className="secondary"
            disabled={busy || !changed || !!error}
            onClick={() => onSave(options, revision)}
          >
            Save model controls
          </button>
        </div>
      )}
    </div>
  );
}
