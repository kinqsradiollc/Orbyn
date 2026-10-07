import { useEffect, useRef, useState } from "react";
import type { AiEmbeddingModelList, AiProvider } from "@orbyn/core";
import { client } from "../lib/api";

/** Read-only discovery bound to the displayed embedding connection revision. */
export function useEmbeddingModelCatalog(provider: AiProvider | undefined) {
  const identity =
    provider?.enabled && provider.embedding_revision
      ? `${provider.id}:${provider.embedding_revision}`
      : "";
  const current = useRef(identity);
  current.current = identity;
  const sequence = useRef(0);
  const [state, setState] = useState<{
    identity: string;
    loading: boolean;
    catalog?: AiEmbeddingModelList;
    error?: string;
  }>({ identity: "", loading: false });
  useEffect(() => {
    sequence.current++;
    setState({ identity, loading: false });
    return () => {
      sequence.current++;
    };
  }, [identity]);
  const load = async () => {
    if (!identity || !provider?.embedding_revision) return;
    const request = ++sequence.current;
    const owns = () =>
      sequence.current === request && current.current === identity;
    setState({ identity, loading: true });
    try {
      const catalog = await client.listAiEmbeddingModels(
        provider.id,
        provider.embedding_revision,
      );
      if (!owns()) return;
      if (catalog.provider_revision !== provider.embedding_revision)
        throw new Error(
          "The embedding provider changed. Refresh connections and try again.",
        );
      setState({ identity, loading: false, catalog });
    } catch (error) {
      if (owns())
        setState({
          identity,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "Could not load models. Type a model manually.",
        });
    }
  };
  return {
    loading: state.identity === identity && state.loading,
    catalog: state.identity === identity ? state.catalog : undefined,
    error: state.identity === identity ? state.error : undefined,
    load,
  };
}
