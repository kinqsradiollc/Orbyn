import {
  pluginAiPermissionInput,
  type PluginAiPermissionInput,
  type PluginAiPermissionView,
} from "@orbyn/core";
import { useState } from "react";
import { client } from "../../../lib/session";
import { Button, Field, Input } from "../../../ui/kit";
import { useSettingsExit, useSettingsRead } from "../shared";
import { ActionError, ReadState, useConnectionAction } from "./common";
function matchesAttempt(
  view: PluginAiPermissionView,
  input: PluginAiPermissionInput,
  id: string,
  receipt: boolean,
) {
  return (
    view.grant_id === id &&
    view.enabled === input.enabled &&
    (receipt
      ? view.version === input.expected_version + 1
      : view.version > input.expected_version) &&
    (!input.enabled ||
      (view.provider?.id === input.provider?.id &&
        view.provider?.revision === input.provider?.revision &&
        view.provider?.model === input.provider?.model &&
        view.max_output_tokens === input.max_output_tokens &&
        view.daily_call_limit === input.daily_call_limit))
  );
}
export function PluginAi({ id }: { id: string }) {
  const read = useSettingsRead(() => client.pluginAiPermission(id), [id]),
    action = useConnectionAction();
  const [output, setOutput] = useState("512"),
    [calls, setCalls] = useState("10"),
    [draft, setDraft] = useState(false),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState<PluginAiPermissionInput | null>(null);
  useSettingsExit({ dirty: draft });
  const save = (enabled: boolean) => {
    const view = read.data;
    if (!view || view.grant_id !== id || !read.fresh || action.blocked) return;
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
            max_output_tokens: Number(draft ? output : view.max_output_tokens),
            daily_call_limit: Number(draft ? calls : view.daily_call_limit),
          }
        : {}),
    });
    if (!input.success) {
      setError(input.error.issues.map((i) => i.message).join(" "));
      return;
    }
    void action.run(
      () => {
        setAttempt(input.data);
        return client.setPluginAiPermission(id, input.data);
      },
      (next) => {
        if (!matchesAttempt(next, input.data, id, true))
          throw new Error(
            "The permission receipt does not match this connection and its submitted limits. Check saved state.",
          );
        read.commit(next);
        setOutput(String(next.max_output_tokens));
        setCalls(String(next.daily_call_limit));
        setDraft(false);
        setAttempt(null);
      },
      enabled
        ? {
            title: "Allow workspace AI for this connection?",
            body: provider
              ? `${provider.name} · ${provider.model}. This permission is separate from MCP access.`
              : "No workspace provider is available.",
            action: "Allow workspace AI",
          }
        : undefined,
    );
  };
  return (
    <div className="settings-form">
      <ReadState {...read}>
        {read.data && (
          <>
            <p>
              Workspace AI:{" "}
              {read.data.active
                ? "Active"
                : read.data.enabled
                  ? "Permission needs provider review"
                  : "Off"}{" "}
              · version {read.data.version}
            </p>
            <p className="small">
              Provider:{" "}
              {read.data.available_provider
                ? `${read.data.available_provider.name} · ${read.data.available_provider.model}`
                : "Unavailable"}
            </p>
            <Field label="Maximum output tokens">
              <Input
                type="number"
                min={1}
                max={2048}
                value={draft ? output : read.data.max_output_tokens}
                disabled={action.blocked}
                onChange={(e) => {
                  if (!draft) setCalls(String(read.data!.daily_call_limit));
                  setOutput(e.target.value);
                  setDraft(true);
                }}
              />
            </Field>
            <Field label="Daily calls">
              <Input
                type="number"
                min={1}
                max={100}
                value={draft ? calls : read.data.daily_call_limit}
                disabled={action.blocked}
                onChange={(e) => {
                  if (!draft) setOutput(String(read.data!.max_output_tokens));
                  setCalls(e.target.value);
                  setDraft(true);
                }}
              />
            </Field>
            <div className="settings-actions">
              <Button
                disabled={
                  !read.fresh || action.blocked || !read.data.available_provider
                }
                onClick={() => save(true)}
              >
                Allow with these limits
              </Button>
              <Button
                disabled={!read.fresh || action.blocked || !read.data.enabled}
                onClick={() => save(false)}
              >
                Revoke AI permission
              </Button>
            </div>
          </>
        )}
      </ReadState>
      {error && <p role="alert">{error}</p>}
      <ActionError
        action={action}
        check={async () => {
          const now = await client.pluginAiPermission(id);
          if (!action.owned()) return false;
          const matched = !!attempt && matchesAttempt(now, attempt, id, false);
          read.commit(now);
          if (matched) {
            setOutput(String(now.max_output_tokens));
            setCalls(String(now.daily_call_limit));
            setDraft(false);
            setAttempt(null);
          }
          return matched;
        }}
      />
    </div>
  );
}
