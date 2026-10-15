import { useEffect, useId, useRef, useState } from "react";
import {
  pluginAiPermissionInput,
  type PluginAiPermissionView,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { SettingsEditor } from "./SettingsEditor";

/** Explicit, provider-bound owner permission for one plugin connection. */
export function PluginAiPermission({
  grantId,
  grantName,
}: {
  grantId: string;
  grantName: string;
}) {
  return (
    <PluginAiPermissionBody
      key={grantId}
      grantId={grantId}
      grantName={grantName}
    />
  );
}

function PluginAiPermissionBody({
  grantId,
  grantName,
}: {
  grantId: string;
  grantName: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PluginAiPermissionView | null>(null);
  const [output, setOutput] = useState("512");
  const [calls, setCalls] = useState("10");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const mounted = useRef(false);
  const mutation = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setView(null);
    setError("");
    void client
      .pluginAiPermission(grantId, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setView(next);
        setNeedsRefresh(false);
        setOutput(String(next.max_output_tokens));
        setCalls(String(next.daily_call_limit));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Could not load AI permission. Try again.");
      });
    return () => controller.abort();
  }, [grantId, open, refresh]);
  const save = async (enabled: boolean) => {
    if (!view || !open || mutation.current || needsRefresh) return;
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
      const next = await client.setPluginAiPermission(grantId, input.data);
      if (mounted.current) setView(next);
    } catch {
      if (mounted.current) {
        setNeedsRefresh(true);
        setError(
          "Permission changed or could not be saved. Refresh before trying again.",
        );
      }
    } finally {
      mutation.current = false;
      if (mounted.current) setPending(false);
    }
  };
  return (
    <div className="agents-permission">
      <button
        type="button"
        className="link-button"
        aria-expanded={open}
        aria-controls={id}
        disabled={pending}
        onClick={() => setOpen(!open)}
      >
        Workspace AI
      </button>
      {open && (
        <SettingsEditor
          title={`Workspace AI · ${grantName}`}
          pending={pending}
          onClose={() => {
            if (!mutation.current) setOpen(false);
          }}
        >
          <section id={id} aria-label="Workspace AI permission">
            {view && (
              <>
                <p>
                  {needsRefresh
                    ? "Status unavailable"
                    : view.active
                      ? "Enabled"
                      : view.enabled
                        ? "Needs review"
                        : "Off"}
                  {view.available_provider
                    ? ` · ${view.available_provider.name} · ${view.available_provider.model}`
                    : " · No workspace provider available"}
                </p>
                <p className="muted">
                  This plugin may send text to the workspace provider. Workspace
                  usage may incur costs. Your ChatGPT plan is separate.
                </p>
                <div className="settings-field">
                  <label htmlFor={`${id}-output`}>Output tokens per call</label>
                  <input
                    id={`${id}-output`}
                    type="number"
                    min={1}
                    max={2048}
                    step={1}
                    value={output}
                    disabled={pending}
                    onChange={(e) => setOutput(e.target.value)}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor={`${id}-calls`}>Calls per day (UTC)</label>
                  <input
                    id={`${id}-calls`}
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={calls}
                    disabled={pending}
                    onChange={(e) => setCalls(e.target.value)}
                  />
                </div>
                <div className="agents-acts">
                  <button
                    type="button"
                    disabled={
                      pending || needsRefresh || !view.available_provider
                    }
                    onClick={() => void save(true)}
                  >
                    {view.enabled ? "Save permission" : "Allow workspace AI"}
                  </button>
                  {view.enabled && (
                    <button
                      type="button"
                      disabled={pending || needsRefresh}
                      onClick={() => void save(false)}
                    >
                      Turn off
                    </button>
                  )}
                </div>
              </>
            )}
            {!view && !error && <p role="status">Loading permission…</p>}
            {error && <p role="alert">{error}</p>}
            <button
              type="button"
              className="link-button"
              disabled={pending}
              onClick={() => {
                if (!mutation.current) setRefresh((value) => value + 1);
              }}
            >
              Refresh permission
            </button>
          </section>
        </SettingsEditor>
      )}
    </div>
  );
}
