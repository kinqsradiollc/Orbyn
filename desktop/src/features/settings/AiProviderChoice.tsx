import { useEffect, useRef, useState } from "react";
import type { AiProviderChoice } from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { errorText } from "../../lib/errors";
/** Personal provider and fallback choices do not change MCP connections. */
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
    ownedChoice?.userId === userId && ownedChoice.token === session.get()
      ? ownedChoice.value
      : null;
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const abort = new AbortController(),
      token = session.get();
    lifetime.current?.abort();
    lifetime.current = abort;
    setOwnedChoice(null);
    setError(null);
    setBusy(false);
    if (!userId || !token) return () => abort.abort();
    void client.aiProviderChoice(abort.signal).then(
      (value) => {
        if (!abort.signal.aborted && token === session.get())
          setOwnedChoice({ userId, token, value });
      },
      (e) => {
        if (!abort.signal.aborted && token === session.get())
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
    const token = session.get();
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
      if (!active.signal.aborted && token === session.get())
        setOwnedChoice({ userId, token, value: next });
    } catch (e) {
      if (!active.signal.aborted && token === session.get())
        setError(errorText(e));
    } finally {
      if (!active.signal.aborted && token === session.get()) setBusy(false);
    }
  };
  return (
    <section className="settings-subform" aria-label="AI provider routing">
      <h3>Provider</h3>
      <div className="button-row start">
        <button
          type="button"
          className="secondary"
          aria-pressed={choice?.primary === "default"}
          disabled={busy || !choice}
          onClick={() => void save("default", false)}
        >
          Orbyn default
        </button>
        <button
          type="button"
          className="secondary"
          aria-pressed={choice?.primary === "chatgpt"}
          disabled={busy || !choice || !selection}
          onClick={() =>
            void save("chatgpt", choice?.fallback_to_default ?? false)
          }
        >
          ChatGPT
        </button>
      </div>
      {choice?.primary === "chatgpt" && (
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={choice.fallback_to_default}
            disabled={busy || !selection}
            onChange={(e) => void save("chatgpt", e.target.checked)}
          />
          Use Orbyn default if ChatGPT is unavailable
        </label>
      )}
      <small className="field-hint">
        Fallback uses Orbyn's configured provider. Interrupted or unknown
        ChatGPT results are not retried through it.
      </small>
      {error && <p role="alert">{error}</p>}
      {error && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => setReload((value) => value + 1)}
        >
          Reload provider
        </button>
      )}
    </section>
  );
}
