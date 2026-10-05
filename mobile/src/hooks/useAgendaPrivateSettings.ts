import { useEffect, useRef, useState } from "react";
import { agendaPrivateEnablementMessage } from "@orbyn/core";
import type {
  AgendaPrivatePermission,
  AgendaPrivateSummary,
  AiProviderChoice,
  ChatgptCatalogRead,
} from "@orbyn/core";
import { client } from "../lib/api";
import { session } from "../lib/session";
import { errorText } from "../lib/errors";
type Data = {
  permission: AgendaPrivatePermission;
  summary: AgendaPrivateSummary;
  choice: AiProviderChoice;
  catalog: ChatgptCatalogRead | null;
};
/** A reviewed owner/session snapshot; changed selections must be explicitly reviewed again. */
export function useAgendaPrivateSettings(userId: string) {
  const token = session.token;
  const [owned, setOwned] = useState<{
    userId: string;
    token: string | null;
    data: Data;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const lifetime = useRef<AbortController | null>(null);
  const data =
    owned?.userId === userId && owned.token === token ? owned.data : null;
  useEffect(() => {
    const abort = new AbortController();
    lifetime.current = abort;
    setOwned(null);
    setError(null);
    setBusy(false);
    if (!userId || !token) return () => abort.abort();
    void (async () => {
      try {
        const [permission, summary, choice] = await Promise.all([
          client.agendaPrivatePermission(abort.signal),
          client.agendaPrivateSummary(abort.signal),
          client.aiProviderChoice(abort.signal),
        ]);
        let catalog: ChatgptCatalogRead | null = null;
        if (
          choice.primary === "chatgpt" &&
          choice.connection_id &&
          choice.executor_id
        ) {
          try {
            catalog = await client.chatgptModels(
              {
                connection_id: choice.connection_id,
                executor_id: choice.executor_id,
              },
              abort.signal,
              true,
            );
          } catch {
            /* Revocation stays available when the selected device cannot be inspected. */
          }
        }
        if (!abort.signal.aborted && token === session.token)
          setOwned({
            userId,
            token,
            data: { permission, summary, choice, catalog },
          });
      } catch (e) {
        if (!abort.signal.aborted && token === session.token)
          setError(errorText(e));
      }
    })();
    return () => abort.abort();
  }, [userId, token, revision]);
  const enablementMessage = agendaPrivateEnablementMessage(data);
  const canEnable = !!data && enablementMessage === null;
  const save = async (enabled: boolean) => {
    const abort = lifetime.current;
    if (
      !data ||
      busy ||
      !abort ||
      abort.signal.aborted ||
      token !== session.token ||
      (enabled && !canEnable)
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await client.setAgendaPrivatePermission(
        {
          enabled,
          expected_version: data.permission.version,
          expected_provider_choice_version: data.choice.version,
          ...(enabled
            ? { expected_preference_version: data.catalog!.preference.version }
            : {}),
        },
        abort.signal,
      );
      if (!abort.signal.aborted && token === session.token)
        setRevision((n) => n + 1);
    } catch (e) {
      if (!abort.signal.aborted && token === session.token)
        setError(errorText(e));
    } finally {
      if (!abort.signal.aborted && token === session.token) setBusy(false);
    }
  };
  return {
    data,
    error,
    busy,
    canEnable,
    enablementMessage,
    save,
    refresh: () => setRevision((n) => n + 1),
  };
}
